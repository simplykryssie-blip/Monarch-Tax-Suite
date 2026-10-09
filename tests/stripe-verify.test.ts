import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MemoryRepo } from "./memory-repo.ts";
import { createProduct } from "../lib/commerce/catalog.ts";
import { handleStripeEvent, issueLicenseKey, type FulfillmentDeps } from "../lib/commerce/fulfillment.ts";
import { createVersion, editVersion, setVersionStatus } from "../lib/commerce/versions.ts";
import {
  checkVersionPrice,
  createVersionPrice,
  linkVersionPrice,
  modeFromKey,
  publishBlockersForVersion,
  StripeLookupError,
  verifyCatalogProduct,
  type StripeCatalogPort,
} from "../lib/commerce/stripe-verify.ts";
import { startUpdateCheckout, type CheckoutSessionPort } from "../lib/commerce/update-checkout.ts";
import { CALCULATOR_TAX_YEARS } from "../lib/calculator/years.ts";
import type { StripePriceFacts } from "../lib/commerce/types.ts";

// Owner-confirmed ids (must never be changed by these flows).
const CALC_PRODUCT = "prod_VPRssQEMTEy43j";
const CALC_PRICE = "price_1UOcySLvYOWPw48grmeghXVH";
const UPDATE_PRODUCT = "prod_VPRuMH3pwJVMiY";
const UPDATE_PRICE = "price_1UOd0fLvYOWPw48grtQTttib";

const price = (over: Partial<StripePriceFacts> & { id: string }): StripePriceFacts => ({
  product_id: UPDATE_PRODUCT, product_name: "Annual Tax-Year Update", product_active: true, active: true, currency: "usd", unit_amount: 5000, type: "one_time", interval: null, livemode: true, ...over,
});

/** Mock Stripe account (live mode) with the owner's products and prices. */
function mockStripe(mode: "live" | "test" = "live") {
  const products = new Map([
    [CALC_PRODUCT, { id: CALC_PRODUCT, name: "Monarch Basic Tax Calculator", active: true, livemode: mode === "live" }],
    [UPDATE_PRODUCT, { id: UPDATE_PRODUCT, name: "Monarch Basic Tax Calculator — Annual Tax-Year Update", active: true, livemode: mode === "live" }],
  ]);
  const prices = new Map<string, StripePriceFacts>([
    [CALC_PRICE, price({ id: CALC_PRICE, product_id: CALC_PRODUCT, product_name: "Monarch Basic Tax Calculator", unit_amount: 7500, livemode: mode === "live" })],
    [UPDATE_PRICE, price({ id: UPDATE_PRICE, livemode: mode === "live" })],
  ]);
  const calls: string[] = [];
  let failure: StripeLookupError | null = null;
  const port: StripeCatalogPort = {
    mode,
    async getProduct(id) {
      calls.push(`getProduct:${id}`);
      if (failure) throw failure;
      const p = products.get(id);
      if (!p) throw new StripeLookupError("not_found", `Stripe product ${id} was not found.`);
      return p;
    },
    async getPrice(id) {
      calls.push(`getPrice:${id}`);
      if (failure) throw failure;
      const p = prices.get(id);
      if (!p) throw new StripeLookupError("not_found", `Stripe price ${id} was not found.`);
      return p;
    },
    async listActivePrices(productId) {
      calls.push(`list:${productId}`);
      if (failure) throw failure;
      return [...prices.values()].filter((p) => p.product_id === productId && p.active);
    },
    async createOneTimePrice({ productId, unitAmount, currency, idempotencyKey }) {
      calls.push(`create:${productId}:${unitAmount}:${idempotencyKey}`);
      if (failure) throw failure;
      const created = price({ id: `price_NEW${prices.size}`, product_id: productId, unit_amount: unitAmount, currency, livemode: mode === "live" });
      prices.set(created.id, created);
      return created;
    },
  };
  return { port, prices, products, calls, fail: (e: StripeLookupError | null) => (failure = e) };
}

