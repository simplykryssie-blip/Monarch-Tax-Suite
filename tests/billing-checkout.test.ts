import assert from "node:assert/strict";
import test from "node:test";
import { explainStripeFailure, reactivateSessionParams, signupSessionParams } from "../lib/billing/checkout-params.ts";
import { existingAccountEmail, verificationEmail } from "../lib/billing/signup.ts";
import { welcomeEmail } from "../lib/billing/service.ts";
import { emailButton, renderEmailHtml } from "../lib/office/email-html.ts";

const base = { plan: "ptin" as const, email: "pat+test@example.com", claims: { name: "Pat Preparer", workspace: "Pat Tax", terms: "draft-test" }, successUrl: "https://app.test/signup/done?session_id={CHECKOUT_SESSION_ID}", cancelUrl: "https://app.test/signup/verify/tok" };

test("the payment request never sends fields Stripe rejects", () => {
  const p = signupSessionParams(base, "price_123") as Record<string, unknown>;
  // Stripe only accepts letters, digits, dashes and underscores in client_reference_id, so an email must never go there.
  assert.equal("client_reference_id" in p, false);
  assert.equal(p.mode, "subscription");
  assert.equal(p.payment_method_collection, "always");
  assert.equal("subscription_data" in p && "trial_period_days" in (p.subscription_data as object), false, "no trial");
  assert.deepEqual(p.line_items, [{ price: "price_123", quantity: 1 }]);
  assert.equal(p.customer_email, "pat+test@example.com");
  const meta = p.metadata as Record<string, string>;
  assert.deepEqual([meta.kind, meta.plan, meta.workspace], ["signup", "ptin", "Pat Tax"]);
  assert.ok(Object.values(meta).every((v) => v.length <= 500));
});

test("reactivation uses the existing customer when there is one", () => {
  const withCustomer = reactivateSessionParams({ tenantId: "t1", plan: "ptin", customerId: "cus_1", email: "a@b.co", successUrl: "s", cancelUrl: "c" }, "price_1") as Record<string, unknown>;
  assert.equal(withCustomer.customer, "cus_1");
  assert.equal("customer_email" in withCustomer, false);
  const without = reactivateSessionParams({ tenantId: "t1", plan: "ptin", customerId: null, email: "a@b.co", successUrl: "s", cancelUrl: "c" }, "price_1") as Record<string, unknown>;
  assert.equal(without.customer_email, "a@b.co");
});

test("Stripe failures are explained in words, without ever including a key", () => {
  assert.match(explainStripeFailure({ type: "StripeAuthenticationError", message: "Invalid API Key provided: sk_test_****a00o" }), /rejected the billing key/);
  assert.doesNotMatch(explainStripeFailure({ message: "Invalid API Key provided: sk_test_****a00o" }), /a00o/);
  assert.match(explainStripeFailure({ message: 'The Stripe price "verexa_ptin_monthly" doesn\'t exist yet. Run scripts/billing-setup.mjs once.' }), /billing-setup\.mjs/);
  assert.match(explainStripeFailure({ param: "line_items", message: "bad" }), /line_items/);
});

test("emails: the main step is a button, not a long address", () => {
  const link = "https://app.test/signup/verify/" + "x".repeat(300);
  const mail = verificationEmail({ name: "Pat", link });
  assert.deepEqual(mail.action, { label: "Confirm email", url: link });
  const html = renderEmailHtml(mail.text, mail.action);
  assert.match(html, /<a href="https:\/\/app\.test\/signup\/verify\/x+"[^>]*>Confirm email<\/a>/);
  // The address is the link target only; it is never shown as text.
  assert.equal(html.replace(/href="[^"]*"/g, "").includes("xxxxxxxxxx"), false);
  assert.match(html, /VEREXA HQ/);
  assert.ok(mail.text.includes(link), "the plain-text version keeps the address for text-only mail apps");
  assert.deepEqual(existingAccountEmail({ name: "Pat", link: "https://app.test/login" }).action, { label: "Sign in", url: "https://app.test/login" });
  assert.deepEqual(welcomeEmail({ name: "Pat", workspace: "Pat Tax", plan: "ptin", link: "https://app.test/practice/invite/t" }).action, { label: "Set my password", url: "https://app.test/practice/invite/t" });
});

test("emails: text is escaped, unsafe addresses never become buttons, and emails without an action are unchanged", () => {
  assert.equal(emailButton({ label: "Go", url: "javascript:alert(1)" }), "");
  assert.equal(emailButton({ label: "Go", url: 'https://x.test/"><script>' }), "");
  const html = renderEmailHtml("Hi <b>Pat</b> & co\nhttps://x.test/a", { label: "Open <it>", url: "https://x.test/a" });
  assert.match(html, /Hi &lt;b&gt;Pat&lt;\/b&gt; &amp; co/);
  assert.match(html, />Open &lt;it&gt;</);
  assert.equal(renderEmailHtml("Hello\nhttps://x.test/a"), '<p style="margin:0 0 12px">Hello</p><p><a href="https://x.test/a">https://x.test/a</a></p>');
});

import { planStatus, runBillingSetup, SETUP_PLANS, type PlanRow, type SetupStripe } from "../lib/billing/setup.ts";

function fakeStripe(existing: Record<string, number> = {}) {
  const created: PlanRow[] = [];
  const stripe: SetupStripe = {
    findPrice: async (k) => (k in existing ? { id: `price_${k}`, cents: existing[k] } : null),
    createPlan: async (row) => { created.push(row); },
    ensurePortal: async () => "created",
  };
  return { stripe, created };
}

test("billing setup creates only the missing plans, at the owner's prices, and never edits an existing price", async () => {
  assert.deepEqual(SETUP_PLANS.map((p) => [p.lookupKey, p.cents]), [["verexa_ptin_monthly", 9900], ["verexa_ero_monthly", 19900], ["verexa_bureau_monthly", 29900], ["verexa_pause_monthly", 2700]]);
  const fresh = fakeStripe();
  const r1 = await runBillingSetup(fresh.stripe);
  assert.equal(fresh.created.length, 4);
  assert.deepEqual(r1.plans.map((p) => p.status), ["created", "created", "created", "created"]);
  const partly = fakeStripe({ verexa_ptin_monthly: 9900, verexa_ero_monthly: 15000 });
  const r2 = await runBillingSetup(partly.stripe);
  assert.deepEqual(partly.created.map((p) => p.lookupKey), ["verexa_bureau_monthly", "verexa_pause_monthly"]);
  assert.deepEqual(r2.plans.map((p) => p.status), ["exists", "wrong_amount", "created", "created"]);
  const status = await planStatus(partly.stripe);
  assert.deepEqual(status.map((s) => s.exists), [true, true, false, false]);
});
