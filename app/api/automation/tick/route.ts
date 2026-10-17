import { timingSafeEqual } from "node:crypto";
import { automationDeps } from "@/lib/automation/server";
import { runDue } from "@/lib/automation/engine.ts";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { rotate, runTick, type TickJob } from "@/lib/scheduler/tick.ts";
import { platformClient } from "@/lib/supabase/service";

// The five-minute tick (vercel.json). Same protection as the daily endpoint: CRON_SECRET as a Bearer token.
// It carries the time-sensitive work; the slow once-a-day sweeps stay on /api/automation/run.
export const maxDuration = 60;

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The jobs every tenant gets each tick. Phase 5 adds appointment reminders and resumed workflow steps here. */
const JOBS: TickJob[] = [
  { name: "workflowsDue", run: async (tenantId) => (await runDue(automationDeps(tenantId), 25)).processed },
];

async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return new Response("Scheduler is not configured", { status: 503 });
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!given || !same(given, secret)) return new Response("Unauthorized", { status: 401 });
  try {
    const { data, error } = await platformClient("scheduler_tick").from("tenants").select("id").order("created_at");
    if (error) throw new Error(error.message);
    const ids = ((data ?? []) as { id: string }[]).map((t) => t.id);
    const report = await runTick(rotate(ids, Math.floor(Date.now() / 300_000)), JOBS, { log: (l) => console.error(l) });
    return Response.json(report);
  } catch (e) {
    console.error(`automation-tick: ${sanitizeError(e, 160)}`);
    return new Response("Tick failed", { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
