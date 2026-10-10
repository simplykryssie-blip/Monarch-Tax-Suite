import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryRepo } from "./memory-repo.ts";
import { createProduct } from "../lib/commerce/catalog.ts";
import { authorizeDomain, computeMetrics, createInternalLicense, INTERNAL_ORDER_MARKER, isInternalOrder, issueLicenseKey, reconcilePurchase, type InternalLicenseInput } from "../lib/commerce/fulfillment.ts";
import { frameAncestors, decideEmbed } from "../lib/commerce/embed.ts";
import { ValidationError } from "../lib/commerce/validation.ts";
import type { NewProduct } from "../lib/commerce/types.ts";

const CALCULATOR: NewProduct = {
  slug: "monarch-basic-tax-calculator", name: "Monarch Basic Tax Calculator", description: "Embeddable federal tax estimator.", product_type: "software", access_type: "license",
  installation_options: ["self_service", "done_for_you"], price_cents: 7500, currency: "usd", stripe_product_id: "prod_TESTCALC123", stripe_price_id: null, status: "draft",
};
const ADMIN = "00000000-0000-4000-8000-000000000001";

async function setup() {
  const repo = new MemoryRepo();
  const product = await createProduct(repo, CALCULATOR);
  const input: InternalLicenseInput = {
    email: "Owner@Example.com", full_name: "Test Owner", phone: "337-555-0100", product_id: product.id, platform: "gohighlevel",
    website_url: null, domain: "https://www.Example.com/funnel", reason: "Owner's own GoHighLevel account", admin_id: ADMIN, confirmed: true,
  };
  return { repo, product, input };
}

test("creates a customer, a $0 internal order, a pending license and an installation, with no payment reference", async () => {
  const { repo, input } = await setup();
  const r = await createInternalLicense(repo, input);
  assert.equal(r.created, true);
  assert.equal(r.customer.email, "owner@example.com");
  assert.equal(r.order.amount_cents, 0);
  assert.equal(r.order.payment_status, "paid");
  assert.equal(r.order.provider_payment_intent_id, null);
  assert.equal(r.order.provider_checkout_session_id, null);
  assert.equal(r.order.verification_method, "admin_manual");
  assert.equal(r.order.verified_by, ADMIN);
  assert.ok(r.order.notes!.startsWith(INTERNAL_ORDER_MARKER));
  assert.match(r.order.notes!, /Reason: Owner's own GoHighLevel account/);
  assert.match(r.order.notes!, /Phone on file: 337-555-0100/);
  assert.equal(isInternalOrder(r.order), true);
  assert.equal(r.license?.status, "pending");
  assert.equal(r.license?.key_hash, null, "no key is issued automatically");
  assert.equal(r.installation?.platform, "gohighlevel");
  assert.equal(r.installation?.target_location, "www.example.com", "domain is normalized, not guessed");
  assert.equal(r.domain, "www.example.com");
  assert.equal((await repo.listDomains(r.license!.id)).length, 0, "the domain is authorized by the administrator, not automatically");
});

test("it is clearly not a sale: no revenue, never matched by a payment reference", async () => {
  const { repo, input } = await setup();
  const r = await createInternalLicense(repo, input);
  assert.equal(await repo.findOrderByPaymentIntent("pi_anything"), null);
  const sale = await reconcilePurchase(repo, { email: "buyer@example.com", full_name: "Real Buyer", payment_intent_id: "pi_REAL00000001", amount_cents: 7500, currency: "usd", product_id: input.product_id, installation_type: "self_service", platform: "gohighlevel", platform_other: null, website_url: null, target_location: null, notes: null, admin_id: ADMIN, stripe_payment: null, admin_attested: true });
  assert.equal(isInternalOrder(sale.order), false, "a real reconciled sale is never labelled internal");
  const orders = await repo.listOrders();
  assert.equal(orders.filter(isInternalOrder).length, 1);
  assert.equal(orders.filter(isInternalOrder)[0].id, r.order.id);
  const revenue = orders.filter((o) => o.payment_status === "paid").reduce((n, o) => n + o.amount_cents, 0);
  assert.equal(revenue, 7500, "the internal order adds $0");
  const m = computeMetrics({ customers: await repo.listCustomers(), orders, products: await repo.listProducts(), licenses: await repo.listLicenses(), installations: await repo.listInstallations() });
  assert.equal(m.paidOrders, 1, "only the real sale counts as a paid order");
  assert.deepEqual(m.revenueByCurrency, { usd: 7500 });
  assert.equal(m.pendingLicenses, 2, "both licenses still show as pending licenses to act on");
});

test("repeating the request reuses the same order and license (no duplicates)", async () => {
  const { repo, input } = await setup();
  const a = await createInternalLicense(repo, input);
  const b = await createInternalLicense(repo, { ...input, email: "OWNER@example.com" });
  assert.equal(b.created, false);
  assert.equal(b.order.id, a.order.id);
  assert.equal(b.license?.id, a.license?.id);
  assert.equal((await repo.listOrders()).length, 1);
  assert.equal((await repo.listLicenses()).length, 1);
});

test("the administrator then issues the key and authorizes the domain; only that host may frame the calculator", async () => {
  const { repo, input } = await setup();
  const r = await createInternalLicense(repo, input);
  const { key } = await issueLicenseKey(repo, r.license!.id, ADMIN);
  assert.match(key, /^MTS-/);
  await authorizeDomain(repo, r.license!.id, r.domain, ADMIN);
  const license = (await repo.getLicense(r.license!.id))!;
  assert.equal(license.status, "active");
  const decision = decideEmbed(license, await repo.listDomains(license.id), "www.example.com");
  assert.equal(decision.ok, true);
  assert.equal(frameAncestors(decision), "frame-ancestors https://example.com https://www.example.com");
  assert.equal(decideEmbed(license, await repo.listDomains(license.id), "evil.example").ok, false);
});

test("validation: needs confirmation, a reason, a name, a valid email and domain, and a licensed product", async () => {
  const { repo, input } = await setup();
  await assert.rejects(createInternalLicense(repo, { ...input, confirmed: false }), /\$0 internal license/);
  await assert.rejects(createInternalLicense(repo, { ...input, reason: " " }), /why this license/i);
  await assert.rejects(createInternalLicense(repo, { ...input, full_name: "  " }), /customer name/i);
  await assert.rejects(createInternalLicense(repo, { ...input, email: "not-an-email" }), ValidationError);
  await assert.rejects(createInternalLicense(repo, { ...input, domain: "bad_domain!" }), /valid domain/i);
  await assert.rejects(createInternalLicense(repo, { ...input, product_id: "00000000-0000-4000-8000-0000000000ff" }), /catalog product/i);
  assert.equal((await repo.listOrders()).length, 0, "nothing is created when validation fails");
  assert.equal((await repo.listLicenses()).length, 0);
});

test("text fields cannot smuggle markup or control characters into the record", async () => {
  const { repo, input } = await setup();
  const r = await createInternalLicense(repo, { ...input, full_name: "Evil <script>alert(1)</script>\nName", reason: "ok <b>x</b>\r\nsecond line", phone: "337-555-0100; DROP TABLE" });
  assert.ok(!/[<>\r\n]/.test(r.customer.full_name ?? ""));
  assert.ok(!/[<>\r\n]/.test(r.order.notes ?? ""));
  assert.ok(!/DROP/.test(r.order.notes ?? ""), "phone keeps digits and phone punctuation only");
});
