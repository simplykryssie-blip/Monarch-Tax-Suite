import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// Envelope encryption for data too sensitive to share one key: every tenant has its own random data key, and each data
// key is wrapped by a platform master key that carries a version. To rotate the master key, add a new version, make it
// current and re-wrap each tenant's data key; the encrypted values never need re-encrypting. Old versions stay in the
// environment until every data key has moved off them.
//
//   MONARCH_ENCRYPTION_KEY            master key version 1 (32 bytes, base64): the key already in use
//   MONARCH_ENCRYPTION_KEY_V2, _V3…   later master keys
//   MONARCH_ENCRYPTION_KEY_CURRENT    the version used for new wraps (default: the highest present)

export class Keyring {
  private masters: Map<number, Buffer>;
  readonly current: number;

  constructor(masters: Map<number, Buffer>, current?: number) {
    if (!masters.size) throw new Error("No encryption key is configured.");
    for (const [v, k] of masters) if (!Number.isInteger(v) || v < 1 || k.length !== 32) throw new Error(`Encryption key version ${v} must be 32 bytes (base64).`);
    this.masters = masters;
    this.current = current ?? Math.max(...masters.keys());
    if (!masters.has(this.current)) throw new Error(`Encryption key version ${this.current} is not configured.`);
  }

  static fromEnv(env: Record<string, string | undefined>): Keyring | null {
    const masters = new Map<number, Buffer>();
    const add = (v: number, raw: string | undefined) => { if (raw) { const k = Buffer.from(raw, "base64"); if (k.length === 32) masters.set(v, k); } };
    add(1, env.MONARCH_ENCRYPTION_KEY);
    for (const [name, value] of Object.entries(env)) {
      const m = /^MONARCH_ENCRYPTION_KEY_V(\d{1,3})$/.exec(name);
      if (m) add(Number(m[1]), value);
    }
    if (!masters.size) return null;
    const wanted = Number(env.MONARCH_ENCRYPTION_KEY_CURRENT);
    return new Keyring(masters, Number.isInteger(wanted) && masters.has(wanted) ? wanted : undefined);
  }

  has(version: number) { return this.masters.has(version); }

  private wrapKey(version: number): Buffer {
    const master = this.masters.get(version);
    if (!master) throw new Error(`Encryption key version ${version} is not configured.`);
    return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), "monarch:data-key-wrap:v1", 32));
  }

  newDataKey(): Buffer { return randomBytes(32); }

  /** Wraps a tenant's data key under a master version (default: the current one). */
  wrap(dataKey: Buffer, tenantId: string, version = this.current): { version: number; wrapped: string } {
    return { version, wrapped: gcm(this.wrapKey(version), dataKey, `data-key:${tenantId}`) };
  }

  unwrap(version: number, wrapped: string, tenantId: string): Buffer {
    return Buffer.from(ungcm(this.wrapKey(version), wrapped, `data-key:${tenantId}`));
  }

  /** Encrypts a value with a tenant's data key. `aad` binds the ciphertext to its owner, so it can't be moved to another row. */
  seal(dataKey: Buffer, plaintext: string, aad: string): string { return gcm(dataKey, Buffer.from(plaintext, "utf8"), aad); }
  open(dataKey: Buffer, sealed: string, aad: string): string { return ungcm(dataKey, sealed, aad).toString("utf8"); }
}

function gcm(key: Buffer, data: Buffer, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(data), cipher.final()]);
  return `s1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
}
function ungcm(key: Buffer, value: string, aad: string): Buffer {
  if (!value.startsWith("s1:")) throw new Error("Unsupported ciphertext version.");
  const raw = Buffer.from(value.slice(3), "base64");
  if (raw.length < 29) throw new Error("Ciphertext is too short.");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
}
