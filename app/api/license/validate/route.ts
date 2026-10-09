import { hostFromHeader } from "@/lib/commerce/embed.ts";
import { normalizeDomain } from "@/lib/commerce/validation.ts";
import { loadEmbedDecision } from "@/lib/embed-server";

// Platform-neutral license check for any embedding method (iframe, script,
// server-side). Takes only the public embed id and a domain; returns no
// customer or license details.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  let host: string | null = null;
  const domainParam = url.searchParams.get("domain");
  try {
    host = domainParam ? normalizeDomain(domainParam) : hostFromHeader(request.headers.get("origin") ?? request.headers.get("referer"));
  } catch {
    return Response.json({ valid: false, reason: "invalid_domain" }, { status: 400, headers: cors });
  }
  if (!host) return Response.json({ valid: false, reason: "domain_required" }, { status: 400, headers: cors });
  const decision = await loadEmbedDecision(id, host);
  return Response.json(decision.ok ? { valid: true } : { valid: false, reason: decision.reason }, { headers: cors });
}

const cors = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
