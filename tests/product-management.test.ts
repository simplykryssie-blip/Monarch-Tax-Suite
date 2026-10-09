import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MemoryImageStore, MemoryRepo } from "./memory-repo.ts";
import { createProduct, duplicateProduct, editProduct, isStorefrontVisible, setProductStatus } from "../lib/commerce/catalog.ts";
import {
  imageDimensions,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_PRODUCT,
  removeProductImage,
  setPrimaryImage,
  sniffImageType,
  updateImageAlt,
  uploadProductImage,
  validateImage,
} from "../lib/commerce/images.ts";
import { createStripePrice, createStripeProduct, priceSyncState, syncStripeProductInfo, type StripePort } from "../lib/commerce/stripe-sync.ts";
import { handleStripeEvent, type FulfillmentDeps } from "../lib/commerce/fulfillment.ts";
import { parseFeatures, parseMetadata, parseProductForm, ValidationError } from "../lib/commerce/validation.ts";
import type { NewProduct } from "../lib/commerce/types.ts";

function png(width = 800, height = 600, extra = 32) {
  const b = new Uint8Array(24 + extra);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  return b;
}
const jpeg = () => {
  // SOI, APP0 (len 16), SOF0 with 480x640.
  const b = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...new Array(14).fill(0), 0xff, 0xc0, 0, 17, 8, 0x01, 0xe0, 0x02, 0x80, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  return b;
};
const webp = () => new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBPVP8X"), 0, 0, 0, 0, 0, 0, 0, 0, 0x1f, 0x03, 0, 0x57, 0x02, 0, 0, 0]);

const upload = (bytes: Uint8Array, declaredType = "image/png", altText: string | null = null) => ({ bytes, declaredType, fileName: "photo.png", altText });

const BASE: NewProduct = {
  slug: "monarch-basic-tax-calculator",
  name: "Monarch Basic Tax Calculator",
  description: "Embeddable federal tax estimator.",
  product_type: "software",
  access_type: "license",
  installation_options: ["self_service"],
  price_cents: 7500,
  currency: "usd",
  stripe_product_id: "prod_TESTCALC123",
  stripe_price_id: "price_TESTCALC123",
  status: "draft",
  category: "tax_software",
};

async function setup() {
  const repo = new MemoryRepo();
  const store = new MemoryImageStore();
  const product = await createProduct(repo, BASE);
  return { repo, store, product };
}

describe("image validation", () => {
  test("detects real type from file contents", () => {
    assert.equal(sniffImageType(png()), "image/png");
    assert.equal(sniffImageType(jpeg()), "image/jpeg");
    assert.equal(sniffImageType(webp()), "image/webp");
    assert.equal(sniffImageType(new TextEncoder().encode("<svg onload=alert(1)>")), null);
    assert.equal(sniffImageType(new TextEncoder().encode("GIF89a.........")), null);
  });

  test("reads dimensions", () => {
    assert.deepEqual(imageDimensions(png(1200, 900), "image/png"), { width: 1200, height: 900 });
    assert.deepEqual(imageDimensions(jpeg(), "image/jpeg"), { width: 640, height: 480 });
    assert.deepEqual(imageDimensions(webp(), "image/webp"), { width: 800, height: 600 });
  });

  test("rejects empty, oversize, unsupported and mislabeled files", () => {
    assert.throws(() => validateImage(upload(new Uint8Array())), ValidationError);
    assert.throws(() => validateImage(upload(png(10, 10, MAX_IMAGE_BYTES))), /4 MB/);
    assert.throws(() => validateImage(upload(new TextEncoder().encode("not an image at all"), "image/png")), /JPG, PNG, or WebP/);
    assert.throws(() => validateImage(upload(png(), "image/jpeg")), /do not match/);
    assert.throws(() => validateImage(upload(png(20000, 10))), /10,000/);
    assert.equal(validateImage(upload(jpeg(), "image/jpg")).type, "image/jpeg");
  });
});

