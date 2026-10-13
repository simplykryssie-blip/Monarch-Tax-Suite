import { timingSafeEqual } from "node:crypto";
import { automationDeps } from "@/lib/automation/server";
import { runDue } from "@/lib/automation/engine.ts";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { runRenewalSweep } from "@/lib/efin/renewals";
import { runSignatureSweep } from "@/lib/documents/notify.ts";
import { formDeps } from "@/lib/forms/server";
import { sweepForms } from "@/lib/forms/service.ts";
import { retryNotifications } from "@/lib/forms/after.ts";

// Scheduler endpoint: processes due retries. Protected by CRON_SECRET (Vercel Cron sends it as
// "Authorization: Bearer <CRON_SECRET>"; any other scheduler can do the same). It sends no email by itself:
// it only continues executions that already exist.
export const maxDuration = 60;

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return new Response("Scheduler is not configured", { status: 503 });
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!given || !same(given, secret)) return new Response("Unauthorized", { status: 401 });
  try {
    const deps = automationDeps();
    const { processed } = await runDue(deps, 25);
    // Signature requests: expiry notices and reminders. Isolated like the EFIN sweep.
    let signatures: unknown = null;
    try {
      signatures = deps.documents ? await runSignatureSweep(deps, deps.documents) : { skipped: "document links are not configured" };
    } catch (e) {
      console.error(`documents-sweep: ${sanitizeError(e, 160)}`);
      signatures = { error: "Signature sweep failed or is not set up yet" };
    }
    // Forms: expired drafts removed, submission PDFs and firm notices that failed retried. Isolated the same way.
    let forms: unknown = null;
    try {
      const f = formDeps();
      forms = await sweepForms(f);
      await retryNotifications(deps, f, await f.repo.listUnnotified(new Date(Date.now() - 2 * 86_400_000).toISOString(), 20));
    } catch (e) {
      console.error(`forms-sweep: ${sanitizeError(e, 160)}`);
      forms = { error: "Form sweep failed or is not set up yet" };
    }
    // EFIN renewal sweep: reconciles renewal tasks and sends due reminders. Isolated so a missing EFIN migration cannot break retries.
    let efin: unknown = null;
    try {
      efin = await runRenewalSweep();
    } catch (e) {
      console.error(`efin-renewals: ${sanitizeError(e, 160)}`);
      efin = { error: "EFIN renewal sweep failed or is not set up yet" };
    }
    return Response.json({ processed, efin, signatures, forms });
  } catch (e) {
    console.error(`automation-run: ${sanitizeError(e, 160)}`);
    return new Response("Run failed", { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
