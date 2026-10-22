import "server-only";
import Stripe from "stripe";
import { billingKey, billingMode, PAUSE_PLAN, PLANS, type PlanKey } from "./plans.ts";
import { reactivateSessionParams, signupSessionParams } from "./checkout-params.ts";
import type { BillingStripe } from "./service.ts";
import type { SetupStripe } from "./setup.ts";

/** The Stripe SDK behind the BillingStripe port, using Verexa HQ's platform account. Nothing here logs a key. */
export function billingStripe(env: NodeJS.ProcessEnv = process.env): { stripe: Stripe; port: BillingStripe; livemode: boolean } | null {
  const key = billingKey(env);
  const mode = billingMode(env);
  if (!key || !mode) return null;
  const stripe = new Stripe(key);

  const priceId = async (lookupKey: string) => {
    const r = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
    const id = r.data[0]?.id;
    if (!id) throw new Error(`The Stripe price "${lookupKey}" doesn't exist yet. Run scripts/billing-setup.mjs once.`);
    return id;
  };

  const port: BillingStripe = {
    async signupCheckout(i) {
      const s = await stripe.checkout.sessions.create(signupSessionParams(i, await priceId(PLANS[i.plan].lookupKey)), { idempotencyKey: i.idempotencyKey });
      if (!s.url) throw new Error("Stripe did not return a payment page.");
      return { url: s.url };
    },
    async reactivateCheckout(i) {
      const s = await stripe.checkout.sessions.create(reactivateSessionParams(i, await priceId(PLANS[i.plan].lookupKey)), { idempotencyKey: i.idempotencyKey });
      if (!s.url) throw new Error("Stripe did not return a payment page.");
      return { url: s.url };
    },
    async portalUrl(customerId, returnUrl) {
      const s = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
      return s.url;
    },
    async setPrice(subscriptionId, lookupKey) {
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      const item = sub.items.data[0];
      if (!item) throw new Error("The subscription has no plan item.");
      // From the next renewal, with no charge or credit today.
      await stripe.subscriptions.update(subscriptionId, { items: [{ id: item.id, price: await priceId(lookupKey) }], proration_behavior: "none" });
    },
    async previewPlanChange(subscriptionId, lookupKey) {
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      const item = sub.items.data[0];
      if (!item) throw new Error("The subscription has no plan item.");
      // Stripe won't take a fixed proration moment together with a billing-cycle reset, so the quote is as of now.
      const inv = await stripe.invoices.createPreview({
        subscription: subscriptionId,
        subscription_details: { items: [{ id: item.id, price: await priceId(lookupKey) }], proration_behavior: "always_invoice", billing_cycle_anchor: "now" },
      });
      // The credit for unused time is the negative proration lines; the rest is the new plan's charge.
      const credit = inv.lines.data.filter((l) => l.amount < 0).reduce((n, l) => n - l.amount, 0);
      return { dueCents: Math.max(0, inv.amount_due), creditCents: credit };
    },
    async changePlan(subscriptionId, lookupKey) {
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      const item = sub.items.data[0];
      if (!item) throw new Error("The subscription has no plan item.");
      // New plan today, charged in full less credit for the old plan's unused time; if the card can't pay, nothing changes.
      const updated = await stripe.subscriptions.update(subscriptionId, {
        items: [{ id: item.id, price: await priceId(lookupKey) }],
        proration_behavior: "always_invoice",
        billing_cycle_anchor: "now",
        payment_behavior: "error_if_incomplete",
      });
      const end = updated.items.data[0]?.current_period_end;
      return { currentPeriodEnd: end ? new Date(end * 1000).toISOString() : null };
    },
    async subscriptionFacts(subscriptionId) {
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      const item = sub.items.data[0];
      return {
        status: sub.status,
        currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000).toISOString() : null,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        lookupKey: item?.price?.lookup_key ?? null,
        customerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      };
    },
    async cardCheck(customerId, renewalIso) {
      const c = await stripe.customers.retrieve(customerId, { expand: ["invoice_settings.default_payment_method"] });
      if (c.deleted) return { ok: false, reason: "the account on file was removed" };
      let pm = c.invoice_settings?.default_payment_method as Stripe.PaymentMethod | string | null | undefined;
      if (!pm) {
        const list = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
        pm = list.data[0] ?? null;
      }
      if (!pm || typeof pm === "string") return { ok: false, reason: "there is no card on file" };
      const card = pm.card;
      if (!card) return { ok: true };
      const renew = new Date(renewalIso);
      // A card is good through the last day of its expiry month.
      const lastDay = Date.UTC(card.exp_year, card.exp_month, 0, 23, 59, 59);
      if (lastDay < renew.getTime()) return { ok: false, reason: `the card on file ends in ${card.last4} and expires before then` };
      return { ok: true };
    },
    async retryOpenInvoice(subscriptionId) {
      const open = await stripe.invoices.list({ subscription: subscriptionId, status: "open", limit: 1 });
      const inv = open.data[0];
      if (!inv?.id) return "none";
      try {
        const paid = await stripe.invoices.pay(inv.id);
        return paid.status === "paid" ? "paid" : "failed";
      } catch {
        return "failed";
      }
    },
    async cancelNow(subscriptionId) {
      await stripe.subscriptions.cancel(subscriptionId);
    },
  };
  return { stripe, port, livemode: mode === "live" };
}

export type { PlanKey };
export const PAUSE_LOOKUP_KEY = PAUSE_PLAN.lookupKey;

/** The Stripe calls behind the one-time plan setup (the same ones scripts/billing-setup.mjs makes). */
export function billingSetupPort(stripe: Stripe): SetupStripe {
  return {
    async findPrice(lookupKey) {
      const r = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
      const p = r.data[0];
      return p ? { id: p.id, cents: p.unit_amount } : null;
    },
    async createPlan(row) {
      const product = await stripe.products.create({ name: row.label, statement_descriptor: "VEREXA HQ" });
      await stripe.prices.create({ product: product.id, currency: "usd", unit_amount: row.cents, recurring: { interval: "month" }, lookup_key: row.lookupKey });
    },
    async ensurePortal() {
      const settings = {
        business_profile: { headline: "Manage your Verexa HQ subscription" },
        features: {
          customer_update: { enabled: true, allowed_updates: ["email", "address", "phone", "tax_id"] as Stripe.BillingPortal.ConfigurationUpdateParams.Features.CustomerUpdate.AllowedUpdate[] },
          invoice_history: { enabled: true },
          payment_method_update: { enabled: true },
          subscription_cancel: { enabled: true, mode: "at_period_end" as const, cancellation_reason: { enabled: true, options: ["too_expensive", "missing_features", "switched_service", "unused", "other"] as Stripe.BillingPortal.ConfigurationUpdateParams.Features.SubscriptionCancel.CancellationReason.Option[] } },
          subscription_update: { enabled: false },
        },
      };
      const existing = await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 });
      if (existing.data[0]) {
        await stripe.billingPortal.configurations.update(existing.data[0].id, settings);
        return "updated";
      }
      await stripe.billingPortal.configurations.create(settings);
      return "created";
    },
  };
}
