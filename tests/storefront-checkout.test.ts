import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { MemoryRepo, makeSellable } from "./memory-repo.ts";
import { createProduct, setProductStatus } from "../lib/commerce/catalog.ts";
import { handleStripeEvent, type FulfillmentDeps } from "../lib/commerce/fulfillment.ts";
import { CHECKOUT_PURPOSE, expireOpenCheckouts, startStorefrontCheckout, type StorefrontSessionPort } from "../lib/commerce/storefront-checkout.ts";
import { StripeLookupError, type StripeCatalogPort } from "../lib/commerce/stripe-verify.ts";
import { parseMetadata, publishBlockers } from "../lib/commerce/validation.ts";
import type { NewProduct, StripePriceFacts } from "../lib/commerce/types.ts";

// Phase 1 step F2: storefront checkout is always started by the server, and the webhook fulfils only those sessions.

const PRODUCT: NewProduct = {
  slug: "monarch-basic-tax-calculator",
  name: "Monarch Basic Tax Calculator",
  description: "Embeddable federal tax estimator.",
  product_type: "software",
  access_type: "license",
  installation_options: ["self_service", "done_for_you"],
  price_cents: 7500,
  currency: "usd",
  stripe_product_id: "prod_TESTCALC123",
  stripe_price_id: "price_TESTCALC123",
  status: "draft",
  category: "tax_software",
};
const VERSION = "2026-10-09";
const ORIGIN = "https://shop.test";

function catalog(over: Partial<StripePriceFacts> = {}) {
  let failure: Error | null = null;
  const port: StripeCatalogPort = {
    mode: "test",
    async getProduct(id) { return { id, name: "x", active: true, livemode: false }; },
    async getPrice(id) {
      if (failure) throw failure;
      return { id, product_id: id === "price_OTHER0001" ? "prod_OTHER00001" : "prod_TESTCALC123", product_name: "Monarch Basic Tax Calculator", product_active: true, active: true, currency: "usd", unit_amount: 7500, type: "one_time", interval: null, livemode: false, ...over };
    },
    async listActivePrices() { return []; },
    async createOneTimePrice() { throw new Error("not used"); },
  };
  return { port, fail: (e: Error) => { failure = e; } };
}

function sessions() {
  const created: { id: string; priceId: string; metadata: Record<string, string>; successUrl: string; cancelUrl: string }[] = [];
  const expired: string[] = [];
  const port: StorefrontSessionPort = {
    async create(input) {
      const id = `cs_test_shop${created.length + 1}`;
      created.push({ id, ...input });
      return { id, url: `https://checkout.stripe.test/${id}`, expires_at: input.expiresAt };
    },
    async expire(id) { expired.push(id); },
  };
  return { port, created, expired };
}

async function shop() {
  const repo = new MemoryRepo();
  const product = await createProduct(repo, PRODUCT);
  await makeSellable(repo, product.id);
  await setProductStatus(repo, product.id, "published");
  const deps: FulfillmentDeps = { repo, listCheckoutProductIds: async () => ["prod_TESTCALC123"] };
  return { repo, product, deps };
}

const start = (repo: MemoryRepo, cat: StripeCatalogPort, ses: StorefrontSessionPort, over: Partial<Parameters<typeof startStorefrontCheckout>[3]> = {}) =>
  startStorefrontCheckout(repo, cat, ses, { slug: PRODUCT.slug, installationType: "done_for_you", termsAccepted: true, termsVersion: VERSION, origin: ORIGIN, ...over });

const paid = (eventId: string, sessionId: string, over: Record<string, unknown> = {}) => ({
  id: eventId,
  type: "checkout.session.completed",
  data: { object: { id: sessionId, payment_status: "paid", payment_intent: `pi_${eventId}0000`, amount_total: 7500, currency: "usd", customer: null, customer_details: { email: "buyer@example.com", name: "Buyer" }, metadata: {}, ...over } },
});

