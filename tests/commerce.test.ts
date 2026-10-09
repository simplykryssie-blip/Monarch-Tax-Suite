import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MemoryRepo } from "./memory-repo.ts";
import { createProduct, editProduct, setProductStatus } from "../lib/commerce/catalog.ts";
import {
  authorizeDomain,
  computeMetrics,
  handleStripeEvent,
  issueLicenseKey,
  reconcilePurchase,
  setLicenseStatus,
  updateInstallation,
  type FulfillmentDeps,
} from "../lib/commerce/fulfillment.ts";
import { hashLicenseKey, isWellFormedLicenseKey, licenseKeyMatches } from "../lib/commerce/license-keys.ts";
import { decideAdmin } from "../lib/commerce/authz.ts";
import { normalizeDomain, parsePriceToCents, parseProductForm, ValidationError } from "../lib/commerce/validation.ts";
import type { NewProduct } from "../lib/commerce/types.ts";

const CALCULATOR: NewProduct = {
  slug: "monarch-basic-tax-calculator",
  name: "Monarch Basic Tax Calculator",
  description: "Embeddable federal tax estimator.",
  product_type: "software",
  access_type: "license",
  installation_options: ["self_service", "done_for_you"],
  price_cents: 7500,
  currency: "usd",
  stripe_product_id: "prod_TESTCALC123",
  stripe_price_id: null,
  status: "draft",
};

async function setup() {
  const repo = new MemoryRepo();
  const product = await createProduct(repo, CALCULATOR);
  const deps: FulfillmentDeps = { repo, listCheckoutProductIds: async () => ["prod_TESTCALC123"] };
  return { repo, product, deps };
}

function checkoutCompleted(eventId: string, pi = "pi_TEST000001", extra: Record<string, unknown> = {}) {
  return {
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        payment_status: "paid",
        payment_intent: pi,
        amount_total: 7500,
        currency: "usd",
        customer: "cus_TEST1",
        customer_details: { email: "Buyer@Example.com", name: "Test Buyer" },
        metadata: { installation_type: "done_for_you" },
        ...extra,
      },
    },
  };
}

describe("products", () => {
  test("create, edit and persist across reloads", async () => {
    const { repo, product } = await setup();
    assert.equal(product.status, "draft");
    const edited = await editProduct(repo, product.id, { ...CALCULATOR, name: "Monarch Basic Tax Calculator 2026" });
    assert.equal(edited.name, "Monarch Basic Tax Calculator 2026");
    // A "refresh" is a fresh read from the store.
    const reloaded = await repo.getProduct(product.id);
    assert.equal(reloaded?.name, "Monarch Basic Tax Calculator 2026");
    assert.equal((await repo.listProducts()).length, 1);
  });

  test("duplicate identifiers are rejected", async () => {
    const { repo } = await setup();
    await assert.rejects(createProduct(repo, CALCULATOR), ValidationError);
  });

  test("publish, unpublish, archive lifecycle and publish blockers", async () => {
    const { repo, product } = await setup();
    assert.equal((await setProductStatus(repo, product.id, "published")).status, "published");
    assert.equal((await setProductStatus(repo, product.id, "unpublished")).status, "unpublished");
    assert.equal((await setProductStatus(repo, product.id, "archived")).status, "archived");
    await assert.rejects(setProductStatus(repo, product.id, "published"), ValidationError);

    const unpriced = await createProduct(repo, { ...CALCULATOR, slug: "unpriced", price_cents: null });
    await assert.rejects(setProductStatus(repo, unpriced.id, "published"), /verified price/);
  });

  test("form parsing validates and sanitizes input", () => {
    const form = new FormData();
    form.set("name", "  Monarch   Basic Tax Calculator ");
    form.set("product_type", "software");
    form.set("access_type", "license");
    form.append("installation_options", "self_service");
    form.append("installation_options", "done_for_you");
    form.set("price", "$75.00");
    form.set("stripe_product_id", "prod_VMBCU4J5IZb61R");
    const parsed = parseProductForm(form);
    assert.equal(parsed.name, "Monarch Basic Tax Calculator");
    assert.equal(parsed.slug, "monarch-basic-tax-calculator");
    assert.equal(parsed.price_cents, 7500);
    form.set("product_type", "weapon");
    assert.throws(() => parseProductForm(form), ValidationError);
    assert.equal(parsePriceToCents(""), null);
    assert.throws(() => parsePriceToCents("75.999"), ValidationError);
  });
});

