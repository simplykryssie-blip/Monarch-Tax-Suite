import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MemoryRepo } from "./memory-repo.ts";
import { createProduct } from "../lib/commerce/catalog.ts";
import { handleStripeEvent, issueLicenseKey, type FulfillmentDeps } from "../lib/commerce/fulfillment.ts";
import {
  assertOneTimeUpdatePrice,
  createVersion,
  licensedYears,
  lookupUpdate,
  recordChange,
  setVersionStatus,
  updateOffer,
} from "../lib/commerce/versions.ts";
import { ValidationError } from "../lib/commerce/validation.ts";
import { CALCULATOR_TAX_YEARS } from "../lib/calculator/years.ts";
import type { NewProduct } from "../lib/commerce/types.ts";

const PRODUCT: NewProduct = {
  slug: "monarch-basic-tax-calculator",
  name: "Monarch Basic Tax Calculator",
  description: null,
  product_type: "software",
  access_type: "license",
  installation_options: ["self_service", "done_for_you"],
  price_cents: 7500,
  currency: "usd",
  stripe_product_id: "prod_TESTCALC123",
  stripe_price_id: null,
  status: "draft",
};

const purchaseEvent = (id: string, pi: string, email = "buyer@example.com") => ({
  id,
  type: "checkout.session.completed",
  data: { object: { id: `cs_${id}`, payment_status: "paid", payment_intent: pi, amount_total: 7500, currency: "usd", customer: null, customer_details: { email, name: "Buyer" }, metadata: {} } },
});

const updateEvent = (id: string, pi: string, licenseId: string, taxYear: number, opts: { paid?: boolean; amount?: number; type?: string } = {}) => ({
  id,
  type: opts.type ?? "checkout.session.completed",
  data: {
    object: {
      id: `cs_${id}`,
      payment_status: opts.paid === false ? "unpaid" : "paid",
      payment_intent: pi,
      amount_total: opts.amount ?? 5000,
      currency: "usd",
      customer: null,
      customer_details: { email: "buyer@example.com", name: "Buyer" },
      metadata: { purpose: "annual_update", license_id: licenseId, tax_year: String(taxYear) },
    },
  },
});

/** A shop with a released 2026 version and a released 2027 version (the build is extended for the test). */
async function setup({ release2027 = true } = {}) {
  const repo = new MemoryRepo();
  const product = await createProduct(repo, PRODUCT);
  const v2026 = await createVersion(repo, { product_id: product.id, tax_year: 2026, label: null, release_date: null, update_price_cents: 5000, stripe_update_price_id: null });
  await setVersionStatus(repo, v2026.id, "available", "admin");
  const deps: FulfillmentDeps = { repo, listCheckoutProductIds: async () => ["prod_TESTCALC123"] };
  await handleStripeEvent(deps, purchaseEvent("evt_buy", "pi_BUY0000001"));
  const licenseId = repo.licenses[0].id;
  const { key } = await issueLicenseKey(repo, licenseId, "admin");
  let v2027 = null;
  if (release2027) {
    v2027 = await createVersion(repo, { product_id: product.id, tax_year: 2027, label: null, release_date: "2027-10-01", update_price_cents: 5000, stripe_update_price_id: "price_UPDATE2027" });
    CALCULATOR_TAX_YEARS.unshift(2027); // simulate shipping 2027 calculator code
    try {
      await setVersionStatus(repo, v2027.id, "available", "admin");
    } finally {
      CALCULATOR_TAX_YEARS.shift();
    }
  }
  return { repo, deps, product, licenseId, key, v2026, v2027 };
}

describe("one-time purchase with versioned license", () => {
  test("1-2. a purchase issues a license for the current tax year and records one purchase order", async () => {
    const { repo, licenseId } = await setup({ release2027: false });
    const license = await repo.getLicense(licenseId);
    assert.equal(license?.original_tax_year, 2026);
    assert.equal(license?.licensed_tax_year, 2026);
    assert.equal(repo.orders.length, 1);
    assert.equal(repo.orders[0].order_type, "purchase");
    assert.deepEqual(licensedYears(license!), [2026, 2025]);
  });

  test("3. the customer sees a $50 one-time update only when a newer version is released", async () => {
    const { repo, licenseId, key } = await setup({ release2027: false });
    const before = await lookupUpdate(repo, key);
    assert.equal(before.offer.eligible, false);

    const { repo: repo2, key: key2 } = await setup();
    const after = await lookupUpdate(repo2, key2);
    assert.equal(after.offer.eligible, true);
    if (after.offer.eligible) {
      assert.equal(after.offer.currentYear, 2026);
      assert.equal(after.offer.version.tax_year, 2027);
      assert.equal(after.offer.priceCents, 5000);
    }
    void licenseId;
  });

  test("a version cannot be released before its calculator code is deployed", async () => {
    const { repo, product } = await setup({ release2027: false });
    const v2028 = await createVersion(repo, { product_id: product.id, tax_year: 2028, label: null, release_date: null, update_price_cents: 5000, stripe_update_price_id: null });
    await assert.rejects(setVersionStatus(repo, v2028.id, "available", "admin"), /does not contain 2028 tax data/);
  });
});

