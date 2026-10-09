import { createHash } from "node:crypto";
import { ValidationError } from "../commerce/validation.ts";
import type { CommerceRepo } from "../commerce/types.ts";
import { randomToken, type CrmSecrets } from "./crypto.ts";
import { HighLevelError, type HighLevelApi } from "./highlevel.ts";
import type { CrmConnection, CrmRepo } from "./types.ts";

// Buyer-owned HighLevel connections. Every function takes the license id
// resolved server-side from the buyer's authenticated portal session (or an
// administrator); nothing here trusts a browser-supplied license, customer or
// location id.

export type CrmDeps = {
  repo: CrmRepo;
  commerce: CommerceRepo;
  api: HighLevelApi | null;
  secrets: CrmSecrets | null;
  now?: () => Date;
  /** Waits between refresh-lock polls (overridable in tests). */
  sleep?: (ms: number) => Promise<void>;
};

export class NotConfiguredError extends ValidationError {}

const STATE_TTL_MS = 10 * 60 * 1000;
const REFRESH_EARLY_MS = 2 * 60 * 1000;
const REFRESH_LOCK_MS = 30 * 1000;

export const nowOf = (deps: CrmDeps) => (deps.now ? deps.now() : new Date());
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const tokenAad = (c: Pick<CrmConnection, "license_id" | "location_id">, field: "access" | "refresh") => `crm:${c.license_id}:${c.location_id}:${field}`;
const short = (e: unknown) => (e instanceof Error ? e.message : "Unknown error").slice(0, 500);

export function requireConfigured(deps: CrmDeps): { api: HighLevelApi; secrets: CrmSecrets } {
  if (!deps.api || !deps.secrets) throw new NotConfiguredError("The GoHighLevel integration is not configured yet. Please contact Monarch Tax Suite.");
  return { api: deps.api, secrets: deps.secrets };
}

async function activeLicense(deps: CrmDeps, licenseId: string) {
  const license = await deps.commerce.getLicense(licenseId);
  if (!license || license.status !== "active") throw new ValidationError("An active calculator license is required to connect GoHighLevel.");
  return license;
}

/** Starts OAuth: returns the raw state (sent to HighLevel and kept in an HttpOnly cookie); only its hash is stored. */
export async function startConnection(deps: CrmDeps, licenseId: string): Promise<string> {
  requireConfigured(deps);
  await activeLicense(deps, licenseId);
  const state = randomToken(32);
  await deps.repo.createOAuthState({ state_hash: sha256(state), license_id: licenseId, expires_at: new Date(nowOf(deps).getTime() + STATE_TTL_MS).toISOString() });
  return state;
}

/**
 * Completes OAuth for the license in the buyer's session. The state must match
 * the browser's cookie (checked by the route) and an unused state stored for
 * this same license. A connection is recorded only after the code exchange
 * returns a sub-account (Location) token and the location is read back.
 */
