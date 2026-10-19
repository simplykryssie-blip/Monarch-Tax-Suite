import { test } from "node:test";
import assert from "node:assert/strict";
import { assessWebhooks, expectedWebhookUrl, HANDLED_EVENTS, webhookFix, type WebhookEndpointFacts } from "../lib/commerce/webhook-health.ts";

// The Stripe webhook health check behind the admin's one-click fix.

const EXPECTED = expectedWebhookUrl("https://app.monarchtaxsuite.com/");
const ep = (over: Partial<WebhookEndpointFacts> = {}): WebhookEndpointFacts => ({ id: "we_1", url: EXPECTED, status: "enabled", enabled_events: [...HANDLED_EVENTS], livemode: true, ...over });

test("the expected address is the app origin plus the webhook path", () => {
  assert.equal(EXPECTED, "https://app.monarchtaxsuite.com/api/stripe/webhook");
});

test("one enabled endpoint at the right address with every handled event is OK", () => {
  assert.equal(assessWebhooks([ep()], EXPECTED).state, "ok");
  assert.equal(assessWebhooks([ep({ enabled_events: ["*"] })], EXPECTED).state, "ok");
  // Unrelated endpoints elsewhere do not matter.
  assert.equal(assessWebhooks([ep(), ep({ id: "we_other", url: "https://crm.example.com/hooks/stripe" })], EXPECTED).state, "ok");
});

test("the wrong host (the old vercel.app address) is fixable by changing only the URL", () => {
  const health = assessWebhooks([ep({ url: "https://monarch-tax-suite.vercel.app/api/stripe/webhook" })], EXPECTED);
  assert.equal(health.state, "fixable");
  if (health.state !== "fixable") return;
  assert.match(health.problems[0], /sends events to https:\/\/monarch-tax-suite\.vercel\.app\/api\/stripe\/webhook, not https:\/\/app\.monarchtaxsuite\.com/);
  assert.deepEqual(webhookFix(health), { url: EXPECTED, enabled_events: undefined }, "the event list is left as it is");
});

test("missing events are added to the ones already enabled", () => {
  const health = assessWebhooks([ep({ enabled_events: ["checkout.session.completed", "customer.created"] })], EXPECTED);
  assert.equal(health.state, "fixable");
  if (health.state !== "fixable") return;
  const fix = webhookFix(health);
  assert.ok(fix.enabled_events!.includes("customer.created"), "other events are kept");
  for (const e of HANDLED_EVENTS) assert.ok(fix.enabled_events!.includes(e), e);
});

test("no endpoint, two endpoints for this app, or a disabled endpoint are never auto-fixed", () => {
  assert.equal(assessWebhooks([], EXPECTED).state, "manual");
  assert.equal(assessWebhooks([ep({ url: "https://crm.example.com/hooks/stripe" })], EXPECTED).state, "manual");
  const two = assessWebhooks([ep({ id: "we_a", url: "https://monarch-tax-suite.vercel.app/api/stripe/webhook" }), ep({ id: "we_b", url: "https://other.example.com/api/stripe/webhook" })], EXPECTED);
  assert.equal(two.state, "manual");
  assert.match(two.state === "manual" ? two.problems[0] : "", /2 Stripe webhook endpoints .* only one matches STRIPE_WEBHOOK_SECRET/);
  const disabled = assessWebhooks([ep({ status: "disabled" })], EXPECTED);
  assert.equal(disabled.state, "manual");
  assert.match(disabled.state === "manual" ? disabled.problems.join(" ") : "", /disabled in Stripe/);
});

test("an exact-address endpoint is preferred over others on the same path", () => {
  assert.equal(assessWebhooks([ep(), ep({ id: "we_old", url: "https://monarch-tax-suite.vercel.app/api/stripe/webhook" })], EXPECTED).state, "ok");
});
