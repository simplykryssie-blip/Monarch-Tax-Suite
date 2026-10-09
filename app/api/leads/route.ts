import { NextResponse, type NextRequest } from "next/server";
import { forwardLead, type LeadSubmission } from "@/lib/crm/leads.ts";
import { crmDeps } from "@/lib/crm/server";
import { NotConfiguredError } from "@/lib/crm/connection.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";

// Public endpoint for the lead form inside licensed calculator embeds. The
// submission is forwarded to the buyer's own destination during this request
// and not stored. Request bodies are never logged.

export const maxDuration = 30;
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  let originHost: string | null = null;
  try {
    originHost = new URL(request.headers.get("origin") ?? "").host;
  } catch {
    originHost = null;
  }
  if (!originHost || originHost !== request.headers.get("host")) return json({ error: "Not allowed." }, 403);
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "Unsupported request." }, 415);
  const raw = await request.text();
  if (raw.length > 8000) return json({ error: "Request too large." }, 413);
  let body: LeadSubmission;
  try {
    body = JSON.parse(raw) as LeadSubmission;
  } catch {
    return json({ error: "Unsupported request." }, 400);
  }
  const ip = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  try {
    const result = await forwardLead(crmDeps(), body, { ip });
    if (result.ok) return json({ ok: true });
    if (result.reason === "rate_limited") return json({ error: "Too many submissions. Please try again later." }, 429);
    if (result.reason === "unavailable") return json({ error: "This form is not accepting submissions right now." }, 503);
    return json({ error: "Your details could not be delivered right now. Nothing was saved. Please try again in a moment.", retryable: result.retryable }, 502);
  } catch (e) {
    if (e instanceof NotConfiguredError) return json({ error: "This form is not accepting submissions right now." }, 503);
    if (e instanceof ValidationError) return json({ error: e.message }, 400);
    console.error("Lead forwarding error:", e instanceof Error ? e.name : "unknown");
    return json({ error: "Your details could not be delivered right now. Nothing was saved. Please try again.", retryable: true }, 500);
  }
}
