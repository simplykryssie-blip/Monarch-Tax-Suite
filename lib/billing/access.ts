import type { PlanKey } from "./plans.ts";

// What a workspace may do, given the state of its subscription. The states and the timeline below are the owner's rules:
//   a renewal payment fails → read-only at once (the Billing page still works, so the card can be fixed) → payment is
//   retried and the owner warned for up to LATE_DAYS → still unpaid: cancelled → data kept 90 days, then deleted.
// The day counts are the defaults in force until the owner changes them: they are the only place they are written.

/** Days from a failed renewal until an unpaid account is cancelled. Retries and warning emails run inside this window. */
export const LATE_DAYS = 14;
/** Days after a failed renewal when a reminder email goes out (the last one is the final notice before cancelling). */
export const LATE_REMINDER_DAYS = [7, 12] as const;
export const RETENTION_DAYS = 90;
/** Days before renewal when the card is checked and, if something is wrong, the customer is warned. */
export const PRECHECK_MARKS = [7, 5, 3] as const;

/** "suspended" is the old name for a late account before it became read-only at once; rows may still carry it and are treated as read-only. */
export type SubStatus = "active" | "suspended" | "read_only" | "paused" | "canceled" | "internal";
export type Subscription = {
  tenant_id: string; plan: PlanKey; status: SubStatus; stripe_customer_id: string | null; stripe_subscription_id: string | null;
  current_period_end: string | null; cancel_at_period_end: boolean; paused_from_plan: PlanKey | null;
  suspended_at: string | null; canceled_at: string | null; delete_after: string | null; precheck_mark: number | null; terms_version?: string | null;
  created_at: string; updated_at: string;
};

/**
 * - full: everything works.
 * - read_only: payment is late. Look, change nothing, no messages go out; the Billing page still works.
 * - contacts_only: a paused plan. Clients and contacts only.
 * - closed: cancelled. Only the billing page, to come back.
 */
export type AccessLevel = "full" | "read_only" | "contacts_only" | "closed";

/** A workspace with no subscription record (made before billing existed, or by an administrator) is not billed here. */
export function accessOf(sub: Pick<Subscription, "status"> | null): AccessLevel {
  if (!sub) return "full";
  switch (sub.status) {
    case "active": case "internal": return "full";
    case "suspended": case "read_only": return "read_only";
    case "paused": return "contacts_only";
    case "canceled": return "closed";
  }
}

/** Outbound email, texts and automations run only while the account is in good standing. */
export const mayContactClients = (level: AccessLevel) => level === "full";

const DAY = 86_400_000;
const at = (iso: string) => Date.parse(iso);

/** Whole days since a late account's renewal failed, or null if it isn't late. */
export function daysLate(sub: Pick<Subscription, "status" | "suspended_at">, now: Date): number | null {
  if (!sub.suspended_at || (sub.status !== "suspended" && sub.status !== "read_only")) return null;
  return Math.max(0, Math.floor((now.getTime() - at(sub.suspended_at)) / DAY));
}

/** The change the clock calls for on a late-paying account (cancel once the window is over), or null. A missed sweep never skips the end. */
export function nextStep(sub: Pick<Subscription, "status" | "suspended_at">, now: Date): "canceled" | null {
  const late = daysLate(sub, now);
  return late !== null && late >= LATE_DAYS ? "canceled" : null;
}

/** The reminder due today for a late account (day 7 or day 12), or null. */
export function lateReminderDue(sub: Pick<Subscription, "status" | "suspended_at">, now: Date): number | null {
  const late = daysLate(sub, now);
  return late !== null && (LATE_REMINDER_DAYS as readonly number[]).includes(late) ? late : null;
}

export const deleteAfter = (canceledAt: Date) => new Date(canceledAt.getTime() + RETENTION_DAYS * DAY).toISOString();

/** Which pre-renewal check is due today (7, 5 or 3 days out), if it hasn't been done for this period. */
export function precheckDue(sub: Pick<Subscription, "status" | "current_period_end" | "precheck_mark">, now: Date): 7 | 5 | 3 | null {
  if (sub.status !== "active" || !sub.current_period_end) return null;
  const days = Math.ceil((at(sub.current_period_end) - now.getTime()) / DAY);
  // The nearest mark not yet passed, and not already done: a skipped day catches up on the next one.
  const mark = PRECHECK_MARKS.find((m) => days <= m && (sub.precheck_mark === null || sub.precheck_mark > m));
  return days > 0 && mark ? mark : null;
}

/** Days left of the retention period, or null if not cancelled. */
export function retentionDaysLeft(sub: Pick<Subscription, "delete_after">, now: Date): number | null {
  return sub.delete_after ? Math.max(0, Math.ceil((at(sub.delete_after) - now.getTime()) / DAY)) : null;
}