export async function completeConnection(deps: CrmDeps, input: { licenseId: string; state: string; code: string; redirectUri: string }): Promise<CrmConnection> {
  const { api, secrets } = requireConfigured(deps);
  const license = await activeLicense(deps, input.licenseId);
  if (!(await deps.repo.consumeOAuthState(sha256(input.state), input.licenseId, nowOf(deps).toISOString()))) {
    throw new ValidationError("This connection link expired or was already used. Start again from your portal.");
  }
  const tokens = await api.exchangeCode(input.code, input.redirectUri);
  if (tokens.userType !== "Location" || !tokens.locationId) {
    throw new ValidationError("Choose a single GoHighLevel sub-account (location) when connecting, not the agency account.");
  }
  const location = await api.getLocation(tokens.access_token, tokens.locationId);
  if (location.id !== tokens.locationId) throw new ValidationError("GoHighLevel returned a different location than the one authorized.");

  const now = nowOf(deps);
  const previous = await deps.repo.getLiveConnection(license.id);
  if (previous) await deps.repo.updateConnection(previous.id, { status: "disconnected", access_token_enc: null, refresh_token_enc: null, disconnected_at: now.toISOString(), refresh_lock_until: null });
  const ids = { license_id: license.id, location_id: tokens.locationId };
  const connection = await deps.repo.insertConnection({
    license_id: license.id,
    customer_id: license.customer_id,
    location_id: tokens.locationId,
    location_name: location.name,
    company_id: tokens.companyId,
    scopes: tokens.scope.split(/\s+/).filter(Boolean),
    access_token_enc: secrets.encrypt(tokens.access_token, tokenAad(ids, "access")),
    refresh_token_enc: secrets.encrypt(tokens.refresh_token, tokenAad(ids, "refresh")),
    token_expires_at: new Date(now.getTime() + tokens.expires_in * 1000).toISOString(),
    status: "connected",
    last_checked_at: now.toISOString(),
  });
  // Leads that were waiting for re-authorization go to the newly connected location.
  for (const lead of await deps.repo.listLeadsByStatus(license.id, ["reauth_required"])) {
    await deps.repo.updateLead(lead.id, { status: "retry_pending", connection_id: connection.id, next_attempt_at: now.toISOString(), last_error: null });
  }
  return connection;
}

async function markReauth(deps: CrmDeps, connection: CrmConnection, error: string) {
  const now = nowOf(deps).toISOString();
  return deps.repo.updateConnection(connection.id, { status: "reauth_required", refresh_lock_until: null, last_error: error.slice(0, 500), last_error_at: now });
}

/** Refreshes tokens under a lock so two requests never spend the same refresh token. */
async function refresh(deps: CrmDeps, connection: CrmConnection): Promise<CrmConnection> {
  const { api, secrets } = requireConfigured(deps);
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = nowOf(deps);
  if (!(await deps.repo.claimRefreshLock(connection.id, new Date(now.getTime() + REFRESH_LOCK_MS).toISOString(), now.toISOString()))) {
    // Another request is refreshing: wait for its result.
    for (let i = 0; i < 5; i++) {
      await sleep(1000);
      const latest = await deps.repo.getConnection(connection.id);
      if (!latest || latest.status !== "connected") throw new HighLevelError("GoHighLevel needs to be reconnected.", "auth", null);
      if (latest.token_expires_at && latest.token_expires_at !== connection.token_expires_at) return latest;
    }
    throw new HighLevelError("Token refresh is taking too long; will retry.", "retryable", null);
  }
  try {
    if (!connection.refresh_token_enc) throw new HighLevelError("No refresh token stored.", "auth", null);
    const tokens = await api.refresh(secrets.decrypt(connection.refresh_token_enc, tokenAad(connection, "refresh")));
    if (tokens.locationId && tokens.locationId !== connection.location_id) throw new HighLevelError("Refreshed token belongs to a different location.", "auth", null);
    const at = nowOf(deps);
    return await deps.repo.updateConnection(connection.id, {
      access_token_enc: secrets.encrypt(tokens.access_token, tokenAad(connection, "access")),
      refresh_token_enc: secrets.encrypt(tokens.refresh_token, tokenAad(connection, "refresh")),
      token_expires_at: new Date(at.getTime() + tokens.expires_in * 1000).toISOString(),
      scopes: tokens.scope ? tokens.scope.split(/\s+/).filter(Boolean) : connection.scopes,
      last_refresh_at: at.toISOString(),
      refresh_lock_until: null,
    });
  } catch (e) {
    if (e instanceof HighLevelError && e.kind === "auth") {
      await markReauth(deps, connection, `Authorization expired or was revoked: ${e.message}`);
      throw e;
    }
    await deps.repo.updateConnection(connection.id, { refresh_lock_until: null, last_error: short(e), last_error_at: nowOf(deps).toISOString() });
    throw e instanceof HighLevelError ? e : new HighLevelError(short(e), "retryable", null);
  }
}

