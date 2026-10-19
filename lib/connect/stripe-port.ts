import "server-only";
import Stripe from "stripe";
import { connectMode } from "./config.ts";
import type { ConnectStripe } from "./service.ts";

/** The Stripe SDK behind the ConnectStripe port, using the platform (Verexa HQ) key. Nothing here logs a key, code or token. */
export function connectStripe(env: NodeJS.ProcessEnv = process.env): { stripe: Stripe; port: ConnectStripe } | null {
  const key = env.STRIPE_CONNECT_SECRET_KEY;
  const clientId = env.STRIPE_CONNECT_CLIENT_ID;
  const mode = connectMode(key);
  if (!key || !clientId || !mode) return null;
  const stripe = new Stripe(key);
  const port: ConnectStripe = {
    livemode: mode === "live",
    authorizeUrl(state, redirectUri) {
      const q = new URLSearchParams({ response_type: "code", client_id: clientId, scope: "read_write", state, redirect_uri: redirectUri });
      return `https://connect.stripe.com/oauth/authorize?${q.toString()}`;
    },
    async exchangeCode(code) {
      const r = await stripe.oauth.token({ grant_type: "authorization_code", code });
      if (!r.stripe_user_id) throw new Error("Stripe did not return an account.");
      return { account: r.stripe_user_id, livemode: Boolean(r.livemode) };
    },
    async accountFacts(account) {
      const a = await stripe.accounts.retrieve(account);
      return { charges_enabled: Boolean(a.charges_enabled), payouts_enabled: Boolean(a.payouts_enabled), details_submitted: Boolean(a.details_submitted) };
    },
    async deauthorize(account) {
      await stripe.oauth.deauthorize({ client_id: clientId, stripe_user_id: account });
    },
    async createCheckout(account, i) {
      const meta = { invoice_payment_id: i.paymentId, invoice_id: i.invoiceId, tenant_id: i.tenantId };
      const s = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: i.amountCents, product_data: { name: i.description } } }],
          ...(i.customerEmail ? { customer_email: i.customerEmail } : {}),
          client_reference_id: i.invoiceId,
          metadata: meta,
          payment_intent_data: { metadata: meta, description: i.description },
          success_url: i.successUrl,
          cancel_url: i.cancelUrl,
          expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 23,
        },
        { stripeAccount: account, idempotencyKey: `invoice-payment:${i.paymentId}` },
      );
      if (!s.url) throw new Error("Stripe did not return a payment page.");
      return { id: s.id, url: s.url };
    },
    async expireCheckout(account, sessionId) {
      await stripe.checkout.sessions.expire(sessionId, {}, { stripeAccount: account });
    },
  };
  return { stripe, port };
}