describe("stripe fulfillment", () => {
  test("successful checkout creates customer, order, pending license and installation", async () => {
    const { repo, deps } = await setup();
    const outcome = await handleStripeEvent(deps, checkoutCompleted("evt_1"));
    assert.equal(outcome.status, "processed");
    assert.equal(repo.customers.length, 1);
    assert.equal(repo.customers[0].email, "buyer@example.com");
    assert.equal(repo.orders.length, 1);
    assert.equal(repo.orders[0].payment_status, "paid");
    assert.equal(repo.orders[0].installation_type, "done_for_you");
    assert.equal(repo.licenses.length, 1);
    assert.equal(repo.licenses[0].status, "pending");
    assert.equal(repo.licenses[0].key_hash, null);
    assert.equal(repo.installations.length, 1);
    assert.equal(repo.installations[0].status, "requested");
  });

  test("missing checkout platform is recorded as other with a follow-up note", async () => {
    const { repo, deps } = await setup();
    await handleStripeEvent(deps, checkoutCompleted("evt_1"));
    assert.equal(repo.installations[0].platform, "other");
    assert.match(repo.installationEvents[0].note ?? "", /were not provided; send the customer an installation details link/);
    await handleStripeEvent(deps, checkoutCompleted("evt_2", "pi_TEST000005", { metadata: { installation_type: "done_for_you", platform: "gohighlevel" } }));
    assert.equal(repo.installations[1].platform, "gohighlevel");
  });

  test("duplicate deliveries and replays never duplicate records", async () => {
    const { repo, deps } = await setup();
    await handleStripeEvent(deps, checkoutCompleted("evt_1"));
    assert.equal((await handleStripeEvent(deps, checkoutCompleted("evt_1"))).status, "duplicate");
    // Same payment, different event id (e.g. async_payment_succeeded after completed).
    await handleStripeEvent(deps, { ...checkoutCompleted("evt_2"), type: "checkout.session.async_payment_succeeded" });
    await handleStripeEvent(deps, { id: "evt_3", type: "payment_intent.succeeded", data: { object: { id: "pi_TEST000001" } } });
    assert.equal(repo.customers.length, 1);
    assert.equal(repo.orders.length, 1);
    assert.equal(repo.licenses.length, 1);
    assert.equal(repo.installations.length, 1);
  });

  test("unpaid checkout and failed payment do not grant access", async () => {
    const { repo, deps } = await setup();
    await handleStripeEvent(deps, checkoutCompleted("evt_1", "pi_TEST000002", { payment_status: "unpaid" }));
    assert.equal(repo.orders[0].payment_status, "pending");
    assert.equal(repo.licenses.length, 0);
    await handleStripeEvent(deps, { id: "evt_2", type: "payment_intent.payment_failed", data: { object: { id: "pi_TEST000002" } } });
    assert.equal(repo.orders[0].payment_status, "failed");
    assert.equal(repo.licenses.length, 0);
    assert.equal(repo.installations.length, 0);
  });

  test("full refund revokes the license; partial refund does not", async () => {
    const { repo, deps } = await setup();
    await handleStripeEvent(deps, checkoutCompleted("evt_1"));
    await issueLicenseKey(repo, repo.licenses[0].id, "admin");
    await handleStripeEvent(deps, { id: "evt_r1", type: "charge.refunded", data: { object: { payment_intent: "pi_TEST000001", amount: 7500, amount_refunded: 2500 } } });
    assert.equal(repo.orders[0].payment_status, "partially_refunded");
    assert.equal(repo.licenses[0].status, "active");
    await handleStripeEvent(deps, { id: "evt_r2", type: "charge.refunded", data: { object: { payment_intent: "pi_TEST000001", amount: 7500, amount_refunded: 7500 } } });
    assert.equal(repo.orders[0].payment_status, "refunded");
    assert.equal(repo.licenses[0].status, "revoked");
    await assert.rejects(issueLicenseKey(repo, repo.licenses[0].id, "admin"), ValidationError);
  });

  test("dispute suspends the license", async () => {
    const { repo, deps } = await setup();
    await handleStripeEvent(deps, checkoutCompleted("evt_1"));
    await issueLicenseKey(repo, repo.licenses[0].id, "admin");
    await handleStripeEvent(deps, { id: "evt_d", type: "charge.dispute.created", data: { object: { payment_intent: "pi_TEST000001" } } });
    assert.equal(repo.orders[0].payment_status, "disputed");
    assert.equal(repo.licenses[0].status, "suspended");
  });

  test("checkouts for other products are ignored", async () => {
    const { repo } = await setup();
    const deps: FulfillmentDeps = { repo, listCheckoutProductIds: async () => ["prod_SOMETHINGELSE"] };
    assert.equal((await handleStripeEvent(deps, checkoutCompleted("evt_1"))).status, "ignored");
    assert.equal(repo.orders.length, 0);
  });

  test("a failed handler is retried on redelivery", async () => {
    const { repo } = await setup();
    let calls = 0;
    const deps: FulfillmentDeps = {
      repo,
      listCheckoutProductIds: async () => {
        if (calls++ === 0) throw new Error("Stripe unavailable");
        return ["prod_TESTCALC123"];
      },
    };
    await assert.rejects(handleStripeEvent(deps, checkoutCompleted("evt_1")));
    assert.equal(repo.events.get("evt_1")?.status, "failed");
    assert.equal((await handleStripeEvent(deps, checkoutCompleted("evt_1"))).status, "processed");
    assert.equal(repo.orders.length, 1);
  });
});

