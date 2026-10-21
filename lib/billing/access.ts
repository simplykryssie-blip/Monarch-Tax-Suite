import type { PlanKey } from "./plans.ts";

// What a workspace may do, given the state of its subscription. The states and the timeline below are the owner's rules:
//   unpaid at renewal → suspended (grace period) → read-only → cancelled → data kept 90 days, then deleted.
// The day counts are the defaults in force until the owner changes them: they are the only place they are written.

export const GRACE_DAYS = 7;
export const READ_ONLY_DAYS = 14;
export const RETENTION_DAYS = 90;
/** Days before renewal when the card is checked and, if something is wrong, the customer is warned. */
export const PRECHECK_MARKS = [7, 5, 3] as const;

export type SubStatus = "active" | "suspended" | "read_only" | "paused" | "canceled" | "internal";
export type Subscription = {
  tenant_id: string; plan: PlanKey; status: SubStatus; stripe_customer_id: string | null; stripe_subscription_id: string | null;
  current_period_end: string | null; cancel_at_period_end: boolean; paused_from_plan: PlanKey | null;
  suspended_at: string | null; canceled_at: string | null; delete_after: string | null; precheck_mark: number | null; terms_version?: string | null;
  created_at: string; updated_at: string;
};

/**
 * - full: everything works.
 * - grace: payment is late. Everything works except sending messages, and a banner asks for payment.
 * - read_only: look and export, change nothing.
 * - contacts_only: a paused plan. Clients and contacts only.
 * - closed: cancelled. Only the billing page, to come back.
 */
export type AccessLevel = "full" | "grace" | "read_only" | "contacts_only" | "closed";

/** A workspace with no subscription record (made before billing existed, or by an administrator) is not billed here. */
export function accessOf(sub: Pick<Subscription, "status"> | null): AccessLevel {
  if (!sub) return "full";
  switch (sub.status) {
    case "active": case "internal": return "full";
    case "suspended": return "grace";
    case "read_only": return "read_only";
    case "paused": return "contacts_only";
    case "canceled": return "closed";
  }
}

/** Outbound email, texts and automations run only while the account is in good standing. */
export const mayContactClients = (level: AccessLevel) => level === "full";

const DAY = 86_400_000;
const at = (iso: string) => Date.parse(iso);

/** The next change the clock calls for on a late-paying account, or null. */
export function nextStep(sub: Pick<Subscription, "status" | "suspended_at">, now: Date): "read_only" | "canceled" | null {
  if (!sub.suspended_at) return null;
  const late = (now.getTime() - at(sub.suspended_at)) / DAY;
  if (sub.status === "suspended" && late >= GRACE_DAYS + READ_ONLY_DAYS) return "canceled";
  if (sub.status === "suspended" && late >= GRACE_DAYS) return "read_only";
  if (sub.status === "read_only" && late >= GRACE_DAYS + READ_ONLY_DAYS) return "canceled";
  return null;
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
