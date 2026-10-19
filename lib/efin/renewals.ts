import "server-only";
import { automationConfig, automationDeps, integrationStatus } from "../automation/server";
import type { EmailSender } from "../automation/email.ts";
import { esc } from "../automation/template.ts";
import { sanitizeError } from "../automation/sanitize.ts";
import { tenantDb } from "../admin";
import { assignmentLapsed, daysUntil, dueReminderStage, planRenewalTasks, todayIso } from "./rules.ts";
import { audit } from "./service";
import type { AssignmentRow, EfinRow, RenewalTaskRow } from "./types.ts";

// Daily renewal sweep. Safe to run any number of times a day:
//  1. renewal tasks are reconciled with the EFIN records (created, re-dated, or cancelled when tracking stops);
//  2. an EFIN that passes its recorded deadline is moved to "renewal review" (a compliance review, never an automatic
//     invalidation) and its task becomes overdue;
//  3. one reminder per task + deadline + stage + recipient is recorded in notification_events BEFORE sending, so a rerun
//     or a retry cannot send twice; failures are kept (attempts, error) and retried up to MAX_ATTEMPTS.
// The dashboard task exists whether or not any email succeeds.

const MAX_ATTEMPTS = 4;
const SYSTEM = { id: "00000000-0000-0000-0000-000000000000", email: "system@renewal-sweep" };

export type SweepSummary = { tasksCreated: number; tasksUpdated: number; tasksCancelled: number; reviewsOpened: number; assignmentsExpired: number; reminders: { sent: number; failed: number; skipped: number; alreadySent: number }; emailReady: boolean };

function reminderEmail(task: RenewalTaskRow, days: number, last4: string, link: string) {
  const when = days < 0 ? `passed ${-days} day${days === -1 ? "" : "s"} ago` : days === 0 ? "is today" : `is in ${days} day${days === 1 ? "" : "s"}`;
  const subject = days < 0 ? `Compliance review: EFIN ending ${last4} is past its recorded deadline` : `EFIN ending ${last4}: renewal deadline ${when}`;
  const body = `The recorded renewal deadline for the EFIN ending ${last4} (${task.due_on}) ${when}.`;
  const caution = days < 0 ? "Please confirm its current status with the IRS e-Services account. Monarch has not changed or invalidated anything automatically." : "Please confirm the renewal with the IRS e-Services account and record the new verified date in Monarch.";
  const text = `${body}\n\n${caution}\n\nOpen the task: ${link}\n\nThis date is what was recorded in Monarch, not a live IRS status.`;
  const html = `<div style="font-family:Inter,Arial,sans-serif;color:#111;max-width:520px"><h2 style="font-family:Georgia,serif;margin:0 0 12px">EFIN renewal reminder</h2><p>${esc(body)}</p><p>${esc(caution)}</p><p><a href="${esc(link)}" style="display:inline-block;background:#111;color:#fff;border-radius:99px;padding:10px 20px;text-decoration:none">Open the task</a></p><p style="color:#666;font-size:12px">This date is what was recorded in Monarch, not a live IRS status.</p></div>`;
  return { subject, text, html };
}

