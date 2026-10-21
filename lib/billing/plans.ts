// The three plans, the pause plan, and the signup rules that go with them. Prices are in cents. Stripe prices are found by
// their lookup key (created once by scripts/billing-setup.mjs), so no price ids live in settings.

export type PlanKey = "ptin" | "ero" | "bureau";
export const PLAN_KEYS: PlanKey[] = ["ptin", "ero", "bureau"];

export type Plan = { key: PlanKey; label: string; priceCents: number; lookupKey: string; summary: string; /** Whether a new customer can sign up for it on their own today. */ selfServe: boolean };

export const PLANS: Record<PlanKey, Plan> = {
  ptin: { key: "ptin", label: "PTIN holder", priceCents: 9900, lookupKey: "verexa_ptin_monthly", summary: "Your own workspace for your clients, prep work and returns.", selfServe: true },
  ero: { key: "ero", label: "ERO", priceCents: 19900, lookupKey: "verexa_ero_monthly", summary: "Adds the ERO tools: preparers, e-file and compliance.", selfServe: false },
  bureau: { key: "bureau", label: "Service Bureau", priceCents: 29900, lookupKey: "verexa_bureau_monthly", summary: "Everything, for a bureau with several offices.", selfServe: false },
};

/** The pause plan: keeps the data from being deleted while an account is not in use. */
export const PAUSE_PLAN = { key: "pause" as const, label: "Paused", priceCents: 2700, lookupKey: "verexa_pause_monthly" };

export const isPlanKey = (v: unknown): v is PlanKey => typeof v === "string" && (PLAN_KEYS as string[]).includes(v);
export const dollars = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

export type BillingEnv = Record<string, string | undefined>;

/** The Verexa HQ Stripe key used for subscriptions (the platform account, like Connect, not the storefront's key). */
export const billingKey = (env: BillingEnv) => env.STRIPE_BILLING_SECRET_KEY || env.STRIPE_CONNECT_SECRET_KEY || undefined;
export function billingMode(env: BillingEnv): "live" | "test" | null {
  const key = billingKey(env);
  if (!key) return null;
  if (/^(sk|rk)_live_/.test(key)) return "live";
  if (/^(sk|rk)_test_/.test(key)) return "test";
  return null;
}

/** What is missing before subscriptions can run, in plain words (never the values). */
export function billingProblems(env: BillingEnv): string[] {
  const problems: string[] = [];
  if (!billingKey(env)) problems.push("STRIPE_BILLING_SECRET_KEY (Verexa HQ's Stripe secret key; STRIPE_CONNECT_SECRET_KEY is used when this is not set) is not set.");
  else if (!billingMode(env)) problems.push("The Stripe billing key isn't a Stripe secret key.");
  if (!env.STRIPE_BILLING_WEBHOOK_SECRET) problems.push("STRIPE_BILLING_WEBHOOK_SECRET (the billing webhook's signing secret) is not set.");
  if (!env.MONARCH_ENCRYPTION_KEY) problems.push("MONARCH_ENCRYPTION_KEY is not set (signup links are signed with it).");
  return problems;
}
