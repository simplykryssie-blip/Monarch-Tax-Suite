import type { AccessLevel, Subscription } from "./access.ts";
import { accessOf, daysLate, LATE_DAYS, retentionDaysLeft } from "./access.ts";
import { dollars, PAUSE_PLAN, PLANS, switchablePlans } from "./plans.ts";

// What the Billing page and the banner say about an account, in plain words.

// Central time, the platform's own, so dates match what the Stripe dashboard shows (a renewal late in the evening is the same day).
const when = (iso: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "America/Chicago" }).format(new Date(iso));

export type BillingView = {
  level: AccessLevel; planLabel: string; price: string; statusLabel: string; renews: string | null; banner: { tone: "warn" | "info"; text: string } | null;
  can: { portal: boolean; pause: boolean; resume: boolean; reactivate: boolean; changePlan: boolean };
};

function lateText(late: number | null): string {
  const left = late === null ? null : Math.max(0, LATE_DAYS - late);
  const when = left === null ? "" : left === 0 ? " Today is the last day to pay before the account is cancelled." : ` If it isn't paid in ${left} day${left === 1 ? "" : "s"} the account is cancelled.`;
  return `Your last payment didn't go through, so your workspace is read-only: you can look at everything but not change it, and no messages are sent.${when} Update your card in Billing to restore full access.`;
}

export function billingView(sub: Subscription | null, now: Date = new Date()): BillingView | null {
  if (!sub) return null;
  const level = accessOf(sub);
  const plan = PLANS[sub.plan];
  const paused = sub.status === "paused";
  const price = dollars(paused ? PAUSE_PLAN.priceCents : plan.priceCents);
  const statusLabel = { active: "Active", internal: "Included (no charge)", suspended: "Payment late: read-only", read_only: "Payment late: read-only", paused: "Paused", canceled: "Cancelled" }[sub.status];
  const left = retentionDaysLeft(sub, now);
  const banner =
    sub.status === "suspended" || sub.status === "read_only" ? { tone: "warn" as const, text: lateText(daysLate(sub, now)) }
    : sub.status === "paused" ? { tone: "info" as const, text: `Your plan is paused (${dollars(PAUSE_PLAN.priceCents)} a month). Your data is safe and you can work with clients and contacts. Resume any time in Billing.` }
    : sub.status === "canceled" ? { tone: "warn" as const, text: `Your account is cancelled. Your data is kept ${left === null ? "for 90 days" : `for ${left} more day${left === 1 ? "" : "s"}`} and then permanently deleted. You can come back, or pause instead, in Billing.` }
    : sub.cancel_at_period_end ? { tone: "info" as const, text: `Your plan ends on ${sub.current_period_end ? when(sub.current_period_end) : "the renewal date"}. Your data is then kept for 90 days.` }
    : null;
  return {
    level, planLabel: plan.label, price, statusLabel, renews: sub.current_period_end && sub.status !== "canceled" && sub.status !== "internal" ? when(sub.current_period_end) : null, banner,
    can: { portal: Boolean(sub.stripe_customer_id) && sub.status !== "internal", pause: sub.status === "active", resume: paused, reactivate: sub.status === "canceled", changePlan: sub.status === "active" && Boolean(sub.stripe_subscription_id) && switchablePlans(sub.plan).length > 0 },
  };
}