export async function runRenewalSweep(opts: { today?: string; sender?: EmailSender; origin?: string } = {}): Promise<SweepSummary> {
  const db = tenantDb();
  const today = opts.today ?? todayIso();
  const sender = opts.sender ?? automationDeps().email;
  const origin = opts.origin ?? process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "https://app.monarchtaxsuite.com";
  const summary: SweepSummary = { tasksCreated: 0, tasksUpdated: 0, tasksCancelled: 0, reviewsOpened: 0, assignmentsExpired: 0, reminders: { sent: 0, failed: 0, skipped: 0, alreadySent: 0 }, emailReady: false };

  // Lapsed assignments (end date passed) expire; revoked/suspended ones are left alone.
  const { data: acts } = await db.from("efin_assignments").select("id, state, effective_to, organization_id, efin_id").eq("state", "active").not("effective_to", "is", null);
  for (const a of (acts ?? []) as Pick<AssignmentRow, "id" | "state" | "effective_to" | "organization_id" | "efin_id">[]) {
    if (!assignmentLapsed(a, today)) continue;
    const { data } = await db.from("efin_assignments").update({ state: "expired", ended_at: new Date().toISOString(), end_reason: "End date passed" }).eq("id", a.id).eq("state", "active").select("id").maybeSingle();
    if (data) { summary.assignmentsExpired++; await audit(SYSTEM, { type: "assignment.expire", targetType: "assignment", targetId: a.id, organizationId: a.organization_id, changes: { previous_state: "active", new_state: "expired", efin_id: a.efin_id }, reason: "End date passed" }); }
  }

  const [{ data: efinData }, { data: taskData }] = await Promise.all([
    db.from("efin_records").select("id, organization_id, efin_last4, recorded_expiration, expiration_verified, internal_status, archived_at, ero_person_id"),
    db.from("renewal_tasks").select("*").in("status", ["open", "urgent", "escalated", "overdue"]),
  ]);
  const efins = (efinData ?? []) as (Pick<EfinRow, "id" | "organization_id" | "efin_last4" | "recorded_expiration" | "expiration_verified" | "internal_status" | "archived_at" | "ero_person_id">)[];
  let tasks = (taskData ?? []) as RenewalTaskRow[];

  for (const p of planRenewalTasks(efins, tasks, today)) {
    if (p.kind === "create") {
      const { error } = await db.from("renewal_tasks").insert({ subject_type: "efin", subject_id: p.efinId, organization_id: p.organizationId, title: p.title, due_on: p.dueOn, original_due_on: p.dueOn, status: "open" });
      if (!error) summary.tasksCreated++; // a unique violation just means another run created it first
    } else if (p.kind === "update") {
      await db.from("renewal_tasks").update({ due_on: p.dueOn, status: p.status }).eq("id", p.taskId);
      summary.tasksUpdated++;
    } else {
      await db.from("renewal_tasks").update({ status: "cancelled", completion_note: p.reason }).eq("id", p.taskId);
      summary.tasksCancelled++;
    }
  }
  // Re-read so created tasks (and their ids) take part in the reminder pass, then bring statuses up to date.
  const refreshed = await db.from("renewal_tasks").select("*").in("status", ["open", "urgent", "escalated", "overdue"]);
  tasks = (refreshed.data ?? []) as RenewalTaskRow[];
  for (const t of tasks) {
    const left = daysUntil(t.due_on, today);
    if (left < 0 && t.subject_type === "efin") {
      const { data } = await db.from("efin_records").update({ internal_status: "renewal_review" }).eq("id", t.subject_id).eq("internal_status", "active").select("id").maybeSingle();
      if (data) { summary.reviewsOpened++; await audit(SYSTEM, { type: "efin.renewal_review_opened", targetType: "efin", targetId: t.subject_id, organizationId: t.organization_id, changes: { previous_status: "active", new_status: "renewal_review", due_on: t.due_on }, reason: "Recorded deadline passed" }); }
    }
  }

  // Reminders
  const cfg = automationConfig();
  summary.emailReady = integrationStatus().resend.configured;
  const eroIds = efins.map((e) => e.ero_person_id).filter(Boolean) as string[];
  const people = eroIds.length ? ((await db.from("people").select("id, email").in("id", eroIds)).data ?? []) as { id: string; email: string | null }[] : [];
  for (const t of tasks) {
    if (t.subject_type !== "efin") continue;
    const stage = dueReminderStage(t.due_on, today);
    if (stage === null) continue;
    const efin = efins.find((e) => e.id === t.subject_id);
    if (!efin) continue;
    const ero = people.find((p) => p.id === efin.ero_person_id)?.email;
    const recipients = [...new Set([cfg.supportRecipient, ...(stage <= 14 && ero ? [ero] : [])].map((r) => r.toLowerCase()))];
    for (const recipient of recipients) {
      const kind = stage === 0 ? "escalation" : "renewal_reminder";
      await db.from("notification_events").upsert({ task_id: t.id, kind, due_on: t.due_on, stage_days: stage, recipient, status: "queued" }, { onConflict: "task_id,due_on,stage_days,recipient,channel", ignoreDuplicates: true });
      const { data: ev } = await db.from("notification_events").select("id, status, attempts").eq("task_id", t.id).eq("due_on", t.due_on).eq("stage_days", stage).eq("recipient", recipient).eq("channel", "email").single();
      if (!ev) continue;
      if (ev.status === "sent" || ev.status === "skipped") { summary.reminders.alreadySent++; continue; }
      if ((ev.attempts as number) >= MAX_ATTEMPTS) { summary.reminders.skipped++; continue; }
      // Claim the attempt first (compare-and-set on attempts) so two overlapping runs cannot both send.
      const claim = await db.from("notification_events").update({ attempts: (ev.attempts as number) + 1 }).eq("id", ev.id).eq("attempts", ev.attempts).select("id").maybeSingle();
      if (!claim.data) { summary.reminders.alreadySent++; continue; }
      const m = reminderEmail(t, daysUntil(t.due_on, today), efin.efin_last4, `${origin}/efin/renewals`);
      const res = await sender.send({ to: recipient, ...m, idempotencyKey: `efin-renewal:${ev.id}` });
      if (res.ok) { await db.from("notification_events").update({ status: "sent", provider_message_id: res.id, error: null }).eq("id", ev.id); summary.reminders.sent++; }
      else { await db.from("notification_events").update({ status: "failed", error: sanitizeError(res.message, 300) }).eq("id", ev.id); summary.reminders.failed++; }
    }
  }
  return summary;
}
