import "server-only";
import Stripe from "stripe";
import { billingKey, billingMode, PAUSE_PLAN, PLANS, type PlanKey } from "./plans.ts";
import { reactivateSessionParams, signupSessionParams } from "./checkout-params.ts";
import type { BillingStripe } from "./service.ts";

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
