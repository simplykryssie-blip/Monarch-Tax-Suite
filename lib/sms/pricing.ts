// What texting costs a tax office. One place for every price, so pages, checkouts and renewals always agree.
// Tenants see what each charge is for, never how it is built up.

/** One credit sends one message segment. */
export const CREDIT_PRICE_CENTS = 2.5;

/** Credits are sold in packs, by card. */
export const CREDIT_PACK = { cents: 2500, credits: 1000 } as const;
export const MAX_PACKS = 10;

export type NumberType = "toll_free" | "local";

export type NumberPlan = {
  type: NumberType;
  label: string;
  /** One-time card payment: the number and its carrier registration. */
  setupCents: number;
  /** Monthly, taken from credits. */
  monthlyCents: number;
  monthlyCredits: number;
  /** What the tenant is paying for, as it appears on the checkout and in their history. */
  setupItem: string;
  monthlyItem: string;
  approval: string;
  summary: string;
  recommended: boolean;
};

const plan = (p: Omit<NumberPlan, "monthlyCredits">): NumberPlan => ({ ...p, monthlyCredits: Math.round(p.monthlyCents / CREDIT_PRICE_CENTS) });

export const NUMBER_PLANS: Record<NumberType, NumberPlan> = {
  toll_free: plan({
    type: "toll_free",
    label: "Toll-free number",
    setupCents: 500,
    monthlyCents: 275,
    setupItem: "Toll-free texting number: setup and carrier verification",
    monthlyItem: "Toll-free texting number, monthly",
    approval: "Carrier verification usually takes 3 to 5 business days.",
    summary: "An 8XX number. Verification only, no campaign to register.",
    recommended: true,
  }),
  local: plan({
    type: "local",
    label: "Local number",
    setupCents: 2350,
    monthlyCents: 325,
    setupItem: "Local texting number: setup and carrier registration (brand and campaign)",
    monthlyItem: "Local texting number, monthly",
    approval: "Carrier registration usually takes 2 to 4 weeks.",
    summary: "A number in your area code. Needs a brand and campaign registration with US carriers.",
    recommended: false,
  }),
};

export const isNumberType = (v: unknown): v is NumberType => v === "toll_free" || v === "local";

export const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
export const creditsLabel = (n: number) => `${n.toLocaleString("en-US")} credit${n === 1 ? "" : "s"}`;

/** A credit-pack checkout: what it costs and what it gives. */
export function creditPack(packs: unknown): { packs: number; cents: number; credits: number; item: string } {
  const n = Math.floor(Number(packs));
  if (!Number.isFinite(n) || n < 1 || n > MAX_PACKS) throw new RangeError(`Choose between 1 and ${MAX_PACKS} packs.`);
  return { packs: n, cents: n * CREDIT_PACK.cents, credits: n * CREDIT_PACK.credits, item: `${creditsLabel(CREDIT_PACK.credits)} for text messages` };
}