describe("product images", () => {
  test("upload stores the file in storage and only path + metadata in the database", async () => {
    const { repo, store, product } = await setup();
    const image = await uploadProductImage(repo, store, product.id, upload(png(), "image/png", "  Calculator  screenshot "), "admin");
    assert.match(image.storage_path, new RegExp(`^products/${product.id}/[0-9a-f-]{36}\\.png$`));
    assert.equal(image.is_primary, true, "first image is primary");
    assert.equal(image.alt_text, "Calculator screenshot");
    assert.equal(image.width, 800);
    assert.ok(store.files.has(image.storage_path));
    assert.equal("bytes" in image, false);
    // Persisted: a fresh read returns the same record.
    assert.deepEqual(await repo.listProductImages([product.id]), [image]);
  });

  test("replace keeps primary flag and position and deletes the old file", async () => {
    const { repo, store, product } = await setup();
    const first = await uploadProductImage(repo, store, product.id, upload(png()), "admin");
    const second = await uploadProductImage(repo, store, product.id, upload(jpeg(), "image/jpeg"), "admin");
    assert.equal(second.is_primary, false);
    const replaced = await uploadProductImage(repo, store, product.id, upload(webp(), "image/webp"), "admin", first.id);
    assert.equal(replaced.is_primary, true);
    assert.equal(replaced.sort_order, first.sort_order);
    assert.equal(store.files.has(first.storage_path), false);
    assert.equal(await repo.getProductImage(first.id), null);
    assert.equal((await repo.listProductImages([product.id])).length, 2);
  });

  test("set primary, alt text and remove (next image is promoted)", async () => {
    const { repo, store, product } = await setup();
    const a = await uploadProductImage(repo, store, product.id, upload(png()), "admin");
    const b = await uploadProductImage(repo, store, product.id, upload(png()), "admin");
    await setPrimaryImage(repo, b.id);
    const images = await repo.listProductImages([product.id]);
    assert.deepEqual(images.filter((i) => i.is_primary).map((i) => i.id), [b.id]);
    await updateImageAlt(repo, a.id, "Results screen");
    assert.equal((await repo.getProductImage(a.id))?.alt_text, "Results screen");
    await removeProductImage(repo, store, b.id);
    assert.equal(store.files.has(b.storage_path), false);
    assert.equal((await repo.getProductImage(a.id))?.is_primary, true);
  });

  test("failed database write removes the uploaded file", async () => {
    const { repo, store, product } = await setup();
    repo.addProductImage = async () => { throw new Error("db down"); };
    await assert.rejects(uploadProductImage(repo, store, product.id, upload(png()), "admin"), /db down/);
    assert.equal(store.files.size, 0);
  });

  test("limits image count and refuses archived products", async () => {
    const { repo, store, product } = await setup();
    for (let i = 0; i < MAX_IMAGES_PER_PRODUCT; i++) await uploadProductImage(repo, store, product.id, upload(png()), "admin");
    await assert.rejects(uploadProductImage(repo, store, product.id, upload(png()), "admin"), /at most/);
    await setProductStatus(repo, product.id, "archived");
    const [first] = await repo.listProductImages([product.id]);
    await assert.rejects(uploadProductImage(repo, store, product.id, upload(png()), "admin", first.id), /Archived/);
  });
});

