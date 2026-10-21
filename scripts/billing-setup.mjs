// One-time setup of Verexa HQ's subscription products in Stripe (the platform account). Safe to run again: it finds what
// exists by lookup key and creates only what is missing.
//
//   STRIPE_BILLING_SECRET_KEY=sk_test_... node scripts/billing-setup.mjs
//
// Use a TEST key first. It creates: one product with a monthly price for each plan (PTIN $99, ERO $199, Service Bureau
// $299), the $27 pause price, and the customer billing portal settings (update card, invoices, cancel at period end; no
// plan switching, because plan changes go through the app).
import Stripe from "stripe";

const key = process.env.STRIPE_BILLING_SECRET_KEY || process.env.STRIPE_CONNECT_SECRET_KEY;
if (!key || !/^(sk|rk)_(test|live)_/.test(key)) {
  console.error("Set STRIPE_BILLING_SECRET_KEY to a Stripe secret key (use a test key first).");
  process.exit(1);
}
const stripe = new Stripe(key);
console.log(`Using a ${key.includes("_live_") ? "LIVE" : "test"} key.`);

const PRICES = [
  { lookup: "verexa_ptin_monthly", name: "Verexa HQ: PTIN holder", cents: 9900 },
  { lookup: "verexa_ero_monthly", name: "Verexa HQ: ERO", cents: 19900 },
  { lookup: "verexa_bureau_monthly", name: "Verexa HQ: Service Bureau", cents: 29900 },
  { lookup: "verexa_pause_monthly", name: "Verexa HQ: Paused plan", cents: 2700 },
];

for (const p of PRICES) {
  const found = await stripe.prices.list({ lookup_keys: [p.lookup], active: true, limit: 1 });
  if (found.data[0]) {
    if (found.data[0].unit_amount !== p.cents) console.warn(`! ${p.lookup} exists at ${found.data[0].unit_amount} cents, not ${p.cents}. Not changed; create a new price and move the lookup key by hand.`);
    else console.log(`ok ${p.lookup} already exists`);
    continue;
  }
  const product = await stripe.products.create({ name: p.name, statement_descriptor: "VEREXA HQ" });
  await stripe.prices.create({ product: product.id, currency: "usd", unit_amount: p.cents, recurring: { interval: "month" }, lookup_key: p.lookup });
  console.log(`created ${p.lookup} ($${p.cents / 100}/month)`);
}

const configs = await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 });
const settings = {
  business_profile: { headline: "Manage your Verexa HQ subscription" },
  features: {
    customer_update: { enabled: true, allowed_updates: ["email", "address", "phone", "tax_id"] },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: "at_period_end", cancellation_reason: { enabled: true, options: ["too_expensive", "missing_features", "switched_service", "unused", "other"] } },
    subscription_update: { enabled: false },
  },
};
if (configs.data[0]) {
  await stripe.billingPortal.configurations.update(configs.data[0].id, settings);
  console.log("updated the default billing portal settings");
} else {
  await stripe.billingPortal.configurations.create({ ...settings, default_return_url: undefined });
  console.log("created the billing portal settings");
}
console.log("\nNext: add a webhook endpoint <your site>/api/stripe/billing-webhook for checkout.session.completed, invoice.paid, invoice.payment_failed, customer.subscription.updated and customer.subscription.deleted, and set its signing secret as STRIPE_BILLING_WEBHOOK_SECRET.");
