import { ValidationError } from "../commerce/validation.ts";
import type { Keyring } from "./keyring.ts";

// Full Social Security numbers for clients: stored encrypted, shown only to the account owner, one client at a time,
// after they re-enter their password, for 30 seconds. The number is never in a URL, a log, an email, an event, an
// export or the audit trail; the audit trail records only who looked at whose, and when.

export const REVEAL_SECONDS = 30;
export const REVEAL_LIMIT = 10; // per person per window
export const REVEAL_WINDOW_SECONDS = 600;

export type KeyRow = { master_version: number; wrapped_key: string };
export interface SsnRepo {
  clientExists(clientId: string): Promise<boolean>;
  getKey(): Promise<KeyRow | null>;
  /** Inserts the tenant's data key; returns false if another request inserted it first. */
  insertKey(row: KeyRow): Promise<boolean>;
  listKeys(): Promise<(KeyRow & { tenant_id: string })[]>;
  saveWrappedKey(tenantId: string, row: KeyRow): Promise<void>;
  getCiphertext(clientId: string): Promise<string | null>;
  putCiphertext(clientId: string, ciphertext: string, actorId: string | null): Promise<void>;
  deleteCiphertext(clientId: string): Promise<void>;
  setLast4(clientId: string, last4: string | null): Promise<void>;
  audit(e: { action: string; clientId: string; actorId: string | null }): Promise<void>;
}
export type SsnDeps = {
  tenantId: string;
  keyring: Keyring | null;
  repo: SsnRepo;
  now?: () => Date;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const aadFor = (tenantId: string, clientId: string) => `ssn:${tenantId}:${clientId}`;

/** Nine digits, with or without dashes or spaces. Returns the digits, or throws without echoing the input. */
export function checkSsn(raw: unknown): string {
  const digits = typeof raw === "string" ? raw.replace(/[\s-]/g, "") : "";
  if (!/^\d{9}$/.test(digits)) throw new ValidationError("Enter the nine digits of the Social Security number.");
  const area = digits.slice(0, 3);
  if (area === "000" || area === "666" || digits.slice(3, 5) === "00" || digits.slice(5) === "0000") throw new ValidationError("That isn't a valid Social Security number.");
  return digits;
}
export const formatSsn = (d: string) => `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;

function ring(deps: SsnDeps): Keyring {
  if (!deps.keyring) throw new ValidationError("Encrypted storage isn't set up on this deployment yet. Ask the platform administrator.");
  return deps.keyring;
}

async function dataKey(deps: SsnDeps, create: boolean): Promise<Buffer | null> {
  const k = ring(deps);
  let row = await deps.repo.getKey();
  if (!row && create) {
    const fresh = k.newDataKey();
    const w = k.wrap(fresh, deps.tenantId);
    if (await deps.repo.insertKey({ master_version: w.version, wrapped_key: w.wrapped })) return fresh;
    row = await deps.repo.getKey(); // another request created it first: use theirs
  }
  return row ? k.unwrap(row.master_version, row.wrapped_key, deps.tenantId) : null;
}

/** Stores a client's full number, encrypted, and keeps the last four digits on the client for display. */
export async function storeSsn(deps: SsnDeps, input: { clientId: string; ssn: unknown; actorId: string | null }): Promise<void> {
  const digits = checkSsn(input.ssn);
  if (!UUID.test(input.clientId) || !(await deps.repo.clientExists(input.clientId))) throw new ValidationError("That client wasn't found.");
  const key = (await dataKey(deps, true))!;
  await deps.repo.putCiphertext(input.clientId, ring(deps).seal(key, digits, aadFor(deps.tenantId, input.clientId)), input.actorId);
  await deps.repo.setLast4(input.clientId, digits.slice(-4));
  await deps.repo.audit({ action: "ssn.stored", clientId: input.clientId, actorId: input.actorId });
}

export async function clearSsn(deps: SsnDeps, input: { clientId: string; actorId: string | null }): Promise<void> {
  if (!UUID.test(input.clientId) || !(await deps.repo.clientExists(input.clientId))) throw new ValidationError("That client wasn't found.");
  await deps.repo.deleteCiphertext(input.clientId);
  await deps.repo.audit({ action: "ssn.cleared", clientId: input.clientId, actorId: input.actorId });
}

export type RevealGate = {
  actorId: string;
  /** Whether this person is the account owner of the workspace. Resolved by the caller from the session, never from the request. */
  isOwner: boolean;
  /** Re-checks the password the person just typed. */
  verifyPassword: (password: string) => Promise<boolean>;
  /** Counts this attempt; false when the person has tried too many times. */
  allowAttempt: () => Promise<boolean>;
};
export type Revealed = { ssn: string; expiresAt: string; seconds: number };

/**
 * Shows one client's full number to the account owner. Anyone else is refused; the password is re-checked every time;
 * attempts are limited; every attempt, allowed or not, is recorded without the number.
 */
export async function revealSsn(deps: SsnDeps, gate: RevealGate, input: { clientId: string; password: unknown }): Promise<Revealed> {
  if (!UUID.test(input.clientId)) throw new ValidationError("That client wasn't found.");
  if (!gate.isOwner) {
    await deps.repo.audit({ action: "ssn.reveal_refused", clientId: input.clientId, actorId: gate.actorId });
    throw new ValidationError("Only the account owner can view a full Social Security number.");
  }
  if (!(await gate.allowAttempt())) {
    await deps.repo.audit({ action: "ssn.reveal_limited", clientId: input.clientId, actorId: gate.actorId });
    throw new ValidationError("Too many attempts. Wait a few minutes and try again.");
  }
  const password = typeof input.password === "string" ? input.password : "";
  if (!password || !(await gate.verifyPassword(password))) {
    await deps.repo.audit({ action: "ssn.reveal_wrong_password", clientId: input.clientId, actorId: gate.actorId });
    throw new ValidationError("That password isn't right.");
  }
  const sealed = await deps.repo.getCiphertext(input.clientId);
  const key = sealed ? await dataKey(deps, false) : null;
  if (!sealed || !key) throw new ValidationError("There is no Social Security number on file for this client.");
  let digits: string;
  try {
    digits = ring(deps).open(key, sealed, aadFor(deps.tenantId, input.clientId));
  } catch {
    await deps.repo.audit({ action: "ssn.reveal_failed", clientId: input.clientId, actorId: gate.actorId });
    throw new ValidationError("That number couldn't be read. Enter it again.");
  }
  await deps.repo.audit({ action: "ssn.revealed", clientId: input.clientId, actorId: gate.actorId });
  const now = (deps.now ? deps.now() : new Date()).getTime();
  return { ssn: formatSsn(digits), expiresAt: new Date(now + REVEAL_SECONDS * 1000).toISOString(), seconds: REVEAL_SECONDS };
}

/** Whether a full number is on file (never the number). */
export async function hasStoredSsn(deps: SsnDeps, clientId: string): Promise<boolean> {
  return UUID.test(clientId) && (await deps.repo.getCiphertext(clientId)) !== null;
}

/**
 * The full number, for filling an IRS form on the server. It goes into the filled document and nowhere else: not a page,
 * a log, an email or an event. Each use is written to the audit trail (who, which client, never the number).
 */
export async function ssnForDocument(deps: SsnDeps, input: { clientId: string; actorId: string | null; documentName: string }): Promise<string> {
  if (!UUID.test(input.clientId)) throw new ValidationError("That client wasn't found.");
  const sealed = await deps.repo.getCiphertext(input.clientId);
  const key = sealed ? await dataKey(deps, false) : null;
  if (!sealed || !key) throw new ValidationError("There is no Social Security number on file for this client. Add it on their Tax ID panel, then send the form again.");
  let digits: string;
  try {
    digits = ring(deps).open(key, sealed, aadFor(deps.tenantId, input.clientId));
  } catch {
    await deps.repo.audit({ action: "ssn.fill_failed", clientId: input.clientId, actorId: input.actorId });
    throw new ValidationError("That number couldn't be read. Enter it again on the client's Tax ID panel.");
  }
  await deps.repo.audit({ action: "ssn.filled_document", clientId: input.clientId, actorId: input.actorId });
  return formatSsn(digits);
}

/** After a new master key is added and made current: re-wraps the tenant's data key so the old master can be retired. */
export async function rewrapTenantKey(deps: SsnDeps): Promise<boolean> {
  const k = ring(deps);
  const row = await deps.repo.getKey();
  if (!row || row.master_version === k.current) return false;
  const key = k.unwrap(row.master_version, row.wrapped_key, deps.tenantId);
  const w = k.wrap(key, deps.tenantId);
  await deps.repo.saveWrappedKey(deps.tenantId, { master_version: w.version, wrapped_key: w.wrapped });
  return true;
}
