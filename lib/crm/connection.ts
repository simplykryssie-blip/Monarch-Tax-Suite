import { createHash } from "node:crypto";
import { ValidationError } from "../commerce/validation.ts";
import type { CommerceRepo } from "../commerce/types.ts";
import { randomToken, type CrmSecrets } from "./crypto.ts";
import { HighLevelError, type HighLevelApi } from "./highlevel.ts";
import { parseWebhookUrl, sendWebhook, type WebhookSender } from "./webhook.ts";
import type { CrmConnection, CrmRepo } from "./types.ts";

// Buyer-owned CRM destinations. Every function takes a license id that the
// server resolved itself (from the buyer's license key, a single-use OAuth
// state, or an administrator); browser-supplied ids are never trusted.

export type CrmDeps = {
  repo: CrmRepo;
  commerce: CommerceRepo;
  /** HighLevel API client; null until the HighLevel app credentials are configured. */
  api: HighLevelApi | null;
  /** Server encryption/signing keys; null until MONARCH_ENCRYPTION_KEY is configured. */
  secrets: CrmSecrets | null;
  webhook?: WebhookSender;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

export class NotConfiguredError extends ValidationError {}

const STATE_TTL_MS = 10 * 60 * 1000;
const REFRESH_EARLY_MS = 2 * 60 * 1000;
const REFRESH_LOCK_MS = 30 * 1000;

export const nowOf = (deps: CrmDeps) => (deps.now ? deps.now() : new Date());
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const tokenAad = (c: Pick<CrmConnection, "license_id" | "location_id">, field: "access" | "refresh") => `crm:${c.license_id}:${c.location_id}:${field}`;
export const webhookAad = (licenseId: string, field: "url" | "secret") => `webhook:${licenseId}:${field}`;
const short = (e: unknown) => (e instanceof Error ? e.message : "Unknown error").slice(0, 500);

export function requireSecrets(deps: CrmDeps): CrmSecrets {
  if (!deps.secrets) throw new NotConfiguredError("Lead integrations are not configured yet. Please contact Monarch Tax Suite.");
  return deps.secrets;
}

export function requireHighLevel(deps: CrmDeps): { api: HighLevelApi; secrets: CrmSecrets } {
  const secrets = requireSecrets(deps);
  if (!deps.api) throw new NotConfiguredError("The GoHighLevel connection is not available yet. You can use a webhook instead.");
  return { api: deps.api, secrets };
}

async function activeLicense(deps: CrmDeps, licenseId: string) {
  const license = await deps.commerce.getLicense(licenseId);
  if (!license || license.status !== "active") throw new ValidationError("An active calculator license is required.");
  return license;
}

async function replaceLive(deps: CrmDeps, licenseId: string) {
  const previous = await deps.repo.getLiveConnection(licenseId);
  if (previous) await clearConnection(deps, previous);
}

async function clearConnection(deps: CrmDeps, connection: CrmConnection) {
  await deps.repo.updateConnection(connection.id, {
    status: "disconnected",
    access_token_enc: null,
    refresh_token_enc: null,
    webhook_url_enc: null,
    signing_secret_enc: null,
    refresh_lock_until: null,
    disconnected_at: nowOf(deps).toISOString(),
  });
}

// ---------------------------------------------------------------- HighLevel

/** Starts OAuth for a license: returns the raw state (sent to HighLevel and kept in an HttpOnly cookie); only its hash is stored. */
export async function startConnection(deps: CrmDeps, licenseId: string): Promise<string> {
  requireHighLevel(deps);
  await activeLicense(deps, licenseId);
  const state = randomToken(32);
  await deps.repo.createOAuthState({ state_hash: sha256(state), license_id: licenseId, expires_at: new Date(nowOf(deps).getTime() + STATE_TTL_MS).toISOString() });
  return state;
}

/**
 * Completes OAuth. The license comes only from the single-use state created
 * for it (the route also checks the state matches this browser's cookie). The
 * connection is recorded only after HighLevel returns a sub-account
 * (Location) token and the location is read back with it.
 */
export async function completeConnection(deps: CrmDeps, input: { state: string; code: string; redirectUri: string }): Promise<CrmConnection> {
  const { api, secrets } = requireHighLevel(deps);
  const licenseId = await deps.repo.consumeOAuthState(sha256(input.state), nowOf(deps).toISOString());
  if (!licenseId) throw new ValidationError("This connection link expired or was already used. Start again from the setup page.");
  const license = await activeLicense(deps, licenseId);
  const tokens = await api.exchangeCode(input.code, input.redirectUri);
  if (tokens.userType !== "Location" || !tokens.locationId) {
    throw new ValidationError("Choose a single GoHighLevel sub-account (location) when connecting, not the agency account.");
  }
  const location = await api.getLocation(tokens.access_token, tokens.locationId);
  if (location.id !== tokens.locationId) throw new ValidationError("GoHighLevel returned a different location than the one authorized.");

  await replaceLive(deps, license.id);
  const now = nowOf(deps);
  const ids = { license_id: license.id, location_id: tokens.locationId };
  return deps.repo.insertConnection({
    license_id: license.id,
    customer_id: license.customer_id,
    provider: "highlevel",
    status: "connected",
    location_id: tokens.locationId,
    location_name: location.name,
    company_id: tokens.companyId,
    scopes: tokens.scope.split(/\s+/).filter(Boolean),
    access_token_enc: secrets.encrypt(tokens.access_token, tokenAad(ids, "access")),
    refresh_token_enc: secrets.encrypt(tokens.refresh_token, tokenAad(ids, "refresh")),
    token_expires_at: new Date(now.getTime() + tokens.expires_in * 1000).toISOString(),
    // last_checked_at stays empty: the connection is authorized but has not been tested yet (see lib/crm/setup.ts).
  });
}

async function markReauth(deps: CrmDeps, connection: CrmConnection, error: string) {
  return deps.repo.updateConnection(connection.id, { status: "reauth_required", refresh_lock_until: null, last_error: error.slice(0, 500), last_error_at: nowOf(deps).toISOString() });
}

/** Refreshes tokens under a lock so two requests never spend the same refresh token. */
async function refresh(deps: CrmDeps, connection: CrmConnection): Promise<CrmConnection> {
  const { api, secrets } = requireHighLevel(deps);
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = nowOf(deps);
  if (!(await deps.repo.claimRefreshLock(connection.id, new Date(now.getTime() + REFRESH_LOCK_MS).toISOString(), now.toISOString()))) {
    for (let i = 0; i < 5; i++) {
      await sleep(1000);
      const latest = await deps.repo.getConnection(connection.id);
      if (!latest || latest.status !== "connected") throw new HighLevelError("GoHighLevel needs to be reconnected.", "auth", null);
      if (latest.token_expires_at && latest.token_expires_at !== connection.token_expires_at) return latest;
    }
    throw new HighLevelError("Token refresh is taking too long.", "retryable", null);
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

/** Runs a HighLevel call with this connection's token, refreshing it when due and once more after a 401. */
export async function withAccessToken<T>(deps: CrmDeps, connection: CrmConnection, call: (token: string, connection: CrmConnection) => Promise<T>): Promise<T> {
  const { secrets } = requireHighLevel(deps);
  if (connection.provider !== "highlevel" || connection.status !== "connected") throw new HighLevelError("GoHighLevel needs to be reconnected.", "auth", null);
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

// ------------------------------------------------------------------ webhook

/**
 * Sets a signed webhook as the license's destination, replacing any other.
 * Returns the signing secret; it is shown to the buyer once and stored only
 * encrypted (Monarch needs it to sign each request).
 */
export async function setWebhook(deps: CrmDeps, licenseId: string, rawUrl: string): Promise<{ connection: CrmConnection; signingSecret: string }> {
  const secrets = requireSecrets(deps);
  const license = await activeLicense(deps, licenseId);
  const url = parseWebhookUrl(rawUrl);
  const signingSecret = `whsec_${randomToken(24)}`;
  await replaceLive(deps, license.id);
  const connection = await deps.repo.insertConnection({
    license_id: license.id,
    customer_id: license.customer_id,
    provider: "webhook",
    status: "connected",
    webhook_url_enc: secrets.encrypt(url.toString(), webhookAad(license.id, "url")),
    webhook_host: url.hostname,
    signing_secret_enc: secrets.encrypt(signingSecret, webhookAad(license.id, "secret")),
  });
  return { connection, signingSecret };
}

export function webhookTarget(deps: CrmDeps, connection: CrmConnection) {
  const secrets = requireSecrets(deps);
  return {
    url: secrets.decrypt(connection.webhook_url_enc!, webhookAad(connection.license_id, "url")),
    secret: secrets.decrypt(connection.signing_secret_enc!, webhookAad(connection.license_id, "secret")),
  };
}

// ------------------------------------------------------------------- common

/** Checks the destination without sending any personal data (HighLevel: reads the location; webhook: posts a test event). */
export async function testDestination(deps: CrmDeps, licenseId: string): Promise<{ ok: boolean; message: string }> {
  requireSecrets(deps);
  const connection = await deps.repo.getLiveConnection(licenseId);
  if (!connection) return { ok: false, message: "No lead destination is connected." };
  const now = () => nowOf(deps).toISOString();
  if (connection.provider === "webhook") {
    const result = await (deps.webhook ?? sendWebhook)(webhookTarget(deps, connection), { event: "calculator.test", sent_at: now(), note: "Connection test from Monarch Tax Suite. Contains no lead data." }, `test-${randomToken(8)}`);
    await deps.repo.updateConnection(connection.id, result.ok ? { last_checked_at: now(), last_error: null } : { last_checked_at: now(), last_error: `Test failed: ${result.reason}${result.status ? ` (HTTP ${result.status})` : ""}`, last_error_at: now() });
    return result.ok ? { ok: true, message: `Your webhook at ${connection.webhook_host} accepted the test (HTTP ${result.status}).` } : { ok: false, message: `The webhook did not accept the test: ${result.reason}${result.status ? ` (HTTP ${result.status})` : ""}.` };
  }
  if (connection.status === "reauth_required") return { ok: false, message: "GoHighLevel authorization expired. Reconnect it." };
  try {
    const location = await withAccessToken(deps, connection, (token, c) => requireHighLevel(deps).api.getLocation(token, c.location_id!));
    await deps.repo.updateConnection(connection.id, { location_name: location.name ?? connection.location_name, last_checked_at: now(), last_error: null });
    return { ok: true, message: `Connected to ${location.name ?? connection.location_id}.` };
  } catch (e) {
    await deps.repo.updateConnection(connection.id, { last_checked_at: now(), last_error: short(e), last_error_at: now() }).catch(() => undefined);
    return { ok: false, message: e instanceof HighLevelError && e.kind === "auth" ? "GoHighLevel authorization expired or was revoked. Reconnect it." : `Connection test failed: ${short(e)}` };
  }
}

/** Removes the destination: stored credentials are deleted immediately and the lead form is turned off. */
export async function disconnect(deps: CrmDeps, licenseId: string): Promise<boolean> {
  const connection = await deps.repo.getLiveConnection(licenseId);
  if (!connection) return false;
  await clearConnection(deps, connection);
  const settings = await deps.repo.getLeadSettings(licenseId);
  if (settings?.enabled) {
    const { updated_at: _u, ...rest } = settings;
    void _u;
    await deps.repo.saveLeadSettings({ ...rest, enabled: false });
  }
  return true;
}