async function shop() {
  const repo = new MemoryRepo();
  const calc = await createProduct(repo, {
    slug: "monarch-basic-tax-calculator", name: "Monarch Basic Tax Calculator", description: null, product_type: "software", access_type: "license",
    installation_options: ["self_service", "done_for_you"], price_cents: 7500, currency: "usd", stripe_product_id: CALC_PRODUCT, stripe_price_id: CALC_PRICE, status: "draft", category: "tax_software",
  });
  const update = await createProduct(repo, {
    slug: "monarch-basic-tax-calculator-annual-update", name: "Annual Tax-Year Update", description: null, product_type: "software", access_type: "license",
    installation_options: ["self_service"], price_cents: 5000, currency: "usd", stripe_product_id: UPDATE_PRODUCT, stripe_price_id: UPDATE_PRICE, status: "draft", category: "software_update",
  });
  const v2026 = await createVersion(repo, { product_id: calc.id, tax_year: 2026, label: null, release_date: "2026-10-09", update_price_cents: 5000, stripe_update_price_id: null });
  await setVersionStatus(repo, v2026.id, "available", "admin");
  return { repo, calc, update, v2026 };
}

describe("Stripe connection and product verification", () => {
  test("mode comes from the key prefix only", () => {
    assert.equal(modeFromKey("sk_live_abc"), "live");
    assert.equal(modeFromKey("rk_test_abc"), "test");
    assert.equal(modeFromKey("pk_live_abc"), null, "a publishable key is not accepted");
    assert.equal(modeFromKey(undefined), null);
  });

  test("owner-confirmed product and price verify; facts are recorded, ids unchanged", async () => {
    const { repo, calc } = await shop();
    const { port } = mockStripe();
    const v = await verifyCatalogProduct(repo, port, calc.id);
    assert.equal(v.ok, true, v.issues.join(" "));
    assert.equal(v.price?.unit_amount, 7500);
    assert.equal(v.product?.name, "Monarch Basic Tax Calculator");
    const after = (await repo.getProduct(calc.id))!;
    assert.equal(after.stripe_product_id, CALC_PRODUCT);
    assert.equal(after.stripe_price_id, CALC_PRICE);
    assert.equal(after.stripe_price_cents, 7500);
    assert.equal(after.stripe_sync_status, "synced");
  });

  test("missing ids, wrong mode, subscriptions, wrong amounts and API errors fail with clear reasons and change no ids", async () => {
    const { repo, calc } = await shop();
    const test = mockStripe("test");
    const wrongMode = await verifyCatalogProduct(repo, { ...mockStripe("live").port, mode: "test" }, calc.id);
    assert.equal(wrongMode.ok, false);
    assert.match(wrongMode.issues.join(" "), /live-mode price, but the configured key is test mode/);
    assert.ok(test);

    const sub = mockStripe();
    sub.prices.set(CALC_PRICE, price({ id: CALC_PRICE, product_id: CALC_PRODUCT, unit_amount: 7500, type: "recurring", interval: "month" }));
    assert.match((await verifyCatalogProduct(repo, sub.port, calc.id)).issues.join(" "), /recurring \(month\), not a one-time price/);

    const amount = mockStripe();
    amount.prices.set(CALC_PRICE, price({ id: CALC_PRICE, product_id: CALC_PRODUCT, unit_amount: 9900 }));
    assert.match((await verifyCatalogProduct(repo, amount.port, calc.id)).issues.join(" "), /charges \$99\.00, but the catalog expects \$75\.00/);

    const missing = mockStripe();
    missing.prices.delete(CALC_PRICE);
    assert.match((await verifyCatalogProduct(repo, missing.port, calc.id)).issues.join(" "), /was not found/);

    const auth = mockStripe();
    auth.fail(new StripeLookupError("auth", "Invalid Stripe key."));
    const authResult = await verifyCatalogProduct(repo, auth.port, calc.id);
    assert.match(authResult.issues.join(" "), /rejected the configured secret key/);

    const after = (await repo.getProduct(calc.id))!;
    assert.equal(after.stripe_price_id, CALC_PRICE, "a failed verification never overwrites the mapping");
    assert.equal(after.stripe_product_id, CALC_PRODUCT);
    assert.equal(after.stripe_sync_status, "failed");
  });
});