describe("starting a storefront checkout", () => {
  test("the server sets the price, metadata and return pages, and records the accepted Terms version", async () => {
    const { repo, product } = await shop();
    const s = sessions();
    const { url } = await start(repo, catalog().port, s.port);
    assert.equal(url, "https://checkout.stripe.test/cs_test_shop1");
    const [created] = s.created;
    assert.equal(created.priceId, "price_TESTCALC123");
    assert.equal(created.metadata.purpose, CHECKOUT_PURPOSE);
    assert.equal(created.metadata.product_id, product.id);
    assert.equal(created.metadata.terms_version, VERSION);
    assert.equal(created.metadata.installation_type, "done_for_you");
    assert.equal(created.successUrl, `${ORIGIN}/shop/${PRODUCT.slug}/thank-you`);
    const [row] = repo.storefrontCheckouts;
    assert.equal(row.stripe_session_id, "cs_test_shop1");
    assert.equal(row.amount_cents, 7500);
    assert.equal(row.terms_version, VERSION);
    assert.equal(row.status, "open");
  });

  test("the Terms and Refund Policy must be accepted", async () => {
    const { repo } = await shop();
    const s = sessions();
    await assert.rejects(start(repo, catalog().port, s.port, { termsAccepted: false }), /accept the Terms of Service and the Refund Policy/);
    assert.equal(s.created.length, 0);
  });

  test("draft, unpublished, archived, unknown and annual-update products cannot be bought (forged requests included)", async () => {
    const { repo, product } = await shop();
    const s = sessions();
    await assert.rejects(start(repo, catalog().port, s.port, { slug: "no-such-product" }), /not available for online purchase/);
    const draft = await createProduct(repo, { ...PRODUCT, slug: "draft-product", stripe_product_id: "prod_DRAFT00001" });
    await makeSellable(repo, draft.id);
    await assert.rejects(start(repo, catalog().port, s.port, { slug: "draft-product" }), /not available for online purchase/);
    const update = await createProduct(repo, { ...PRODUCT, slug: "annual-update", category: "software_update", stripe_product_id: "prod_UPDATE0001" });
    await makeSellable(repo, update.id);
    await setProductStatus(repo, update.id, "published");
    await assert.rejects(start(repo, catalog().port, s.port, { slug: "annual-update" }), /not available for online purchase/);
    for (const status of ["unpublished", "archived"] as const) {
      await setProductStatus(repo, product.id, status);
      await assert.rejects(start(repo, catalog().port, s.port), /not available for online purchase/);
    }
    assert.equal(s.created.length, 0);
  });

  test("a price that Stripe no longer confirms stops checkout", async () => {
    const { repo } = await shop();
    const s = sessions();
    await assert.rejects(start(repo, catalog({ unit_amount: 5000 }).port, s.port), /not available for online purchase/);
    await assert.rejects(start(repo, catalog({ active: false }).port, s.port), /not available for online purchase/);
    const down = catalog();
    down.fail(new StripeLookupError("connection", "Stripe unavailable."));
    await assert.rejects(start(repo, down.port, s.port), /temporarily unavailable/);
    assert.equal(s.created.length, 0);
  });

  test("the installation choice must be one the product offers", async () => {
    const { repo } = await shop();
    const s = sessions();
    await assert.rejects(start(repo, catalog().port, s.port, { installationType: null }), /Choose how you would like the calculator installed/);
    await assert.rejects(start(repo, catalog().port, s.port, { installationType: "anything" }), /Choose how/);
    assert.equal(s.created.length, 0);
  });

  test("a session that could not be recorded is closed, never left payable", async () => {
    const { repo } = await shop();
    const s = sessions();
    repo.recordStorefrontCheckout = async () => { throw new Error("relation storefront_checkouts does not exist"); };
    await assert.rejects(start(repo, catalog().port, s.port), /temporarily unavailable/);
    assert.deepEqual(s.expired, ["cs_test_shop1"]);
  });
});

describe("the webhook fulfils only storefront checkouts", () => {
  test("a storefront payment at the recorded amount is fulfilled, with the Terms version on the order", async () => {
    const { repo, deps } = await shop();
    const s = sessions();
    await start(repo, catalog().port, s.port);
    await handleStripeEvent(deps, paid("evt_1", "cs_test_shop1"));
    const [order] = repo.orders;
    assert.equal(order.notes, null);
    assert.equal(order.terms_version, VERSION);
    assert.ok(order.terms_accepted_at);
    assert.equal(order.installation_type, "done_for_you");
    assert.equal(repo.licenses.length, 1);
    assert.equal(repo.storefrontCheckouts[0].status, "completed");
  });

  test("a pasted payment link (no storefront checkout) is held for review, not fulfilled", async () => {
    const { repo, deps } = await shop();
    await handleStripeEvent(deps, paid("evt_1", "cs_live_paymentlink1"));
    assert.equal(repo.orders.length, 1);
    assert.match(repo.orders[0].notes ?? "", /^Review: this payment did not come from a checkout the Monarch storefront started/);
    assert.equal(repo.orders[0].terms_version, undefined);
    assert.equal(repo.licenses.length, 0);
  });

  test("a payment that does not match the checkout amount or currency is held for review", async () => {
    const { repo, deps } = await shop();
    const s = sessions();
    await start(repo, catalog().port, s.port);
    await start(repo, catalog().port, s.port);
    await handleStripeEvent(deps, paid("evt_1", "cs_test_shop1", { amount_total: 100 }));
    await handleStripeEvent(deps, paid("evt_2", "cs_test_shop2", { currency: "eur" }));
    assert.match(repo.orders[0].notes ?? "", /^Review: the amount paid \(100 usd\) does not match the checkout price \(7500 usd\)/);
    assert.match(repo.orders[1].notes ?? "", /does not match the checkout price/);
    assert.equal(repo.licenses.length, 0);
  });

  test("a payment for a different product than the checkout was started for is held for review", async () => {
    const { repo, deps } = await shop();
    const s = sessions();
    await start(repo, catalog().port, s.port);
    const other = await createProduct(repo, { ...PRODUCT, slug: "other", stripe_product_id: "prod_OTHER00001", stripe_price_id: "price_OTHER0001" });
    await makeSellable(repo, other.id);
    await setProductStatus(repo, other.id, "published");
    await handleStripeEvent({ ...deps, listCheckoutProductIds: async () => ["prod_OTHER00001"] }, paid("evt_1", "cs_test_shop1"));
    assert.match(repo.orders[0].notes ?? "", /does not match the product the checkout was started for/);
    assert.equal(repo.licenses.length, 0);
  });

  test("an abandoned checkout is marked expired when Stripe expires it", async () => {
    const { repo, deps } = await shop();
    const s = sessions();
    await start(repo, catalog().port, s.port);
    await handleStripeEvent(deps, { id: "evt_x", type: "checkout.session.expired", data: { object: { id: "cs_test_shop1", payment_intent: null } } });
    assert.equal(repo.storefrontCheckouts[0].status, "expired");
    assert.equal(repo.orders.length, 0);
  });
});

