import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { MemoryRepo, published, seedCheckout } from "./memory-repo.ts";
import { createProduct } from "../lib/commerce/catalog.ts";
import { handleStripeEvent, issueLicenseKey } from "../lib/commerce/fulfillment.ts";
import { advanceInstallation, installationNextStep, type OnboardingFacts } from "../lib/commerce/installation-progress.ts";
import { verifyCatalogProduct, type StripeCatalogPort } from "../lib/commerce/stripe-verify.ts";
import type { InstallationType, NewProduct } from "../lib/commerce/types.ts";

// Phase 1 step F3a: installations follow what the customer actually did, and every state has a next action.

const PRODUCT: NewProduct = {
  slug: "monarch-basic-tax-calculator", name: "Monarch Basic Tax Calculator", description: "Estimator.", product_type: "software", access_type: "license",
  installation_options: ["self_service", "done_for_you"], price_cents: 7500, currency: "usd", stripe_product_id: "prod_TESTCALC123", stripe_price_id: "price_TESTCALC123", status: "draft",
};

async function bought(type: InstallationType = "self_service") {
  const repo = new MemoryRepo();
  const product = await published(repo, await createProduct(repo, PRODUCT));
  await seedCheckout(repo, "cs_1", product.id, 7500, type);
  await handleStripeEvent({ repo, listCheckoutProductIds: async () => ["prod_TESTCALC123"] }, {
    id: "evt_1", type: "checkout.session.completed",
    data: { object: { id: "cs_1", payment_status: "paid", payment_intent: "pi_TEST000001", amount_total: 7500, currency: "usd", customer: null, customer_details: { email: "buyer@example.com", name: "Buyer" }, metadata: {} } },
  });
  const license = repo.licenses[0];
  return { repo, license, installation: () => repo.installations[0] };
}

const statuses = (repo: MemoryRepo) => repo.installationEvents.map((e) => `${e.from_status ?? "-"}>${e.to_status ?? "-"}`);

describe("installation states follow the customer", () => {
  test("self-service: opening setup moves requested to in progress, once", async () => {
    const { repo, license, installation } = await bought();
    assert.equal(installation().status, "requested");
    assert.equal((await advanceInstallation(repo, license.id, { kind: "setup_started" }))?.status, "in_progress");
    assert.equal(await advanceInstallation(repo, license.id, { kind: "setup_started" }), null, "idempotent");
    assert.deepEqual(statuses(repo), ["->requested", "requested>in_progress"]);
  });

  test("self-service: finishing setup is recorded once and does not claim the calculator is live", async () => {
    const { repo, license, installation } = await bought();
    await advanceInstallation(repo, license.id, { kind: "setup_started" });
    await advanceInstallation(repo, license.id, { kind: "setup_completed" });
    await advanceInstallation(repo, license.id, { kind: "setup_completed" });
    assert.equal(installation().status, "in_progress");
    assert.equal(repo.installationEvents.filter((e) => /finished self-service setup/.test(e.note ?? "")).length, 1);
  });

  test("the first live load on the authorized website marks it active, only once the license is active", async () => {
    const { repo, license, installation } = await bought();
    assert.equal(await advanceInstallation(repo, license.id, { kind: "seen_live", host: "example.com" }), null, "pending license: not live");
    await issueLicenseKey(repo, license.id, "admin");
    assert.equal((await advanceInstallation(repo, license.id, { kind: "seen_live", host: "example.com" }))?.status, "active");
    assert.equal(await advanceInstallation(repo, license.id, { kind: "seen_live", host: "example.com" }), null, "idempotent");
    assert.match(repo.installationEvents.at(-1)!.note ?? "", /loaded live on the authorized website \(example\.com\)/);
    assert.equal(installation().status, "active");
  });

  test("done-for-you: setup signals are ignored, a live load activates it", async () => {
    const { repo, license, installation } = await bought("done_for_you");
    await issueLicenseKey(repo, license.id, "admin");
    assert.equal(await advanceInstallation(repo, license.id, { kind: "setup_started" }), null);
    assert.equal(installation().status, "requested");
    assert.equal((await advanceInstallation(repo, license.id, { kind: "seen_live", host: "example.com" }))?.status, "active");
  });

  test("blocked or removed installations and unpaid orders are never changed", async () => {
    const { repo, license, installation } = await bought();
    await issueLicenseKey(repo, license.id, "admin");
    await repo.updateInstallation(installation().id, { status: "blocked" });
    assert.equal(await advanceInstallation(repo, license.id, { kind: "seen_live", host: "example.com" }), null);
    await repo.updateInstallation(installation().id, { status: "requested" });
    await repo.updateOrder(repo.orders[0].id, { payment_status: "refunded" });
    assert.equal(await advanceInstallation(repo, license.id, { kind: "seen_live", host: "example.com" }), null);
  });
});

