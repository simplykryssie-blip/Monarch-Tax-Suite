import { randomBytes } from "node:crypto";
import type { AuthorizedDomain, License } from "./types.ts";

// Platform-neutral license validation for embedded calculators. The decision
// depends only on the license status and its authorized domains, never on the
// hosting platform. Browsers enforce the domain binding through the
// Content-Security-Policy frame-ancestors directive built here.

export type EmbedDecision =
  | { ok: true; allowedHosts: string[] }
  | { ok: false; reason: "not_found" | "inactive" | "no_domains" | "domain_not_authorized"; allowedHosts: string[] };

/** Public, non-secret embed identifier (safe to place in page HTML). */
export function generateEmbedId(): string {
  return `emb_${randomBytes(16).toString("base64url")}`;
}

export const EMBED_ID_PATTERN = /^emb_[A-Za-z0-9_-]{16,64}$/;

/** Authorized hosts, each also allowing its www./apex counterpart. */
export function allowedHosts(domains: AuthorizedDomain[]): string[] {
  const hosts = new Set<string>();
  for (const d of domains) {
    if (d.status !== "active") continue;
    hosts.add(d.domain);
    hosts.add(d.domain.startsWith("www.") ? d.domain.slice(4) : `www.${d.domain}`);
  }
  return [...hosts].sort();
}

/** Hostname of a Referer/Origin header value, or null. */
export function hostFromHeader(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Decides whether a calculator may be shown. `requestHost` is the embedding
 * page's host when the browser reports it (Referer); when it is unknown the
 * browser-enforced frame-ancestors policy still restricts where it can render.
 */
export function decideEmbed(license: License | null, domains: AuthorizedDomain[], requestHost: string | null): EmbedDecision {
  if (!license) return { ok: false, reason: "not_found", allowedHosts: [] };
  const hosts = allowedHosts(domains);
  if (license.status !== "active") return { ok: false, reason: "inactive", allowedHosts: [] };
  if (hosts.length === 0) return { ok: false, reason: "no_domains", allowedHosts: [] };
  if (requestHost && !hosts.includes(requestHost)) return { ok: false, reason: "domain_not_authorized", allowedHosts: hosts };
  return { ok: true, allowedHosts: hosts };
}

/** CSP frame-ancestors value: only authorized HTTPS origins may frame the calculator. */
export function frameAncestors(decision: EmbedDecision): string {
  if (!decision.ok && decision.reason !== "domain_not_authorized") return "frame-ancestors 'none'";
  return decision.allowedHosts.length ? `frame-ancestors ${decision.allowedHosts.map((h) => `https://${h}`).join(" ")}` : "frame-ancestors 'none'";
}

/**
 * Public-facing reason for a failed check. Only "domain_not_authorized" is
 * distinguished (an integrator needs it); an unknown id, an inactive license
 * and a license with no domains all look the same, so the endpoint does not
 * reveal a license's state to anyone who merely holds the public embed id.
 */
export function publicReason(reason: Exclude<EmbedDecision, { ok: true }>["reason"]): "domain_not_authorized" | "unavailable" {
  return reason === "domain_not_authorized" ? "domain_not_authorized" : "unavailable";
}

/**
 * True when the browser reports a top-level page visit (Sec-Fetch-Dest:
 * document) rather than a frame. The licensed calculator is only offered
 * inside an authorized site's frame, so opening the embed URL directly in a
 * browser tab is refused. Browsers that send no header are not blocked here;
 * the frame-ancestors policy and Referer check still apply to them.
 */
export function isTopLevelNavigation(secFetchDest: string | null | undefined): boolean {
  return secFetchDest?.toLowerCase() === "document";
}

export const EMBED_MESSAGES:Record<Exclude<EmbedDecision, { ok: true }>["reason"], string> = {
  not_found: "This calculator embed code is not recognized.",
  inactive: "This calculator license is not active. Please contact Monarch Tax Suite.",
  no_domains: "This calculator license has no authorized website yet. Please contact Monarch Tax Suite.",
  domain_not_authorized: "This website is not authorized to display this calculator.",
};