describe("manual reconciliation", () => {
  const base = {
    email: "customer@example.com",
    full_name: "Real Customer",
    payment_intent_id: "pi_3UOS6UPos8bgFzRf",
    amount_cents: 7500,
    currency: "usd",
    installation_type: "done_for_you" as const,
    platform: "gohighlevel" as const,
    platform_other: null,
    website_url: null,
    target_location: null,
    notes: null,
    admin_id: "admin-1",
  };

  test("requires Stripe verification or admin attestation", async () => {
    const { repo, product } = await setup();
    await assert.rejects(reconcilePurchase(repo, { ...base, product_id: product.id, stripe_payment: null, admin_attested: false }), /verified this payment/);
    assert.equal(repo.orders.length, 0);
  });

  test("rejects mismatched Stripe amount, status or email", async () => {
    const { repo, product } = await setup();
    const input = { ...base, product_id: product.id, admin_attested: false };
    await assert.rejects(reconcilePurchase(repo, { ...input, stripe_payment: { status: "requires_payment_method", amount_received: 0, currency: "usd", email: null } }), /not succeeded/);
    await assert.rejects(reconcilePurchase(repo, { ...input, stripe_payment: { status: "succeeded", amount_received: 5000, currency: "usd", email: null } }), /does not match/);
    await assert.rejects(reconcilePurchase(repo, { ...input, stripe_payment: { status: "succeeded", amount_received: 7500, currency: "usd", email: "someone@else.com" } }), /email does not match/);
    assert.equal(repo.orders.length, 0);
  });

  test("creates Done For You records once and is idempotent", async () => {
    const { repo, product } = await setup();
    const input = { ...base, product_id: product.id, stripe_payment: null, admin_attested: true };
    const first = await reconcilePurchase(repo, input);
    assert.equal(first.order.verification_method, "admin_manual");
    assert.equal(first.installation?.installation_type, "done_for_you");
    assert.equal(first.installation?.platform, "gohighlevel");
    const second = await reconcilePurchase(repo, input);
    assert.equal(second.created, false);
    assert.equal(repo.orders.length, 1);
    assert.equal(repo.licenses.length, 1);
    assert.equal(repo.installations.length, 1);
    await assert.rejects(reconcilePurchase(repo, { ...input, email: "other@example.com" }), /different customer/);
  });
});