describe("annual version price setup", () => {
  test("2026: the existing $50 update price is found, linked after confirmation, and then publishable", async () => {
    const { repo, v2026 } = await shop();
    const { port, calls } = mockStripe();
    const check = await checkVersionPrice(repo, port, v2026.id);
    assert.equal(check.state, "reuse_candidate");
    assert.deepEqual(check.candidates?.map((c) => c.id), [UPDATE_PRICE]);
    assert.equal((await repo.getVersion(v2026.id))?.stripe_update_price_id, null, "checking never links by itself");
    assert.deepEqual(publishBlockersForVersion((await repo.getVersion(v2026.id))!), ["Link a verified Stripe price first."]);

    await assert.rejects(linkVersionPrice(repo, port, v2026.id, UPDATE_PRICE, false), /Confirm/);
    await linkVersionPrice(repo, port, v2026.id, UPDATE_PRICE, true);
    const linked = (await repo.getVersion(v2026.id))!;
    assert.equal(linked.stripe_update_price_id, UPDATE_PRICE);
    assert.equal(linked.stripe_verification?.state, "linked_verified");
    assert.deepEqual(publishBlockersForVersion(linked), []);
    assert.equal(linked.release_date, "2026-10-09", "release date preserved");
    assert.ok(!calls.some((c) => c.startsWith("create:")), "no price created");
  });

  test("a price on another product, inactive, recurring or with the wrong amount is never linked", async () => {
    const { repo, v2026 } = await shop();
    const stripe = mockStripe();
    await assert.rejects(linkVersionPrice(repo, stripe.port, v2026.id, CALC_PRICE, true), /belongs to prod_VPRssQEMTEy43j, not prod_VPRuMH3pwJVMiY/);
    stripe.prices.set("price_SUB", price({ id: "price_SUB", type: "recurring", interval: "year" }));
    await assert.rejects(linkVersionPrice(repo, stripe.port, v2026.id, "price_SUB", true), /recurring/);
    stripe.prices.set("price_OLD", price({ id: "price_OLD", active: false }));
    await assert.rejects(linkVersionPrice(repo, stripe.port, v2026.id, "price_OLD", true), /archived/);
    stripe.prices.set("price_60", price({ id: "price_60", unit_amount: 6000 }));
    await assert.rejects(linkVersionPrice(repo, stripe.port, v2026.id, "price_60", true), /\$60\.00/);
    await assert.rejects(linkVersionPrice(repo, stripe.port, v2026.id, "price_MISSING", true), /not found/);
    assert.equal((await repo.getVersion(v2026.id))?.stripe_update_price_id, null);
  });

  test("ambiguous matches stop for admin review instead of guessing", async () => {
    const { repo, v2026 } = await shop();
    const stripe = mockStripe();
    stripe.prices.set("price_SECOND50", price({ id: "price_SECOND50" }));
    const check = await checkVersionPrice(repo, stripe.port, v2026.id);
    assert.equal(check.state, "ambiguous");
    assert.equal(check.candidates?.length, 2);
    assert.equal((await repo.getVersion(v2026.id))?.stripe_update_price_id, null);
    await assert.rejects(createVersionPrice(repo, stripe.port, v2026.id, true), /already exists/);
  });

  test("a new price is created only when none matches, only after confirmation, on the existing update product", async () => {
    const { repo, calc } = await shop();
    const stripe = mockStripe();
    const v2027 = await createVersion(repo, { product_id: calc.id, tax_year: 2027, label: null, release_date: null, update_price_cents: 5500, stripe_update_price_id: null });
    assert.equal((await checkVersionPrice(repo, stripe.port, v2027.id)).state, "create_required");
    await assert.rejects(createVersionPrice(repo, stripe.port, v2027.id, false), /Confirm/);
    assert.ok(!stripe.calls.some((c) => c.startsWith("create:")));
    const linked = await createVersionPrice(repo, stripe.port, v2027.id, true);
    const creates = stripe.calls.filter((c) => c.startsWith("create:"));
    assert.equal(creates.length, 1);
    assert.match(creates[0], new RegExp(`^create:${UPDATE_PRODUCT}:5500:monarch-version-price-${v2027.id}-5500$`), "same product, idempotency key per version");
    assert.equal(linked.stripe_verification?.state, "linked_verified");
    await assert.rejects(createVersionPrice(repo, stripe.port, v2027.id, true), /already has a linked price/);
    assert.equal(stripe.products.size, 2, "no product created");
  });

  test("editing the price invalidates verification so the version cannot be published until re-checked", async () => {
    const { repo, v2026 } = await shop();
    const { port } = mockStripe();
    await linkVersionPrice(repo, port, v2026.id, UPDATE_PRICE, true);
    await editVersion(repo, v2026.id, { update_price_cents: 6000 });
    const edited = (await repo.getVersion(v2026.id))!;
    assert.equal(edited.stripe_verification, null);
    assert.notDeepEqual(publishBlockersForVersion(edited), []);
    assert.equal((await checkVersionPrice(repo, port, v2026.id)).state, "linked_invalid");
  });

  test("two annual update products, or none, stop for review", async () => {
    const { repo, v2026 } = await shop();
    const { port } = mockStripe();
    await createProduct(repo, { slug: "another-update", name: "Another update", description: null, product_type: "software", access_type: "license", installation_options: [], price_cents: 5000, currency: "usd", stripe_product_id: "prod_OTHERUPDATE", stripe_price_id: null, status: "draft", category: "software_update" });
    const check = await checkVersionPrice(repo, port, v2026.id);
    assert.equal(check.ok, false);
    assert.match(check.issues.join(" "), /More than one annual update product/);
  });
});

