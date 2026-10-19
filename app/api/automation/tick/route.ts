import { timingSafeEqual } from "node:crypto";
import { automationDeps } from "@/lib/automation/server";
import { runDue } from "@/lib/automation/engine.ts";
import { appointmentDeps } from "@/lib/appointments/server";
import { sendDueReminders } from "@/lib/appointments/service.ts";
import { runTriggerSweeps } from "@/lib/automation/emit";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { rotate, runTick, type TickJob } from "@/lib/scheduler/tick.ts";
import { campaignDeps } from "@/lib/campaigns/server";
import { runCampaigns } from "@/lib/campaigns/service.ts";
import { SupabaseBillingRepo } from "@/lib/billing/supabase-repo";
import { platformClient } from "@/lib/supabase/service";

// The five-minute tick (vercel.json). Same protection as the daily endpoint: CRON_SECRET as a Bearer token.
// It carries the time-sensitive work; the slow once-a-day sweeps stay on /api/automation/run.
export const maxDuration = 60;

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The jobs every tenant gets each tick. Resumed workflow steps join these in Phase 5b. */
const JOBS: TickJob[] = [
  { name: "workflowsDue", run: async (tenantId) => (await runDue(automationDeps(tenantId), 25)).processed },
  { name: "triggerSweeps", run: (tenantId) => runTriggerSweeps(tenantId) },
  { name: "appointmentReminders", run: async (tenantId) => { const r = await sendDueReminders(appointmentDeps(tenantId)); return r.sent + r.failed + r.skipped; } },
  { name: "campaigns", run: (tenantId) => runCampaigns(campaignDeps(tenantId)) },
];

async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return new Response("Scheduler is not configured", { status: 503 });
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!given || !same(given, secret)) return new Response("Unauthorized", { status: 401 });
  try {
    const { data, error } = await platformClient("scheduler_tick").from("tenants").select("id").order("created_at");
    if (error) throw new Error(error.message);
    // Messages and automations stop for workspaces whose payment is late, paused or cancelled. If the billing table can't be
    // read, nothing is skipped (a billing outage must not stop everyone's reminders).
    const restricted = await new SupabaseBillingRepo().restrictedTenantIds().catch(() => new Set<string>());
    const ids = ((data ?? []) as { id: string }[]).map((t) => t.id).filter((id) => !restricted.has(id));
    const report = await runTick(rotate(ids, Math.floor(Date.now() / 300_000)), JOBS, { log: (l) => console.error(l) });
    return Response.json(report);
  } catch (e) {
    console.error(`automation-tick: ${sanitizeError(e, 160)}`);
    return new Response("Tick failed", { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