/**
 * Runs an API call with this connection's access token, refreshing it when it
 * is about to expire, and once more if HighLevel rejects it. A connection that
 * cannot be refreshed is marked "reauth_required".
 */
export async function withAccessToken<T>(deps: CrmDeps, connection: CrmConnection, call: (token: string, connection: CrmConnection) => Promise<T>): Promise<T> {
  const { secrets } = requireConfigured(deps);
  if (connection.status !== "connected") throw new HighLevelError("GoHighLevel needs to be reconnected.", "auth", null);
  let current = connection;
  const expires = current.token_expires_at ? Date.parse(current.token_expires_at) : 0;
  if (expires - REFRESH_EARLY_MS <= nowOf(deps).getTime()) current = await refresh(deps, current);
  const token = () => secrets.decrypt(current.access_token_enc!, tokenAad(current, "access"));
  try {
    return await call(token(), current);
  } catch (e) {
    if (!(e instanceof HighLevelError) || e.kind !== "auth" || e.status !== 401) {
      if (e instanceof HighLevelError && e.kind === "auth") await markReauth(deps, current, e.message);
      throw e;
    }
    current = await refresh(deps, current);
    try {
      return await call(token(), current);
    } catch (again) {
      if (again instanceof HighLevelError && again.kind === "auth") await markReauth(deps, current, again.message);
      throw again;
    }
  }
}

/** Verifies the stored authorization still works by reading the connected location (no contacts are created). */
export async function testConnection(deps: CrmDeps, licenseId: string): Promise<{ ok: boolean; message: string }> {
  requireConfigured(deps);
  const connection = await deps.repo.getLiveConnection(licenseId);
  if (!connection) return { ok: false, message: "GoHighLevel is not connected." };
  if (connection.status === "reauth_required") return { ok: false, message: "Authorization expired. Reconnect GoHighLevel." };
  const now = () => nowOf(deps).toISOString();
  try {
    const location = await withAccessToken(deps, connection, (token, c) => deps.api!.getLocation(token, c.location_id));
    await deps.repo.updateConnection(connection.id, { location_name: location.name ?? connection.location_name, last_checked_at: now(), last_error: null });
    return { ok: true, message: `Connected to ${location.name ?? connection.location_id}.` };
  } catch (e) {
    await deps.repo.updateConnection(connection.id, { last_checked_at: now(), last_error: short(e), last_error_at: now() }).catch(() => undefined);
    const reauth = e instanceof HighLevelError && e.kind === "auth";
    return { ok: false, message: reauth ? "Authorization expired or was revoked. Reconnect GoHighLevel." : `Connection test failed: ${short(e)}` };
  }
}

/**
 * Disconnects: credentials are deleted immediately and no further deliveries
 * use this connection. Leads not yet delivered are marked failed (their
 * details stay visible to the buyer for the retention window).
 */
export async function disconnect(deps: CrmDeps, licenseId: string): Promise<boolean> {
  const connection = await deps.repo.getLiveConnection(licenseId);
  if (!connection) return false;
  const now = nowOf(deps).toISOString();
  await deps.repo.updateConnection(connection.id, { status: "disconnected", access_token_enc: null, refresh_token_enc: null, refresh_lock_until: null, disconnected_at: now });
  for (const lead of await deps.repo.listLeadsByStatus(licenseId, ["received", "sending", "retry_pending", "reauth_required"])) {
    await deps.repo.updateLead(lead.id, { status: "failed", last_error: "GoHighLevel was disconnected before this lead was delivered.", next_attempt_at: null, lock_until: null });
  }
  await deps.repo.saveLeadSettings({ ...((await deps.repo.getLeadSettings(licenseId)) ?? { license_id: licenseId, business_name: null, lead_source: "Monarch Tax Calculator", tags: [], update_existing: false, include_summary: true }), enabled: false });
  return true;
}