describe("annual update payments", () => {
  test("4-5. a paid update upgrades the existing license once, without a second purchase order", async () => {
    const { repo, deps, licenseId } = await setup();
    await handleStripeEvent(deps, updateEvent("evt_up", "pi_UPD0000001", licenseId, 2027));
    assert.equal((await repo.getLicense(licenseId))?.licensed_tax_year, 2027);
    assert.equal((await repo.getLicense(licenseId))?.original_tax_year, 2026);

    // Duplicate delivery, and a second event for the same payment.
    assert.equal((await handleStripeEvent(deps, updateEvent("evt_up", "pi_UPD0000001", licenseId, 2027))).status, "duplicate");
    await handleStripeEvent(deps, { id: "evt_pi", type: "payment_intent.succeeded", data: { object: { id: "pi_UPD0000001" } } });

    const updates = repo.orders.filter((o) => o.order_type === "annual_update");
    assert.equal(updates.length, 1);
    assert.equal(repo.orders.filter((o) => o.order_type === "purchase").length, 1);
    assert.equal(updates[0].license_id, licenseId);
    assert.equal(updates[0].previous_tax_year, 2026);
    assert.equal(updates[0].amount_cents, 5000);
    assert.equal(repo.licenses.length, 1, "no new license is created");
    assert.equal(repo.licenseEvents.filter((e) => e.event_type === "version_upgraded").length, 1);
    assert.deepEqual(licensedYears((await repo.getLicense(licenseId))!), [2026, 2025].filter((y) => y <= 2027));
  });

  test("6. an unpaid or failed update payment does not upgrade", async () => {
    const { repo, deps, licenseId } = await setup();
    await handleStripeEvent(deps, updateEvent("evt_up", "pi_UPD0000002", licenseId, 2027, { paid: false }));
    assert.equal((await repo.getLicense(licenseId))?.licensed_tax_year, 2026);
    await handleStripeEvent(deps, { id: "evt_fail", type: "payment_intent.payment_failed", data: { object: { id: "pi_UPD0000002" } } });
    assert.equal(repo.orders.find((o) => o.order_type === "annual_update")?.payment_status, "failed");
    assert.equal((await repo.getLicense(licenseId))?.licensed_tax_year, 2026);

    // An async payment that later succeeds does upgrade.
    const fresh = await setup();
    await handleStripeEvent(fresh.deps, updateEvent("evt_up", "pi_UPD0000003", fresh.licenseId, 2027, { paid: false }));
    await handleStripeEvent(fresh.deps, { id: "evt_ok", type: "payment_intent.succeeded", data: { object: { id: "pi_UPD0000003" } } });
    assert.equal((await fresh.repo.getLicense(fresh.licenseId))?.licensed_tax_year, 2027);
  });

  test("a payment that does not match the update price is recorded for review, not applied", async () => {
    const { repo, deps, licenseId } = await setup();
    await handleStripeEvent(deps, updateEvent("evt_up", "pi_UPD0000004", licenseId, 2027, { amount: 100 }));
    assert.equal((await repo.getLicense(licenseId))?.licensed_tax_year, 2026);
    assert.match(repo.orders.find((o) => o.order_type === "annual_update")?.notes ?? "", /^Review:/);
  });

  test("7. a refunded or disputed update reverts only that update; the base license stays active", async () => {
    const { repo, deps, licenseId } = await setup();
    await handleStripeEvent(deps, updateEvent("evt_up", "pi_UPD0000005", licenseId, 2027));
    await handleStripeEvent(deps, { id: "evt_ref", type: "charge.refunded", data: { object: { payment_intent: "pi_UPD0000005", amount: 5000, amount_refunded: 5000 } } });
    const after = await repo.getLicense(licenseId);
    assert.equal(after?.licensed_tax_year, 2026);
    assert.equal(after?.status, "active");

    const d = await setup();
    await handleStripeEvent(d.deps, updateEvent("evt_up", "pi_UPD0000006", d.licenseId, 2027));
    await handleStripeEvent(d.deps, { id: "evt_dis", type: "charge.dispute.created", data: { object: { payment_intent: "pi_UPD0000006" } } });
    assert.equal((await d.repo.getLicense(d.licenseId))?.licensed_tax_year, 2026);
    assert.equal((await d.repo.getLicense(d.licenseId))?.status, "active");

    // A refund of the original purchase still revokes the license (existing policy).
    await handleStripeEvent(d.deps, { id: "evt_ref2", type: "charge.refunded", data: { object: { payment_intent: "pi_BUY0000001", amount: 7500, amount_refunded: 7500 } } });
    assert.equal((await d.repo.getLicense(d.licenseId))?.status, "revoked");
  });

  test("8. skipping an update keeps the licensed version, and retiring a version never removes access", async () => {
    const { repo, licenseId, v2026 } = await setup();
    assert.equal((await repo.getLicense(licenseId))?.licensed_tax_year, 2026);
    await setVersionStatus(repo, v2026.id, "retired", "admin");
    const license = await repo.getLicense(licenseId);
    assert.equal(license?.licensed_tax_year, 2026);
    assert.equal(license?.status, "active");
    assert.deepEqual(licensedYears(license!), [2026, 2025]);
  });

  test("9. maintenance fixes are recorded without any order or charge", async () => {
    const { repo, v2026 } = await setup();
    const ordersBefore = repo.orders.length;
    await recordChange(repo, v2026.id, "maintenance", "Corrected the head-of-household 22% bracket threshold.", "admin");
    assert.equal(repo.orders.length, ordersBefore);
    assert.equal(repo.versionChanges.filter((c) => c.kind === "maintenance").length, 1);
  });
});

