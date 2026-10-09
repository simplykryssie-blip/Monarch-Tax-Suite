import { after, NextResponse, type NextRequest } from "next/server";
import { processDueLeads, submitLead, type LeadSubmission } from "@/lib/crm/leads.ts";
import { crmDeps } from "@/lib/crm/server";
import { NotConfiguredError } from "@/lib/crm/connection.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";

// Public endpoint for the lead form inside licensed calculator embeds. The
// destination is resolved only from the signed embed token and the license's
// saved connection. Responses never include customer or connection details.

const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  // The form runs in our own embed page, so the browser sends our origin.
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
  const deps = crmDeps();
  try {
    const result = await submitLead(deps, body, { ip });
    if (!result.accepted) {
      return result.reason === "rate_limited"
        ? json({ error: "Too many submissions. Please try again later." }, 429)
        : json({ error: "This form is not accepting submissions right now." }, 503);
    }
    if (result.leadId) {
      const leadId = result.leadId;
      after(async () => {
        const lead = await deps.repo.getLead(leadId);
        if (lead) await processDueLeads(deps, { licenseId: lead.license_id, limit: 5 });
      });
    }
    return json({ ok: true });
  } catch (e) {
    if (e instanceof NotConfiguredError) return json({ error: "This form is not accepting submissions right now." }, 503);
    if (e instanceof ValidationError) return json({ error: e.message }, 400);
    console.error("Lead submission failed:", e instanceof Error ? e.name : "unknown");
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
}
