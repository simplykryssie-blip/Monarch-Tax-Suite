import { hostFromHeader, publicReason } from "@/lib/commerce/embed.ts";
import { checkRate, clientAddress, hashClient } from "@/lib/commerce/rate-limit.ts";
import { normalizeDomain } from "@/lib/commerce/validation.ts";
import { loadEmbedDecision } from "@/lib/embed-server";
import { rateLimitStore } from "@/lib/rate-limit-server";

// Platform-neutral license check for any embedding method (iframe, script,
// server-side). Takes only the public embed id and a domain; returns no
// customer or license details, and does not reveal whether an unknown id,
// an inactive license or a license without domains was the cause of a failure.
// Requests are rate limited per client address and per embed id (durable
// counters in the database, so serverless restarts do not reset them).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  const limit = await checkRate(rateLimitStore(), {
    clientHash: (() => {
      const ip = clientAddress(request.headers.get("x-forwarded-for"));
      return ip ? hashClient(ip, process.env.MONARCH_ENCRYPTION_KEY) : null;
    })(),
    embedId: id && /^emb_[A-Za-z0-9_-]{16,64}$/.test(id) ? id : null,
    onError: (reason) => console.warn(`license-validate: ${reason}`),
  });
  if (!limit.allowed) {
    return Response.json(
      { valid: false, reason: "rate_limited" },
      { status: 429, headers: { ...cors, "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let host: string | null = null;
  const domainParam = url.searchParams.get("domain");
  try {
    host = domainParam ? normalizeDomain(domainParam) : hostFromHeader(request.headers.get("origin") ?? request.headers.get("referer"));
  } catch {
    return Response.json({ valid: false, reason: "invalid_domain" }, { status: 400, headers: cors });
  }
  if (!host) return Response.json({ valid: false, reason: "domain_required" }, { status: 400, headers: cors });
  const decision = await loadEmbedDecision(id, host);
  return Response.json(decision.ok ? { valid: true } : { valid: false, reason: publicReason(decision.reason) }, { headers: cors });
}

const cors = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
