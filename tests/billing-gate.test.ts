import assert from "node:assert/strict";
import test from "node:test";
import { captchaConfigured, verifyCaptcha } from "../lib/billing/captcha.ts";
import { gateFor } from "../lib/billing/gate.ts";
import { signupState } from "../lib/billing/open.ts";
import { billingView } from "../lib/billing/view.ts";
import type { Subscription } from "../lib/billing/access.ts";

const BILLING = { STRIPE_BILLING_SECRET_KEY: "sk_test_abc", STRIPE_BILLING_WEBHOOK_SECRET: "whsec_x", MONARCH_ENCRYPTION_KEY: "k" };
const sub = (over: Partial<Subscription>): Subscription => ({ tenant_id: "t", plan: "ptin", status: "active", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1", current_period_end: "2026-12-01T00:00:00Z", cancel_at_period_end: false, paused_from_plan: null, suspended_at: null, canceled_at: null, delete_after: null, precheck_mark: null, created_at: "", updated_at: "", ...over });

test("gate: a good account can do everything", () => {
  assert.deepEqual(gateFor("full", "/practice/clients", "POST"), { allowed: true });
});

test("gate: read-only can look but not change, and can always reach billing", () => {
  assert.equal(gateFor("read_only", "/practice/clients", "GET").allowed, true);
  const post = gateFor("read_only", "/practice/clients", "POST");
  assert.equal(post.allowed, false);
  assert.match(post.allowed ? "" : post.message, /read-only/);
  assert.equal(gateFor("read_only", "/practice/billing", "POST").allowed, true);
});

test("gate: a paused plan reaches clients and contacts only; cancelled reaches billing only", () => {
  assert.equal(gateFor("contacts_only", "/practice", "GET").allowed, true);
  assert.equal(gateFor("contacts_only", "/practice/clients/abc", "POST").allowed, true);
  assert.equal(gateFor("contacts_only", "/practice/campaigns", "GET").allowed, false);
  assert.equal(gateFor("contacts_only", "/practice/website", "GET").allowed, false);
  assert.equal(gateFor("contacts_only", "/practice/billing", "GET").allowed, true);
  assert.equal(gateFor("closed", "/practice", "GET").allowed, false);
  assert.equal(gateFor("closed", "/practice/clients", "GET").allowed, false);
  assert.equal(gateFor("closed", "/practice/billing", "POST").allowed, true);
  assert.equal(gateFor("closed", "/practice/security", "GET").allowed, true);
  assert.equal(gateFor("closed", "/practice/billingx", "GET").allowed, false, "a look-alike path isn't the billing page");
});

test("signup is open on a Preview with billing set up; in production it also needs approved policies and the bot check", () => {
  assert.equal(signupState({}, false).open, false);
  assert.equal(signupState(BILLING, false).open, true);
  assert.equal(signupState({ ...BILLING, VERCEL_ENV: "production" }, true).open, false);
  const prod = signupState({ ...BILLING, VERCEL_ENV: "production" }, false);
  assert.ok(!prod.open && prod.reasons.some((r) => /approved/.test(r)) && prod.reasons.some((r) => /bot check/.test(r)));
  assert.equal(signupState({ ...BILLING, VERCEL_ENV: "production", TURNSTILE_SITE_KEY: "s", TURNSTILE_SECRET_KEY: "k" }, true).open, true);
});

test("bot check: skipped only outside production without keys; otherwise Turnstile must say yes", async () => {
  assert.equal(captchaConfigured({}), false);
  assert.equal(await verifyCaptcha({}, null, null), true);
  assert.equal(await verifyCaptcha({ VERCEL_ENV: "production" }, "tok", null), false);
  const env = { TURNSTILE_SITE_KEY: "s", TURNSTILE_SECRET_KEY: "k" };
  assert.equal(await verifyCaptcha(env, null, null), false);
  const yes = (async () => new Response(JSON.stringify({ success: true }))) as unknown as typeof fetch;
  const no = (async () => new Response(JSON.stringify({ success: false }))) as unknown as typeof fetch;
  const boom = (async () => { throw new Error("down"); }) as unknown as typeof fetch;
  assert.equal(await verifyCaptcha(env, "tok", "1.2.3.4", yes), true);
  assert.equal(await verifyCaptcha(env, "tok", null, no), false);
  assert.equal(await verifyCaptcha(env, "tok", null, boom), false, "if the check can't be reached, the answer is no");
});

test("billing view: plain words and the right buttons for each state", () => {
  const now = new Date("2026-11-10T00:00:00Z");
  assert.equal(billingView(null), null);
  const active = billingView(sub({}), now)!;
  assert.deepEqual([active.price, active.banner, active.can.pause, active.can.portal], ["$99", null, true, true]);
  const late = billingView(sub({ status: "suspended" }), now)!;
  assert.equal(late.banner?.tone, "warn");
  assert.match(late.banner!.text, /read-only/);
  assert.match(late.banner!.text, /no messages are sent/);
  assert.match(billingView(sub({ status: "read_only", suspended_at: "2026-11-05T00:00:00Z" }), now)!.banner!.text, /paid in 9 days/);
  const paused = billingView(sub({ status: "paused", paused_from_plan: "ptin" }), now)!;
  assert.deepEqual([paused.price, paused.can.resume, paused.can.pause], ["$27", true, false]);
  const gone = billingView(sub({ status: "canceled", canceled_at: "2026-11-01T00:00:00Z", delete_after: "2027-01-30T00:00:00Z" }), now)!;
  assert.match(gone.banner!.text, /81 more days/);
  assert.equal(gone.can.reactivate, true);
  assert.equal(billingView(sub({ status: "internal", stripe_customer_id: null }), now)!.can.portal, false);
  assert.match(billingView(sub({ cancel_at_period_end: true }), now)!.banner!.text, /plan ends on December 1, 2026/);
});