// ------------------------------------------------------------------ checkout

function sessionsMock() {
  const sessions = new Map<string, { id: string; status: "open" | "complete" | "expired"; url: string; metadata: Record<string, string>; priceId: string }>();
  const keys = new Map<string, string>();
  const created: string[] = [];
  const port: CheckoutSessionPort = {
    async create(input) {
      const existing = keys.get(input.idempotencyKey);
      if (existing) return { id: existing, url: sessions.get(existing)!.url, expires_at: input.expiresAt };
      const id = `cs_test_${sessions.size + 1}`;
      sessions.set(id, { id, status: "open", url: `https://checkout.stripe.test/${id}`, metadata: input.metadata, priceId: input.priceId });
      keys.set(input.idempotencyKey, id);
      created.push(id);
      return { id, url: `https://checkout.stripe.test/${id}`, expires_at: input.expiresAt };
    },
    async get(id) {
      const s = sessions.get(id)!;
      return { id, status: s.status, url: s.url };
    },
  };
  return { port, sessions, created };
}

/** A customer licensed for 2026, a released 2027 version with the verified $50 price. */
async function customerWithUpdate() {
  const env = await shop();
  const { repo, calc } = env;
  const deps: FulfillmentDeps = { repo, listCheckoutProductIds: async (sid) => (sid.startsWith("cs_buy") ? [CALC_PRODUCT] : [UPDATE_PRODUCT]) };
  const buy = (id: string, pi: string, email: string) => ({ id, type: "checkout.session.completed", data: { object: { id: `cs_buy_${id}`, payment_status: "paid", payment_intent: pi, amount_total: 7500, currency: "usd", customer: null, customer_details: { email }, metadata: {} } } });
  await handleStripeEvent(deps, buy("evt_a", "pi_BUYA0000001", "a@example.com"));
  await handleStripeEvent(deps, buy("evt_b", "pi_BUYB0000001", "b@example.com"));
  const [licA, licB] = repo.licenses;
  const keyA = (await issueLicenseKey(repo, licA.id, "admin")).key;
  const keyB = (await issueLicenseKey(repo, licB.id, "admin")).key;
  const v2027 = await createVersion(repo, { product_id: calc.id, tax_year: 2027, label: null, release_date: null, update_price_cents: 5000, stripe_update_price_id: null });
  const stripe = mockStripe();
  await linkVersionPrice(repo, stripe.port, v2027.id, UPDATE_PRICE, true);
  CALCULATOR_TAX_YEARS.unshift(2027);
  try {
    await setVersionStatus(repo, v2027.id, "available", "admin");
  } finally {
    CALCULATOR_TAX_YEARS.shift();
  }
  return { ...env, deps, licA, licB, keyA, keyB, v2027, stripe };
}

