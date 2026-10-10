import "server-only";
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
import { safeEmit } from "../automation/server";
import { after } from "next/server";

// Server-only configuration (never NEXT_PUBLIC_*; nothing here reaches the browser).
//   MONARCH_ENCRYPTION_KEY                          32 random bytes, base64 (required for any lead destination)
//   HIGHLEVEL_CLIENT_ID / HIGHLEVEL_CLIENT_SECRET   HighLevel Marketplace app (optional; enables GoHighLevel connections)
//   HIGHLEVEL_VERSION_ID (optional)                 app version id from the install link (version_id=...); needed only while the version is not live
//   HIGHLEVEL_REDIRECT_URI (optional)               defaults to <app origin>/api/integrations/crm/callback

export function crmConfigStatus() {
  return {
    highlevel: Boolean(process.env.HIGHLEVEL_CLIENT_ID && process.env.HIGHLEVEL_CLIENT_SECRET),
    encryption: CrmSecrets.fromBase64(process.env.MONARCH_ENCRYPTION_KEY) !== null,
  };
}

export function crmDeps(): CrmDeps {
  const db = serviceClient();
  const id = process.env.HIGHLEVEL_CLIENT_ID;
  const secret = process.env.HIGHLEVEL_CLIENT_SECRET;
  return {
    repo: new SupabaseCrmRepo(db),
    commerce: new SupabaseCommerceRepo(db),
    api: id && secret ? new HttpHighLevelApi(id, secret) : null,
    secrets: CrmSecrets.fromBase64(process.env.MONARCH_ENCRYPTION_KEY),
    // Lead events run after the visitor's response is sent, so automation can never slow or break a submission.
    emit: async (e) => {
      try {
        after(() => safeEmit(e));
      } catch {
        void safeEmit(e);
      }
    },
    leadRetryDelaysMs: [400, 1500],
  };
}

export async function oauthRedirectUri() {
  return process.env.HIGHLEVEL_REDIRECT_URI || `${await appOrigin()}/api/integrations/crm/callback`;
}

/** Short-lived cookie binding an OAuth attempt to the browser that started it. */
export const OAUTH_COOKIE = "mts_crm_oauth";
/** Short-lived, encrypted cookie holding an install that was started inside HighLevel until the license holder confirms it. */
export const PENDING_COOKIE = "mts_crm_pending";
export const pendingCookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/integrations", maxAge: 600 };
export const oauthCookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/api/integrations/crm", maxAge: 600 };

/**
 * Resolves a license from the buyer's license key (their proof of ownership,
 * as for annual updates). Nothing is remembered between requests: there is no
 * buyer account or session.
 */
export async function licenseFromKey(rawKey: string): Promise<License> {
  if (!isWellFormedLicenseKey(rawKey)) throw new ValidationError("Enter your license key (MTS-XXXXX-XXXXX-XXXXX-XXXXX).");
  const license = await new SupabaseCommerceRepo(serviceClient()).findLicenseByKeyHash(hashLicenseKey(rawKey));
  if (!license || license.status !== "active") throw new ValidationError("That license key was not found or the license is not active.");
  return license;
}
