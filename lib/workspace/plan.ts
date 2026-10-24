import { ValidationError } from "../commerce/validation.ts";

// Payment plans: an invoice split into scheduled installments. Only the schedule is stored (a due date and an amount for
// each); which installments are paid is worked out from how much the invoice has been paid, oldest first, so a payment
// from any source (Stripe, cash, a bank statement) counts the same way and the two can never disagree.

export type Installment = { position: number; due_on: string; amount_cents: number };
export type InstallmentState = "paid" | "partial" | "overdue" | "upcoming";
export type AllocatedInstallment = Installment & { paid_cents: number; state: InstallmentState };
export const PLAN_EVERY = { week: "Every week", "2weeks": "Every 2 weeks", month: "Every month" } as const;
export type PlanEvery = keyof typeof PLAN_EVERY;
export const MAX_INSTALLMENTS = 12;

const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));

/** A date moved on by days, or by whole months (the day is kept, or the month's last day when it is shorter). */
export function addToDay(day: string, every: PlanEvery, steps: number): string {
  const [y, m, d] = day.split("-").map(Number);
  if (every === "month") {
    const target = new Date(Date.UTC(y, m - 1 + steps, 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(d, last));
    return target.toISOString().slice(0, 10);
  }
  return new Date(Date.UTC(y, m - 1, d + steps * (every === "week" ? 7 : 14))).toISOString().slice(0, 10);
}

/** Splits a total into equal payments; any odd cents go on the first payments so the last is never larger. */
export function splitPlan(totalCents: number, count: number, firstDue: string, every: PlanEvery): Installment[] {
  const base = Math.floor(totalCents / count);
  const extra = totalCents - base * count;
  return Array.from({ length: count }, (_, n) => ({ position: n + 1, due_on: addToDay(firstDue, every, n), amount_cents: base + (n < extra ? 1 : 0) }));
}

/** A plan from the form: how many payments, the first due date, how often. Needs at least 2 payments of at least 50 cents. */
export function checkPlan(raw: Record<string, unknown>, totalCents: number): Installment[] | null {
  const count = Number(typeof raw.plan_count === "string" ? raw.plan_count : raw.plan_count ?? 0);
  if (!count || count === 1) return null;
  if (!Number.isInteger(count) || count < 2 || count > MAX_INSTALLMENTS) throw new ValidationError(`A payment plan can have 2 to ${MAX_INSTALLMENTS} payments.`);
  const first = typeof raw.plan_first_due === "string" ? raw.plan_first_due : "";
  if (!isDay(first)) throw new ValidationError("Choose the date the first payment is due.");
  const every: PlanEvery = raw.plan_every === "week" || raw.plan_every === "2weeks" ? raw.plan_every : "month";
  const plan = splitPlan(totalCents, count, first, every);
  if (plan.some((p) => p.amount_cents < 50)) throw new ValidationError("Each payment must be at least $0.50. Use fewer payments.");
  return plan;
}

/** Counts what the invoice has been paid against the installments, oldest first. */
export function allocate(plan: Installment[], paidCents: number, today: string): AllocatedInstallment[] {
  let left = paidCents;
  return [...plan].sort((a, b) => a.position - b.position).map((p) => {
    const paid = Math.min(p.amount_cents, Math.max(0, left));
    left -= paid;
    const state: InstallmentState = paid >= p.amount_cents ? "paid" : p.due_on < today ? "overdue" : paid > 0 ? "partial" : "upcoming";
    return { ...p, paid_cents: paid, state };
  });
}

/** What the next online payment should be: the unpaid part of the earliest unpaid installment, or null when there is no plan. */
export function nextPaymentCents(plan: Installment[], paidCents: number): number | null {
  if (plan.length === 0) return null;
  const next = allocate(plan, paidCents, "0000-00-00").find((p) => p.paid_cents < p.amount_cents);
  return next ? next.amount_cents - next.paid_cents : null;
}
