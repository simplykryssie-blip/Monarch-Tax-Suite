import "server-only";
import { businessDeps } from "../calendar/server";
import { loadCalendar } from "../calendar/service.ts";
import { partsIn, ymdString } from "../calendar/business.ts";
import { tenantClient } from "../supabase/service";
import { currentTenantId } from "../tenants.ts";
import { automationDeps, safeEmit } from "./server";
import type { SubjectType } from "./types.ts";

// Where the business raises events for workflows: an invoice is paid, a return moves, a tag changes. Each call is a
// courtesy to the Automation Center and can never fail the action that raised it (safeEmit swallows problems).

export async function emitInvoicePaid(invoiceId: string, tenantId: string = currentTenantId()): Promise<void> {
  const { data } = await tenantClient(tenantId).from("invoices").select("id, status").eq("id", invoiceId).maybeSingle();
  if (data?.status !== "paid") return;
  await safeEmit({ type: "invoice.paid", key: `invoice.paid:${invoiceId}`, subject: { type: "invoice", id: invoiceId } }, tenantId);
}

export async function emitReturnStage(returnId: string, stageId: string): Promise<void> {
  await safeEmit({ type: "return.stage_changed", key: `return.stage_changed:${returnId}:${stageId}:${Math.floor(Date.now() / 60_000)}`, subject: { type: "return", id: returnId }, data: { stage_id: stageId } });
}

/** Work other than a tax return moved to a new stage. The workflow runs for the client the work belongs to. */
export async function emitWorkStage(workId: string, clientId: string, pipelineId: string, stageId: string): Promise<void> {
  await safeEmit({ type: "work.stage_changed", key: `work.stage_changed:${workId}:${stageId}:${Math.floor(Date.now() / 60_000)}`, subject: { type: "client", id: clientId }, data: { stage_id: stageId, pipeline_id: pipelineId, work_id: workId } });
}

/** Tags that were added or removed between two lists, one event each. Tags a workflow changes don't come through here. */
export async function emitTagChanges(subject: { type: Extract<SubjectType, "lead" | "client">; id: string }, before: string[], after: string[]): Promise<void> {
  const stamp = Math.floor(Date.now() / 60_000);
  for (const tag of after.filter((t) => !before.includes(t))) await safeEmit({ type: "contact.tag_added", key: `contact.tag_added:${subject.id}:${tag}:${stamp}`, subject, data: { tag } });
  for (const tag of before.filter((t) => !after.includes(t))) await safeEmit({ type: "contact.tag_removed", key: `contact.tag_removed:${subject.id}:${tag}:${stamp}`, subject, data: { tag } });
}

/**
 * The time-based triggers, checked on every five-minute tick but cheap: a tenant with no workflow on them costs one
 * query. Overdue invoices (once each) and the days-before/after-due-date workflows start from the office's morning.
 */
export async function runTriggerSweeps(tenantId: string): Promise<number> {
  const auto = automationDeps(tenantId);
  const wanted = (await auto.repo.listWorkflows()).filter((w) => w.status === "active" && (w.trigger_event === "invoice.overdue" || w.trigger_event === "date.return_due"));
  if (!wanted.length) return 0;
  const cal = await loadCalendar(businessDeps(tenantId));
  const here = partsIn(new Date(), cal.timeZone);
  if (here.h < 8) return 0; // not before the office's morning
  const today = ymdString(here);
  const db = tenantClient(tenantId);
  let raised = 0;

  if (wanted.some((w) => w.trigger_event === "invoice.overdue")) {
    const { data } = await db.from("invoices").select("id, due_on").eq("status", "sent").lt("due_on", today).limit(200);
    for (const inv of (data ?? []) as { id: string }[]) {
      await safeEmit({ type: "invoice.overdue", key: `invoice.overdue:${inv.id}`, subject: { type: "invoice", id: inv.id } });
      raised++;
    }
  }

  for (const offset of new Set(wanted.filter((w) => w.trigger_event === "date.return_due").map((w) => Number(w.trigger_config?.offset_days ?? 0)))) {
    // "N days after the due date" is the returns whose due date was N days ago.
    const target = new Date(`${today}T12:00:00Z`);
    target.setUTCDate(target.getUTCDate() - offset);
    const day = target.toISOString().slice(0, 10);
    const { data } = await db.from("client_returns").select("id").eq("due_on", day).is("filed_on", null).is("archived_at", null).limit(500);
    for (const r of (data ?? []) as { id: string }[]) {
      await safeEmit({ type: "date.return_due", key: `date.return_due:${r.id}:${offset}:${day}`, subject: { type: "return", id: r.id }, data: { offset_days: offset } });
      raised++;
    }
  }
  return raised;
}
