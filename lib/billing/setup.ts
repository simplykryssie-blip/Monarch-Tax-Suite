import { PAUSE_PLAN, PLANS, PLAN_KEYS } from "./plans.ts";

// One-time setup of Verexa HQ's subscription products in Stripe: a monthly price for each plan and the pause plan, found by
// lookup key and created only when missing, plus the customer billing portal settings. Safe to run again.

export type PlanRow = { lookupKey: string; label: string; cents: number };
export const SETUP_PLANS: PlanRow[] = [
  ...PLAN_KEYS.map((k) => ({ lookupKey: PLANS[k].lookupKey, label: `Verexa HQ: ${PLANS[k].label}`, cents: PLANS[k].priceCents })),
  { lookupKey: PAUSE_PLAN.lookupKey, label: "Verexa HQ: Paused plan", cents: PAUSE_PLAN.priceCents },
];

export interface SetupStripe {
  findPrice(lookupKey: string): Promise<{ id: string; cents: number | null } | null>;
  createPlan(row: PlanRow): Promise<void>;
  ensurePortal(): Promise<"created" | "updated">;
}
export type SetupLine = { lookupKey: string; status: "exists" | "created" | "wrong_amount"; cents: number | null };
export type SetupReport = { plans: SetupLine[]; portal: "created" | "updated" | null };

/** What exists in Stripe now, without changing anything. */
export async function planStatus(stripe: Pick<SetupStripe, "findPrice">): Promise<{ lookupKey: string; label: string; wanted: number; found: number | null; exists: boolean }[]> {
  const out = [];
  for (const row of SETUP_PLANS) {
    const p = await stripe.findPrice(row.lookupKey);
    out.push({ lookupKey: row.lookupKey, label: row.label, wanted: row.cents, found: p?.cents ?? null, exists: p !== null });
  }
  return out;
}

export async function runBillingSetup(stripe: SetupStripe): Promise<SetupReport> {
  const plans: SetupLine[] = [];
  for (const row of SETUP_PLANS) {
    const found = await stripe.findPrice(row.lookupKey);
    if (found) {
      // An existing price at a different amount is reported, never changed: prices that customers pay can't be edited.
      plans.push({ lookupKey: row.lookupKey, status: found.cents === row.cents ? "exists" : "wrong_amount", cents: found.cents });
      continue;
    }
    await stripe.createPlan(row);
    plans.push({ lookupKey: row.lookupKey, status: "created", cents: row.cents });
  }
  return { plans, portal: await stripe.ensurePortal() };
}