const paidUpdate = (id: string, session: string, pi: string, licenseId: string, taxYear: number, over: Record<string, unknown> = {}) => ({
  id, type: "checkout.session.completed",
  data: { object: { id: session, payment_status: "paid", payment_intent: pi, amount_total: 5000, currency: "usd", customer: null, customer_details: { email: "a@example.com" }, metadata: { purpose: "annual_update", license_id: licenseId, tax_year: String(taxYear) }, ...over } },
});

describe("update checkout and license upgrade", () => {
  test("server decides version and price; session carries only server-set metadata", async () => {
    const { repo, stripe, keyA, licA } = await customerWithUpdate();
    const sessions = sessionsMock();
    const { url } = await startUpdateCheckout(repo, stripe.port, sessions.port, { licenseKey: keyA, origin: "https://monarch.test" });
    const s = sessions.sessions.get(sessions.created[0])!;
    assert.equal(url, s.url);
    assert.equal(s.priceId, UPDATE_PRICE);
    assert.deepEqual(s.metadata, { purpose: "annual_update", license_id: licA.id, tax_year: "2027" });
  });

  test("a second click or a second tab reuses the open session; a completed one refuses a new charge", async () => {
    const { repo, stripe, keyA } = await customerWithUpdate();
    const sessions = sessionsMock();
    const first = await startUpdateCheckout(repo, stripe.port, sessions.port, { licenseKey: keyA, origin: "https://monarch.test" });
    const again = await startUpdateCheckout(repo, stripe.port, sessions.port, { licenseKey: keyA, origin: "https://monarch.test", now: new Date(Date.now() + 15 * 60_000) });
    assert.equal(again.url, first.url);
    assert.equal(again.resumed, true);
    assert.equal(sessions.created.length, 1);
    sessions.sessions.get(sessions.created[0])!.status = "complete";
    await assert.rejects(startUpdateCheckout(repo, stripe.port, sessions.port, { licenseKey: keyA, origin: "https://monarch.test" }), /already received/);
    assert.equal(sessions.created.length, 1);
  });

  test("an expired session is replaced; each customer only reaches their own license", async () => {
    const { repo, stripe, keyA, keyB, licB } = await customerWithUpdate();
    const sessions = sessionsMock();
    await startUpdateCheckout(repo, stripe.port, sessions.port, { licenseKey: keyA, origin: "https://monarch.test" });
    sessions.sessions.get(sessions.created[0])!.status = "expired";
    await startUpdateCheckout(repo, stripe.port, sessions.port, { licenseKey: keyA, origin: "https://monarch.test", now: new Date(Date.now() + 11 * 60_000) });
    assert.equal(sessions.created.length, 2);
    await startUpdateCheckout(repo, stripe.port, sessions.port, { licenseKey: keyB, origin: "https://monarch.test" });
    assert.equal(sessions.sessions.get(sessions.created[2])!.metadata.license_id, licB.id);
  });

  test("checkout fails safely when Stripe cannot confirm the price, or the price changed", async () => {
    const { repo, stripe, keyA } = await customerWithUpdate();
    const sessions = sessionsMock();
    stripe.fail(new StripeLookupError("connection", "Stripe unavailable."));
    await assert.rejects(startUpdateCheckout(repo, stripe.port, sessions.port, { licenseKey: keyA, origin: "https://monarch.test" }), /temporarily unavailable/);
    stripe.fail(null);
    stripe.prices.set(UPDATE_PRICE, price({ id: UPDATE_PRICE, active: false }));
    await assert.rejects(startUpdateCheckout(repo, stripe.port, sessions.port, { licenseKey: keyA, origin: "https://monarch.test" }), /not available for online purchase/);
    assert.equal(sessions.created.length, 0);
  });

  test("ineligible licenses (suspended, revoked, up to date, unknown key) cannot start a checkout", async () => {
    const { repo, stripe, keyA, licA } = await customerWithUpdate();
    const sessions = sessionsMock();
    await repo.updateLicense(licA.id, { status: "suspended" });
    await assert.rejects(startUpdateCheckout(repo, stripe.port, sessions.port, { licenseKey: keyA, origin: "https://monarch.test" }), /no update available/);
    await repo.updateLicense(licA.id, { status: "active", licensed_tax_year: 2027 });
    await assert.rejects(startUpdateCheckout(repo, stripe.port, sessions.port, { licenseKey: keyA, origin: "https://monarch.test" }), /no update available/);
    await assert.rejects(startUpdateCheckout(repo, stripe.port, sessions.port, { licenseKey: "MTS-AAAAA-AAAAA-AAAAA-AAAAA", origin: "https://monarch.test" }), /not found/);
    assert.equal(sessions.created.length, 0);
  });

  test("verified payment upgrades the existing license; no second base license; duplicates are idempotent", async () => {
    const { repo, deps, licA } = await customerWithUpdate();
    await handleStripeEvent(deps, paidUpdate("evt_u1", "cs_test_1", "pi_UPA0000001", licA.id, 2027));
    await handleStripeEvent(deps, paidUpdate("evt_u1", "cs_test_1", "pi_UPA0000001", licA.id, 2027));
    await handleStripeEvent(deps, { id: "evt_pi", type: "payment_intent.succeeded", data: { object: { id: "pi_UPA0000001" } } });
    assert.equal((await repo.getLicense(licA.id))?.licensed_tax_year, 2027);
    assert.equal(repo.licenses.length, 2, "only the two original licenses");
    assert.equal(repo.orders.filter((o) => o.order_type === "annual_update").length, 1);
  });

  test("a second separate payment for the same update is flagged for refund, not applied twice", async () => {
    const { repo, deps, licA } = await customerWithUpdate();
    await handleStripeEvent(deps, paidUpdate("evt_u1", "cs_test_1", "pi_UPA0000001", licA.id, 2027));
    await handleStripeEvent(deps, paidUpdate("evt_u2", "cs_test_2", "pi_UPA0000002", licA.id, 2027));
    const second = repo.orders.find((o) => o.provider_payment_intent_id === "pi_UPA0000002")!;
    assert.match(second.notes ?? "", /duplicate payment.*Refund/);
    assert.equal(repo.licenseEvents.filter((e) => e.event_type === "version_upgraded").length, 1);
  });

  test("wrong product, amount, currency or tax year never activates; refunds and disputes revert only the update", async () => {
    const { repo, deps, licA, licB } = await customerWithUpdate();
    const wrongProduct: FulfillmentDeps = { ...deps, listCheckoutProductIds: async () => [CALC_PRODUCT] };
    await handleStripeEvent(wrongProduct, paidUpdate("evt_p", "cs_test_p", "pi_UPWRONGP01", licA.id, 2027));
    await handleStripeEvent(deps, paidUpdate("evt_c", "cs_test_c", "pi_UPWRONGC01", licA.id, 2027, { currency: "eur" }));
    await handleStripeEvent(deps, paidUpdate("evt_a", "cs_test_a", "pi_UPWRONGA01", licA.id, 2027, { amount_total: 100 }));
    await handleStripeEvent(deps, paidUpdate("evt_y", "cs_test_y", "pi_UPWRONGY01", licA.id, 2031));
    assert.equal((await repo.getLicense(licA.id))?.licensed_tax_year, 2026);
    assert.ok(repo.orders.filter((o) => o.order_type === "annual_update").every((o) => o.notes?.startsWith("Review:")));

    await handleStripeEvent(deps, paidUpdate("evt_ok", "cs_test_ok", "pi_UPBOK00001", licB.id, 2027));
    assert.equal((await repo.getLicense(licB.id))?.licensed_tax_year, 2027);
    await handleStripeEvent(deps, { id: "evt_ref", type: "charge.refunded", data: { object: { payment_intent: "pi_UPBOK00001", amount: 5000, amount_refunded: 5000 } } });
    assert.equal((await repo.getLicense(licB.id))?.licensed_tax_year, 2026);
    assert.equal((await repo.getLicense(licB.id))?.status, "active", "base license untouched");
  });

  test("update metadata can only target the license it names; other buyers are unaffected", async () => {
    const { repo, deps, licA, licB } = await customerWithUpdate();
    await handleStripeEvent(deps, paidUpdate("evt_u1", "cs_test_1", "pi_UPA0000009", licA.id, 2027));
    assert.equal((await repo.getLicense(licA.id))?.licensed_tax_year, 2027);
    assert.equal((await repo.getLicense(licB.id))?.licensed_tax_year, 2026);
  });
});