describe("unpublishing closes open checkouts", () => {
  test("only that product's open checkouts are closed", async () => {
    const { repo, product, deps } = await shop();
    const s = sessions();
    await start(repo, catalog().port, s.port);
    await start(repo, catalog().port, s.port);
    await handleStripeEvent(deps, paid("evt_1", "cs_test_shop1"));
    const other = await createProduct(repo, { ...PRODUCT, slug: "other", stripe_product_id: "prod_OTHER00001", stripe_price_id: "price_OTHER0001" });
    await makeSellable(repo, other.id);
    await setProductStatus(repo, other.id, "published");
    await start(repo, catalog().port, s.port, { slug: "other" });
    await setProductStatus(repo, product.id, "unpublished");
    assert.equal(await expireOpenCheckouts(repo, s.port, product.id), 1);
    assert.deepEqual(s.expired, ["cs_test_shop2"]);
    assert.deepEqual(repo.storefrontCheckouts.map((c) => c.status), ["completed", "expired", "open"]);
  });
});

describe("publishing rules by product type", () => {
  const ready = { ...PRODUCT, stripe_price_cents: 7500, payment_type: "one_time" as const, metadata: {} };

  test("a complete software product with a verified price and an image is publishable", () => {
    assert.deepEqual(publishBlockers(ready, 1), []);
  });

  test("description, image and a Stripe-verified price are required", () => {
    assert.deepEqual(publishBlockers({ ...ready, description: " ", stripe_price_cents: 5000 }, 0), [
      "Add a description.",
      "Add a product image.",
      "Create or verify the Stripe price so Stripe confirms it charges the catalog price.",
    ]);
  });

  test("courses, digital downloads, memberships and recurring billing cannot be published yet", () => {
    assert.match(publishBlockers({ ...ready, product_type: "course", access_type: "course_access" }, 1).join(" "), /Courses cannot be sold until course delivery is ready \(decision E1\)/);
    assert.match(publishBlockers({ ...ready, product_type: "digital_download", access_type: "instant_download" }, 1).join(" "), /Digital downloads cannot be sold until secure delivery is built/);
    assert.match(publishBlockers({ ...ready, product_type: "membership", access_type: "manual" }, 1).join(" "), /Memberships cannot be sold yet/);
    assert.match(publishBlockers({ ...ready, payment_type: "recurring" }, 1).join(" "), /Recurring billing is not available/);
    assert.match(publishBlockers({ ...ready, access_type: "manual" }, 1).join(" "), /Software is delivered with a license/);
  });

  test("a service needs its deliverable, owner and response time (decision E4)", () => {
    const service = { ...ready, product_type: "service" as const, access_type: "manual" as const, installation_options: [] };
    assert.equal(publishBlockers(service, 1).length, 3);
    assert.deepEqual(publishBlockers({ ...service, metadata: { service_deliverable: "Bureau setup review", service_owner: "Monarch support", service_response_time: "2 business days" } }, 1), []);
  });

  test("the old checkout_url setting is refused", () => {
    assert.throws(() => parseMetadata("checkout_url: https://buy.stripe.com/abc"), /checkout_url is no longer used/);
  });
});
