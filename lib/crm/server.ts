import "server-only";
import { cookies } from "next/headers";
import { appOrigin } from "../admin";
import { serviceClient } from "../supabase/service";
import { SupabaseCommerceRepo } from "../commerce/supabase-repo.ts";
import { hashLicenseKey, isWellFormedLicenseKey } from "../commerce/license-keys.ts";
import { ValidationError } from "../commerce/validation.ts";
import type { License } from "../commerce/types.ts";
import { CrmSecrets } from "./crypto.ts";
import { HttpHighLevelApi } from "./highlevel.ts";
import { SupabaseCrmRepo } from "./supabase-repo.ts";
import type { CrmDeps } from "./connection.ts";

// Server-only configuration. Secrets come from server environment variables
// (never NEXT_PUBLIC_*), and nothing here is sent to the browser.
//   HIGHLEVEL_CLIENT_ID / HIGHLEVEL_CLIENT_SECRET  HighLevel Marketplace app credentials
//   MONARCH_ENCRYPTION_KEY                          32 random bytes, base64
//   HIGHLEVEL_REDIRECT_URI (optional)               defaults to <app origin>/api/integrations/crm/callback

export function crmConfigStatus() {
  return {
    highlevel: Boolean(process.env.HIGHLEVEL_CLIENT_ID && process.env.HIGHLEVEL_CLIENT_SECRET),
    encryption: CrmSecrets.fromBase64(process.env.MONARCH_ENCRYPTION_KEY) !== null,
  };
}

export function crmSecrets() {
  return CrmSecrets.fromBase64(process.env.MONARCH_ENCRYPTION_KEY);
}

export function crmDeps(): CrmDeps {
  const db = serviceClient();
  const id = process.env.HIGHLEVEL_CLIENT_ID;
  const secret = process.env.HIGHLEVEL_CLIENT_SECRET;
  return {
    repo: new SupabaseCrmRepo(db),
    commerce: new SupabaseCommerceRepo(db),
    api: id && secret ? new HttpHighLevelApi(id, secret) : null,
    secrets: crmSecrets(),
  };
}

export async function oauthRedirectUri() {
  return process.env.HIGHLEVEL_REDIRECT_URI || `${await appOrigin()}/api/integrations/crm/callback`;
}

// ------------------------------------------------------------ buyer portal

export const PORTAL_COOKIE = "mts_portal";
export const OAUTH_COOKIE = "mts_crm_oauth";
const SESSION_HOURS = 8;

type PortalSession = { l: string; k: string; e: number };

const secureCookie = () => process.env.NODE_ENV === "production";

/** Signs the buyer in with their license key (the same proof of ownership used for updates). */
export async function startPortalSession(rawKey: string): Promise<void> {
  const secrets = crmSecrets();
  if (!secrets) throw new ValidationError("The customer portal is not available yet. Please contact Monarch Tax Suite.");
  if (!isWellFormedLicenseKey(rawKey)) throw new ValidationError("Enter your license key (MTS-XXXXX-XXXXX-XXXXX-XXXXX).");
  const license = await new SupabaseCommerceRepo(serviceClient()).findLicenseByKeyHash(hashLicenseKey(rawKey));
  if (!license || !license.key_hash || license.status === "revoked") throw new ValidationError("That license key was not found or is no longer valid.");
  const token = secrets.sign("portal-session", { l: license.id, k: license.key_hash.slice(0, 16), e: Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600 } satisfies PortalSession);
  (await cookies()).set(PORTAL_COOKIE, token, { httpOnly: true, secure: secureCookie(), sameSite: "lax", path: "/", maxAge: SESSION_HOURS * 3600 });
}

export async function endPortalSession() {
  (await cookies()).delete(PORTAL_COOKIE);
}

/**
 * The license the signed-in buyer owns, or null. Rotating the license key or
 * revoking the license ends existing sessions.
 */
export async function portalLicense(): Promise<License | null> {
  const secrets = crmSecrets();
  if (!secrets) return null;
  const session = secrets.verify<PortalSession>("portal-session", (await cookies()).get(PORTAL_COOKIE)?.value);
  if (!session) return null;
  const license = await new SupabaseCommerceRepo(serviceClient()).getLicense(session.l);
  if (!license || license.status === "revoked" || !license.key_hash || license.key_hash.slice(0, 16) !== session.k) return null;
  return license;
}

export async function requirePortalLicense(): Promise<License> {
  const license = await portalLicense();
  if (!license) throw new ValidationError("Your portal session expired. Sign in again with your license key.");
  return license;
}

export function cookieOptions(maxAge: number, path = "/") {
  return { httpOnly: true, secure: secureCookie(), sameSite: "lax" as const, path, maxAge };
}
