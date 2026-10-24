import type { PlanKey } from "./plans.ts";

// The parts of a Stripe Checkout request that this app decides, kept apart from the Stripe library so they can be tested.
// Stripe is strict about some fields (a client_reference_id may only hold letters, digits, dashes and underscores, so an
// email address is not allowed there), and a request it rejects shows the customer "That did not work".

export type SignupCheckoutInput = { plan: PlanKey; email: string; claims: { name: string; workspace: string; terms: string }; successUrl: string; cancelUrl: string };
export type ReactivateCheckoutInput = { tenantId: string; plan: PlanKey; customerId: string | null; email: string; successUrl: string; cancelUrl: string };

const meta = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.slice(0, 500)]));

export function signupSessionParams(i: SignupCheckoutInput, priceId: string) {
  const metadata = meta({ kind: "signup", plan: i.plan, email: i.email, name: i.claims.name.slice(0, 200), workspace: i.claims.workspace.slice(0, 120), terms: i.claims.terms });
  return {
    mode: "subscription" as const,
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: i.email,
    // The card is required and charged now: there is no trial.
    payment_method_collection: "always" as const,
    metadata,
    subscription_data: { metadata },
    allow_promotion_codes: false,
    success_url: i.successUrl,
    cancel_url: i.cancelUrl,
  };
}

export function reactivateSessionParams(i: ReactivateCheckoutInput, priceId: string) {
  const metadata = meta({ kind: "reactivate", tenant_id: i.tenantId, plan: i.plan });
  return {
    mode: "subscription" as const,
    line_items: [{ price: priceId, quantity: 1 }],
    ...(i.customerId ? { customer: i.customerId } : { customer_email: i.email }),
    payment_method_collection: "always" as const,
    metadata,
    subscription_data: { metadata },
    success_url: i.successUrl,
    cancel_url: i.cancelUrl,
  };
}

/** What a Stripe failure means for whoever is setting this up, in plain words (never a key). */
export function explainStripeFailure(error: { type?: string; code?: string; message?: string; param?: string }): string {
  if (error.type === "StripeAuthenticationError" || /invalid api key|api key provided/i.test(error.message ?? "")) {
    return "Stripe rejected the billing key (STRIPE_BILLING_SECRET_KEY). Copy a fresh secret key from the Stripe dashboard (same mode, same account where the plans were created), save it in the settings for this environment and redeploy.";
  }
  if (/price .*doesn't exist|billing-setup/i.test(error.message ?? "")) {
    return "The plan prices haven't been created in Stripe yet. Run scripts/billing-setup.mjs once with the same Stripe key, then try again.";
  }
  if (error.param) return `Stripe did not accept the payment request (${error.param}: ${(error.message ?? "").slice(0, 160)}).`;
  return `Stripe did not accept the payment request: ${(error.message ?? "unknown error").slice(0, 200)}`;
}
