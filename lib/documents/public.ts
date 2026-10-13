import "server-only";
import { headers } from "next/headers";
import { clientAddress, hashClient, windowStart } from "../commerce/rate-limit.ts";
import { ValidationError } from "../commerce/validation.ts";
import { rateLimitStore } from "../rate-limit-server";
import { automationDeps } from "../automation/server";
import { documentDeps, tenantForLink } from "./server";
import { resolveLink, type LinkState } from "./service.ts";
import type { TenantProfile } from "./types.ts";

// Public secure links (/d/… and /sign/…). The token is the credential: it names one delivery, and that delivery's
// tenant is the only tenant the request acts as.

export type LinkContext = { tenantId: string; deps: ReturnType<typeof documentDeps>; state: LinkState; profile: TenantProfile | null };

export async function linkContext(token: string): Promise<LinkContext | null> {
  const tenantId = await tenantForLink(token).catch(() => null);
  if (!tenantId) return null;
  const deps = documentDeps(tenantId);
  const [state, profile] = await Promise.all([resolveLink(deps, token), deps.repo.getProfile().catch(() => null)]);
  return { tenantId, deps, state, profile };
}

export const linkAutomation = (tenantId: string) => automationDeps(tenantId);

/** A keyed hash of the visitor's address (never the address), and a per-visitor limit on link actions. */
export async function visitor(limitPerMinute: number): Promise<{ ipHash: string | null; userAgent: string | null }> {
  const h = await headers();
  const ip = clientAddress(h.get("x-forwarded-for"));
  const ipHash = ip ? hashClient(ip, process.env.MONARCH_ENCRYPTION_KEY) : null;
  if (ipHash) {
    const hits = await rateLimitStore().hit(`doclink:ip:${ipHash}`, windowStart(Date.now()).startIso).catch(() => 0);
    if (hits > limitPerMinute) throw new ValidationError("Too many attempts. Please wait a minute and try again.");
  }
  return { ipHash: ipHash ? ipHash.slice(0, 32) : null, userAgent: h.get("user-agent")?.slice(0, 300) ?? null };
}

/** Whether a signature request can still be signed right now. */
export function canStillSign(signature: { status: string; expires_at: string }) {
  return (signature.status === "sent" || signature.status === "viewed") && new Date(signature.expires_at).getTime() >= Date.now();
}

export const STATE_TEXT = {
  not_found: "This link is not valid. Check that you copied the whole address from your email.",
  expired: "This link has expired. Ask the sender to send you a new one.",
  revoked: "This link is no longer available. Ask the sender if you still need the document.",
} as const;