describe("product editing", () => {
  test("editor fields parse and save; line breaks in description survive", async () => {
    const { repo, product } = await setup();
    const form = new FormData();
    Object.entries({
      name: "Monarch Basic Tax Calculator",
      slug: product.slug,
      description: "Line one.\n\nLine two.",
      category: "tax_software",
      product_type: "software",
      access_type: "license",
      price: "75.00",
      currency: "usd",
      payment_type: "one_time",
      features: "- 2025 and 2026 tax years\n• Child Tax Credit\n\n",
      terms: "Lifetime license for the purchased tax year.",
      disclaimer: "Estimates only.",
      metadata: "checkout_url: https://buy.stripe.com/test\nSupport Email: info@monarchtaxsuite.com",
      stripe_product_id: "prod_TESTCALC123",
      stripe_price_id: "price_TESTCALC123",
    }).forEach(([k, v]) => form.set(k, v));
    form.append("installation_options", "self_service");
    const saved = await editProduct(repo, product.id, parseProductForm(form));
    assert.equal(saved.description, "Line one.\n\nLine two.");
    assert.deepEqual(saved.features, ["2025 and 2026 tax years", "Child Tax Credit"]);
    assert.deepEqual(saved.metadata, { checkout_url: "https://buy.stripe.com/test", support_email: "info@monarchtaxsuite.com" });
    assert.equal(saved.id, product.id);
    assert.equal(saved.stripe_product_id, "prod_TESTCALC123");
  });

  test("feature and settings limits", () => {
    assert.throws(() => parseFeatures(Array.from({ length: 26 }, (_, i) => `f${i}`).join("\n")), /25/);
    assert.throws(() => parseMetadata("no colon here"), /key: value/);
    assert.throws(() => parseMetadata("bad key!: x"), /letters, numbers/);
  });

  test("calculator and update products cannot become recurring", async () => {
    const { repo, product } = await setup();
    await repo.createVersion({ product_id: product.id, tax_year: 2026, label: "2026", status: "available", release_date: null, update_price_cents: 5000, stripe_update_price_id: null });
    await assert.rejects(editProduct(repo, product.id, { ...BASE, payment_type: "recurring", billing_interval: "year" }), /one-time license/);
    await assert.rejects(
      createProduct(repo, { ...BASE, slug: "yearly-update", stripe_product_id: null, category: "software_update", payment_type: "recurring", billing_interval: "year" }),
      /recurring billing is not allowed/,
    );
    const course = await createProduct(repo, { ...BASE, slug: "course", stripe_product_id: null, category: "course", payment_type: "recurring", billing_interval: "month" });
    assert.equal(course.payment_type, "recurring");
  });

  test("hand-editing the Stripe price id marks its amount unverified", async () => {
    const { repo, product } = await setup();
    await repo.updateProduct(product.id, { stripe_price_cents: 7500, stripe_sync_status: "synced" });
    assert.equal(priceSyncState((await repo.getProduct(product.id))!), "in_sync");
    const saved = await editProduct(repo, product.id, { ...BASE, stripe_price_id: "price_OTHER12345" });
    assert.equal(priceSyncState(saved), "unverified");
  });

  test("duplicate creates a draft without Stripe links and copies images", async () => {
    const { repo, store, product } = await setup();
    const img = await uploadProductImage(repo, store, product.id, upload(png()), "admin");
    await setProductStatus(repo, product.id, "published");
    const copy = await duplicateProduct(repo, store, product.id, "admin");
    const again = await duplicateProduct(repo, store, product.id, "admin");
    assert.equal(copy.status, "draft");
    assert.equal(copy.slug, "monarch-basic-tax-calculator-copy");
    assert.equal(again.slug, "monarch-basic-tax-calculator-copy-2");
    assert.equal(copy.stripe_product_id, null);
    assert.equal(copy.stripe_price_id, null);
    const [copied] = await repo.listProductImages([copy.id]);
    assert.notEqual(copied.storage_path, img.storage_path);
    assert.ok(store.files.has(copied.storage_path));
    assert.equal(copied.is_primary, true);
    assert.equal((await repo.getProduct(product.id))?.status, "published", "source unchanged");
  });

  test("archiving keeps orders and licenses; archived products are read-only", async () => {
    const { repo, product } = await setup();
    const deps: FulfillmentDeps = { repo, listCheckoutProductIds: async () => ["prod_TESTCALC123"] };
    await handleStripeEvent(deps, {
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { id: "cs_1", payment_status: "paid", payment_intent: "pi_ARCHIVE0001", amount_total: 7500, currency: "usd", customer_details: { email: "a@example.com" }, metadata: {} } },
    });
    const before = { orders: await repo.listOrders(), licenses: await repo.listLicenses() };
    await setProductStatus(repo, product.id, "archived");
    assert.deepEqual(await repo.listOrders(), before.orders);
    assert.deepEqual(await repo.listLicenses(), before.licenses);
    await assert.rejects(editProduct(repo, product.id, BASE), /Archived/);
  });
});

describe("storefront visibility", () => {
  test("only published products are customer-visible", async () => {
    const { repo, product } = await setup();
    assert.equal(isStorefrontVisible(product), false);
    const published = await setProductStatus(repo, product.id, "published");
    assert.equal(isStorefrontVisible(published), true);
    assert.equal(isStorefrontVisible(await setProductStatus(repo, product.id, "unpublished")), false);
    assert.equal(isStorefrontVisible(await setProductStatus(repo, product.id, "archived")), false);
  });

  test("saving a published product keeps it sellable", async () => {
    const { repo, product } = await setup();
    await setProductStatus(repo, product.id, "published");
    await assert.rejects(editProduct(repo, product.id, { ...BASE, price_cents: null }), /stay sellable/);
  });
});

