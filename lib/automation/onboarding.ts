import type { CommerceRepo } from "../commerce/types.ts";
import type { CrmSecrets } from "../crm/crypto.ts";
import { hashSetupToken } from "./engine.ts";
import type { AutomationRepo } from "./types.ts";

// Secure setup links. The email carries a random 256-bit token; only its SHA-256 hash is stored.
// Opening a link trades the token for a short-lived signed session cookie and removes the token from the
// address bar, so the token is not left in browser history, referrers or analytics.

export const SETUP_COOKIE = "mts_setup";
export const SETUP_SESSION_SECONDS = 8 * 3600;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

type Deps = { repo: AutomationRepo; commerce: CommerceRepo; secrets: CrmSecrets; now?: () => Date };
export type SetupSession = { l: string; k: string; e: number };
export type OpenResult =
  | { ok: true; session: string; licenseId: string; linkId: string; firstOpen: boolean; maxAgeSeconds: number }
  | { ok: false; reason: "invalid" | "expired" | "revoked" | "license_unavailable" };

const nowMs = (d: Deps) => (d.now ? d.now() : new Date()).getTime();

export const OPEN_MESSAGES: Record<Extract<OpenResult, { ok: false }>["reason"], string> = {
  invalid: "This setup link is not valid. Please use the link from your most recent Monarch Tax Suite email.",
  expired: "This setup link has expired. Contact Monarch Tax Suite and we will send a new one.",
  revoked: "This setup link is no longer active. A newer link may have been sent to you; check your email, or contact Monarch Tax Suite.",
  license_unavailable: "This license is not available. Please contact Monarch Tax Suite.",
};

export async function openSetupLink(deps: Deps, token: string): Promise<OpenResult> {
  if (!TOKEN_FORMAT.test(token)) return { ok: false, reason: "invalid" };
  const link = await deps.repo.findLinkByHash(hashSetupToken(token));
  if (!link) return { ok: false, reason: "invalid" };
  if (link.revoked_at) return { ok: false, reason: "revoked" };
  if (Date.parse(link.expires_at) <= nowMs(deps)) return { ok: false, reason: "expired" };
  const license = await deps.commerce.getLicense(link.license_id);
  if (!license || license.status === "revoked") return { ok: false, reason: "license_unavailable" };
  const firstOpen = await deps.repo.markLinkOpened(link.id, new Date(nowMs(deps)).toISOString());
  const expiresAt = Math.min(Date.parse(link.expires_at), nowMs(deps) + SETUP_SESSION_SECONDS * 1000);
  const session = deps.secrets.sign("setup-session", { l: license.id, k: link.id, e: Math.floor(expiresAt / 1000) } satisfies SetupSession);
  return { ok: true, session, licenseId: license.id, linkId: link.id, firstOpen, maxAgeSeconds: Math.floor((expiresAt - nowMs(deps)) / 1000) };
}

/** The license a setup session may act on, or null. Re-checks the link on every use, so revoking a link ends its sessions. */
export async function resolveSetupSession(deps: Deps, cookie: string | undefined | null): Promise<{ licenseId: string; linkId: string } | null> {
  const s = deps.secrets.verify<SetupSession>("setup-session", cookie, nowMs(deps));
  if (!s) return null;
  const link = await deps.repo.getLink(s.k);
  if (!link || link.license_id !== s.l || link.revoked_at || Date.parse(link.expires_at) <= nowMs(deps)) return null;
  const license = await deps.commerce.getLicense(s.l);
  if (!license || license.status === "revoked") return null;
  return { licenseId: license.id, linkId: link.id };
}