describe("licenses", () => {
  test("key issuance stores only a hash and status changes are enforced", async () => {
    const { repo, deps } = await setup();
    await handleStripeEvent(deps, checkoutCompleted("evt_1"));
    const licenseId = repo.licenses[0].id;
    await assert.rejects(setLicenseStatus(repo, licenseId, "active", null, "admin"), /Issue a license key/);
    const { key, license } = await issueLicenseKey(repo, licenseId, "admin");
    assert.ok(isWellFormedLicenseKey(key));
    assert.equal(license.status, "active");
    assert.equal(license.key_hash, hashLicenseKey(key));
    assert.ok(licenseKeyMatches(key, license.key_hash!));
    assert.ok(!JSON.stringify(repo.licenses).includes(key));
    assert.ok(!JSON.stringify(repo.licenseEvents).includes(key));

    await authorizeDomain(repo, licenseId, "https://Clients.Example.com/calculator", "admin");
    assert.equal(repo.domains[0].domain, "clients.example.com");
    assert.ok(repo.licenses[0].activated_at);
    await assert.rejects(authorizeDomain(repo, licenseId, "second.example.com", "admin"), /allows 1 domain/);

    assert.equal((await setLicenseStatus(repo, licenseId, "suspended", null, "admin")).status, "suspended");
    await assert.rejects(setLicenseStatus(repo, licenseId, "revoked", null, "admin"), /reason/);
    assert.equal((await setLicenseStatus(repo, licenseId, "revoked", "Chargeback", "admin")).status, "revoked");
    await assert.rejects(setLicenseStatus(repo, licenseId, "active", null, "admin"), /Revoked/);
  });

  test("domain normalization rejects junk", () => {
    assert.equal(normalizeDomain("WWW.Example.com."), "www.example.com");
    assert.throws(() => normalizeDomain("not a domain"), ValidationError);
    assert.throws(() => normalizeDomain("javascript:alert(1)"), ValidationError);
  });
});

describe("done for you installations", () => {
  test("status updates record history and cannot go active before the license", async () => {
    const { repo, deps } = await setup();
    await handleStripeEvent(deps, checkoutCompleted("evt_1"));
    const id = repo.installations[0].id;
    await updateInstallation(repo, id, { status: "in_progress", platform: "gohighlevel", target_location: "Client funnel /tax-calculator", note: "Kickoff call booked." }, "admin");
    await assert.rejects(updateInstallation(repo, id, { status: "active" }, "admin"), /Activate the license/);
    await updateInstallation(repo, id, { status: "blocked", note: "Waiting on GHL access." }, "admin");
    await issueLicenseKey(repo, repo.licenses[0].id, "admin");
    const done = await updateInstallation(repo, id, { status: "active" }, "admin");
    assert.equal(done.status, "active");
    assert.equal(done.platform, "gohighlevel");
    const history = await repo.listInstallationEvents(id);
    assert.deepEqual(history.map((e) => e.to_status), ["requested", "in_progress", "blocked", "active"]);
  });
});

describe("authorization", () => {
  test("only signed-in administrators are allowed", async () => {
    const admins = new Set(["admin-uid"]);
    const isAdmin = async (id: string) => admins.has(id);
    assert.deepEqual(await decideAdmin(null, isAdmin), { allowed: false, reason: "unauthenticated" });
    assert.deepEqual(await decideAdmin({ id: "customer-uid" }, isAdmin), { allowed: false, reason: "forbidden" });
    assert.deepEqual(await decideAdmin({ id: "admin-uid" }, isAdmin), { allowed: true, userId: "admin-uid" });
  });
});

describe("dashboard metrics", () => {
  test("empty database reports zeros, not sample data", () => {
    const m = computeMetrics({ customers: [], orders: [], products: [], licenses: [], installations: [] });
    assert.deepEqual(m, { customers: 0, paidOrders: 0, revenueByCurrency: {}, publishedProducts: 0, activeLicenses: 0, pendingLicenses: 0, openInstallations: 0 });
  });

  test("revenue is net of refunds and excludes unpaid orders", async () => {
    const { repo, deps } = await setup();
    await handleStripeEvent(deps, checkoutCompleted("evt_1"));
    await handleStripeEvent(deps, checkoutCompleted("evt_2", "pi_TEST000009", { payment_status: "unpaid" }));
    await handleStripeEvent(deps, { id: "evt_r", type: "charge.refunded", data: { object: { payment_intent: "pi_TEST000001", amount: 7500, amount_refunded: 2500 } } });
    const m = computeMetrics({ customers: repo.customers, orders: repo.orders, products: repo.products, licenses: repo.licenses, installations: repo.installations });
    assert.equal(m.revenueByCurrency.usd, 5000);
    assert.equal(m.paidOrders, 1);
    assert.equal(m.openInstallations, 1);
  });
});