function mockStripe() {
  const calls: string[] = [];
  let n = 0;
  const port: StripePort = {
    async updateProduct(id) { calls.push(`update:${id}`); return { id }; },
    async createProduct() { calls.push("createProduct"); return { id: `prod_NEW${++n}` }; },
    async createPrice(p) { calls.push(`createPrice:${p.unit_amount}:${p.recurring ? "recurring" : "once"}`); return { id: `price_NEW${++n}`, unit_amount: p.unit_amount }; },
  };
  return { port, calls };
}

describe("explicit Stripe sync", () => {
  test("ordinary edits never call Stripe", async () => {
    const { repo, product } = await setup();
    const { calls } = mockStripe();
    await editProduct(repo, product.id, { ...BASE, name: "Renamed", price_cents: 9900 });
    assert.deepEqual(calls, []);
    assert.equal((await repo.getProduct(product.id))?.stripe_price_id, "price_TESTCALC123");
  });

  test("product info sync updates the linked product only", async () => {
    const { repo, store, product } = await setup();
    await uploadProductImage(repo, store, product.id, upload(png()), "admin");
    const { port, calls } = mockStripe();
    const result = await syncStripeProductInfo(repo, store, port, product.id);
    assert.equal(result.ok, true);
    assert.deepEqual(calls, ["update:prod_TESTCALC123"]);
    const after = await repo.getProduct(product.id);
    assert.equal(after?.stripe_sync_status, "synced");
    assert.equal(after?.stripe_price_id, "price_TESTCALC123");
  });

  test("never creates a second Stripe product", async () => {
    const { repo, store, product } = await setup();
    const { port, calls } = mockStripe();
    await assert.rejects(createStripeProduct(repo, store, port, product.id), /will not be duplicated/);
    const draft = await createProduct(repo, { ...BASE, slug: "guide", stripe_product_id: null, stripe_price_id: null, category: "digital_product" });
    assert.equal((await createStripeProduct(repo, store, port, draft.id)).ok, true);
    await assert.rejects(createStripeProduct(repo, store, port, draft.id), /will not be duplicated/);
    assert.deepEqual(calls, ["createProduct"]);
  });

  test("price creation is one-time, happens once per amount, and leaves the old price alone", async () => {
    const { repo, store, product } = await setup();
    const { port, calls } = mockStripe();
    const result = await createStripePrice(repo, port, product.id);
    assert.equal(result.ok, true);
    assert.match(result.message, /price_TESTCALC123 was left unchanged/);
    await assert.rejects(createStripePrice(repo, port, product.id), /already charges this amount/);
    assert.deepEqual(calls, ["createPrice:7500:once"]);
    assert.equal(priceSyncState((await repo.getProduct(product.id))!), "in_sync");
    void store;
  });

  test("Stripe failures are recorded and shown, not hidden", async () => {
    const { repo, store, product } = await setup();
    const port: StripePort = { ...mockStripe().port, async updateProduct() { throw new Error("No such product"); } };
    const result = await syncStripeProductInfo(repo, store, port, product.id);
    assert.deepEqual(result, { ok: false, message: "No such product" });
    const after = await repo.getProduct(product.id);
    assert.equal(after?.stripe_sync_status, "failed");
    assert.equal(after?.stripe_sync_error, "No such product");
  });
});

describe("annual update product", () => {
  test("a bare checkout of the update product never creates a license", async () => {
    const repo = new MemoryRepo();
    await createProduct(repo, { ...BASE, slug: "monarch-basic-tax-calculator-yearly-update", category: "software_update", stripe_product_id: "prod_UPDATE0001", price_cents: 5000 });
    const deps: FulfillmentDeps = { repo, listCheckoutProductIds: async () => ["prod_UPDATE0001"] };
    const result = await handleStripeEvent(deps, {
      id: "evt_u",
      type: "checkout.session.completed",
      data: { object: { id: "cs_u", payment_status: "paid", payment_intent: "pi_UPDATE00001", amount_total: 5000, currency: "usd", customer_details: { email: "a@example.com" }, metadata: {} } },
    });
    assert.equal(result.status, "ignored");
    assert.equal((await repo.listLicenses()).length, 0);
    assert.equal((await repo.listOrders()).length, 0);
  });
});