describe("next step for every installation state", () => {
  const base = { installation: { status: "requested" as const, installation_type: "self_service" as const, platform: "gohighlevel" as const, target_location: null, intake_submitted_at: null, intake_expires_at: null }, license: { status: "active" as const, key_prefix: "MTS-ABCD" }, activeDomains: ["example.com"] };
  const ob = (o: Partial<OnboardingFacts>): OnboardingFacts => ({ completed: false, remaining: [], invite: "sent", linkState: "active", linkOpened: false, ...o });
  const step = (over: Partial<Parameters<typeof installationNextStep>[0]>) => installationNextStep({ ...base, onboarding: ob({}), ...over });

  test("license first", () => {
    assert.match(step({ license: { status: "pending", key_prefix: null } }).text, /Issue the license key/);
    assert.match(step({ license: { status: "suspended", key_prefix: "MTS-ABCD" } }).text, /license is suspended/);
  });

  test("self-service: setup email, link, steps, then waiting for the live load", () => {
    assert.deepEqual(step({ onboarding: ob({ invite: "none" }) }), { waitingOn: "administrator", text: "Send the setup email (License page → Customer onboarding)." });
    assert.match(step({ onboarding: ob({ invite: "failed" }) }).text, /setup email failed/);
    assert.match(step({ onboarding: ob({ linkState: "expired" }) }).text, /Resend the setup email/);
    assert.equal(step({}).waitingOn, "customer");
    assert.match(step({ onboarding: ob({ linkOpened: true, remaining: ["CRM connected", "Connection tested"] }) }).text, /Remaining: crm connected, connection tested/);
    assert.match(step({ onboarding: ob({ completed: true }) }).text, /Waiting for the calculator to load on example\.com/);
  });

  test("done-for-you: details link, install, finish", () => {
    const dfy = { ...base.installation, installation_type: "done_for_you" as const, platform: "other" as const };
    assert.match(step({ installation: dfy }).text, /Send the customer an installation details link/);
    assert.match(step({ installation: { ...dfy, intake_expires_at: "2026-10-20T00:00:00Z" } }).waitingOn, /customer/);
    assert.match(step({ installation: { ...dfy, platform: "gohighlevel", target_location: "example.com" } }).text, /Install the calculator on example\.com/);
    assert.match(step({ installation: { ...dfy, status: "in_progress" } }).text, /turns active automatically/);
  });

  test("end states", () => {
    assert.equal(step({ installation: { ...base.installation, status: "active" } }).waitingOn, "nobody");
    assert.match(step({ installation: { ...base.installation, status: "blocked" } }).text, /Blocked/);
  });
});

describe("Stripe check on drafts", () => {
  const port = (active: boolean): StripeCatalogPort => ({
    mode: "live",
    async getProduct(id) { return { id, name: "Calc", active, livemode: true }; },
    async getPrice(id) { return { id, product_id: "prod_TESTCALC123", product_name: "Calc", product_active: active, active: true, currency: "usd", unit_amount: 7500, type: "one_time", interval: null, livemode: true }; },
    async listActivePrices() { return []; },
    async createOneTimePrice() { throw new Error("not used"); },
  });

  test("an inactive Stripe product is expected for a draft, and the price is still verified", async () => {
    const repo = new MemoryRepo();
    const draft = await createProduct(repo, PRODUCT);
    const snap = await verifyCatalogProduct(repo, port(false), draft.id);
    assert.equal(snap.ok, true);
    assert.deepEqual(snap.issues, []);
    assert.match(snap.notes?.[0] ?? "", /inactive, as expected while this product is draft/);
    assert.equal((await repo.getProduct(draft.id))?.stripe_price_cents, 7500);
  });

  test("an inactive Stripe product on a published product needs action", async () => {
    const repo = new MemoryRepo();
    const live = await published(repo, await createProduct(repo, PRODUCT));
    const snap = await verifyCatalogProduct(repo, port(false), live.id);
    assert.equal(snap.ok, false);
    assert.match(snap.issues.join(" "), /this product is published, so it cannot be bought/);
  });
});