describe("ownership and billing safety", () => {
  test("10. a customer can only reach their own license, by its key", async () => {
    const { repo, deps, key } = await setup();
    await handleStripeEvent(deps, purchaseEvent("evt_buy2", "pi_BUY0000002", "other@example.com"));
    const other = repo.licenses.find((l) => l.customer_id !== repo.licenses[0].customer_id)!;
    const { key: otherKey } = await issueLicenseKey(repo, other.id, "admin");
    const mine = await lookupUpdate(repo, key);
    const theirs = await lookupUpdate(repo, otherKey);
    assert.notEqual(mine.license.id, theirs.license.id);
    assert.equal(mine.customer.email, "buyer@example.com");
    await assert.rejects(lookupUpdate(repo, "MTS-AAAAA-AAAAA-AAAAA-AAAAA"), /not found/);
    await assert.rejects(lookupUpdate(repo, "not-a-key"), ValidationError);
  });

  test("11. only active one-time prices are accepted; subscriptions are refused", async () => {
    const { v2027 } = await setup();
    const version = v2027!;
    assert.doesNotThrow(() => assertOneTimeUpdatePrice({ active: true, type: "one_time", unit_amount: 5000, currency: "usd", recurring: null }, version));
    assert.throws(() => assertOneTimeUpdatePrice({ active: true, type: "recurring", unit_amount: 5000, currency: "usd", recurring: { interval: "year" } }, version), /not a subscription/);
    assert.throws(() => assertOneTimeUpdatePrice({ active: true, type: "one_time", unit_amount: 7500, currency: "usd", recurring: null }, version), /does not match/);
    assert.throws(() => assertOneTimeUpdatePrice({ active: false, type: "one_time", unit_amount: 5000, currency: "usd", recurring: null }, version), /not active/);
  });

  test("revoked licenses are not offered updates and paid updates do not revive them", async () => {
    const { repo, deps, licenseId } = await setup();
    await handleStripeEvent(deps, { id: "evt_ref", type: "charge.refunded", data: { object: { payment_intent: "pi_BUY0000001", amount: 7500, amount_refunded: 7500 } } });
    const license = (await repo.getLicense(licenseId))!;
    assert.equal(updateOffer(license, await repo.listVersions(license.product_id)).eligible, false);
    await handleStripeEvent(deps, updateEvent("evt_up", "pi_UPD0000007", licenseId, 2027));
    assert.equal((await repo.getLicense(licenseId))?.licensed_tax_year, 2026);
    assert.equal((await repo.getLicense(licenseId))?.status, "revoked");
  });

  test("12. existing licenses, installations and data are untouched by version releases", async () => {
    const { repo } = await setup();
    assert.equal(repo.installations.length, 1);
    assert.equal(repo.customers.length, 1);
    assert.equal(repo.installations[0].status, "requested");
  });
});
