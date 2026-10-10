import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

// Server-side secrets for the CRM integration, all derived from one 32-byte
// master key (MONARCH_ENCRYPTION_KEY). Subkeys are separated by purpose so a
// value signed or encrypted for one purpose can never be used for another.
//  - Buyer CRM credentials (OAuth tokens, webhook URLs and secrets): AES-256-GCM with associated data naming the row
//    and field, so ciphertext cannot be moved between tenants or fields.
//  - Embed lead tokens: HMAC-SHA256. Visitor IPs: keyed hash for rate limiting only.

type Purpose = "encryption" | "embed-token" | "ip-hash" | "setup-session";

export class CrmSecrets {
  private keys = new Map<Purpose, Buffer>();
  private master: Buffer;

  constructor(master: Buffer) {
    if (master.length !== 32) throw new Error("MONARCH_ENCRYPTION_KEY must be 32 bytes (base64).");
    this.master = master;
  }

  static fromBase64(value: string | undefined): CrmSecrets | null {
    if (!value) return null;
    const key = Buffer.from(value, "base64");
    return key.length === 32 ? new CrmSecrets(key) : null;
  }

  private key(purpose: Purpose): Buffer {
    let k = this.keys.get(purpose);
    if (!k) {
      k = Buffer.from(hkdfSync("sha256", this.master, Buffer.alloc(0), `monarch:${purpose}:v1`, 32));
      this.keys.set(purpose, k);
    }
    return k;
  }

  encrypt(plaintext: string, aad: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key("encryption"), iv);
    cipher.setAAD(Buffer.from(aad));
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
  }

  decrypt(value: string, aad: string): string {
    if (!value.startsWith("v1:")) throw new Error("Unsupported ciphertext version.");
    const raw = Buffer.from(value.slice(3), "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key("encryption"), raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  }

  /** Signs a JSON payload: base64url(payload).base64url(hmac). */
  sign(purpose: Exclude<Purpose, "encryption" | "ip-hash">, payload: object): string {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${body}.${this.mac(purpose, body)}`;
  }

  /** Verifies a signed payload; returns null when tampered, malformed or expired (field `e`, epoch seconds). */
  verify<T extends { e: number }>(purpose: Exclude<Purpose, "encryption" | "ip-hash">, token: string | undefined | null, nowMs = Date.now()): T | null {
    if (!token || token.length > 2048) return null;
    const [body, mac] = token.split(".");
    if (!body || !mac) return null;
    const expected = Buffer.from(this.mac(purpose, body));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
      return typeof payload.e === "number" && payload.e * 1000 > nowMs ? payload : null;
    } catch {
      return null;
    }
  }

  /** Keyed hash of a visitor IP for rate limiting; the IP itself is never stored. */
  hashIp(ip: string): string {
    return createHmac("sha256", this.key("ip-hash")).update(ip).digest("hex");
  }

  private mac(purpose: Purpose, body: string): string {
    return createHmac("sha256", this.key(purpose)).update(body).digest("base64url");
  }
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
