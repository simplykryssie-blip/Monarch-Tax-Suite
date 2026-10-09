import { primaryImage } from "./images.ts";
import { ValidationError } from "./validation.ts";
import type { CommerceRepo, ImageStore, Product } from "./types.ts";

// Explicit, administrator-triggered Stripe operations. Saving a product never
// calls Stripe. Each operation does exactly one thing and records its result:
//  - syncStripeProductInfo: updates the linked Stripe product's display info.
//  - createStripeProduct: creates a Stripe product only if none is linked.
//  - createStripePrice: creates a NEW one-time (or recurring) price. Stripe
//    prices are immutable, so existing prices, payment links and completed
//    payments are never changed; old prices are left as they are.

export type StripePort = {
  updateProduct(id: string, params: { name: string; description?: string; images?: string[]; active: boolean }): Promise<{ id: string }>;
  createProduct(params: { name: string; description?: string; images?: string[]; metadata: Record<string, string> }): Promise<{ id: string }>;
  createPrice(params: {
    product: string;
    unit_amount: number;
    currency: string;
    recurring?: { interval: "month" | "year" };
    metadata: Record<string, string>;
  }): Promise<{ id: string; unit_amount: number | null }>;
};

export type SyncResult = { ok: true; message: string } | { ok: false; message: string };

async function record(repo: CommerceRepo, productId: string, result: SyncResult, patch: Partial<Product> = {}) {
  await repo.updateProduct(productId, {
    ...patch,
    stripe_sync_status: result.ok ? "synced" : "failed",
    stripe_synced_at: new Date().toISOString(),
    stripe_sync_error: result.ok ? null : result.message.slice(0, 500),
  });
  return result;
}

async function displayInfo(repo: CommerceRepo, store: ImageStore, product: Product) {
  const image = primaryImage(await repo.listProductImages([product.id]));
  return {
    name: product.name,
    description: product.description?.slice(0, 1000) || undefined,
    images: image ? [store.publicUrl(image.storage_path)] : undefined,
  };
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : "Stripe request failed.");

export async function syncStripeProductInfo(repo: CommerceRepo, store: ImageStore, stripe: StripePort, productId: string): Promise<SyncResult> {
  const product = await repo.getProduct(productId);
  if (!product) throw new ValidationError("Product not found.");
  if (!product.stripe_product_id) throw new ValidationError("This product is not linked to a Stripe product yet.");
  try {
    await stripe.updateProduct(product.stripe_product_id, { ...(await displayInfo(repo, store, product)), active: product.status !== "archived" });
    return record(repo, product.id, { ok: true, message: `Stripe product ${product.stripe_product_id} updated (name, description, image). Prices unchanged.` });
  } catch (e) {
    return record(repo, product.id, { ok: false, message: errorText(e) });
  }
}

export async function createStripeProduct(repo: CommerceRepo, store: ImageStore, stripe: StripePort, productId: string): Promise<SyncResult> {
  const product = await repo.getProduct(productId);
  if (!product) throw new ValidationError("Product not found.");
  if (product.stripe_product_id) throw new ValidationError(`Already linked to Stripe product ${product.stripe_product_id}; it will not be duplicated.`);
  try {
    const created = await stripe.createProduct({ ...(await displayInfo(repo, store, product)), metadata: { monarch_product_id: product.id, monarch_slug: product.slug } });
    return record(repo, product.id, { ok: true, message: `Stripe product ${created.id} created and linked. No price was created.` }, { stripe_product_id: created.id });
  } catch (e) {
    return record(repo, product.id, { ok: false, message: errorText(e) });
  }
}

export async function createStripePrice(repo: CommerceRepo, stripe: StripePort, productId: string): Promise<SyncResult> {
  const product = await repo.getProduct(productId);
  if (!product) throw new ValidationError("Product not found.");
  if (!product.stripe_product_id) throw new ValidationError("Link a Stripe product first.");
  if (product.price_cents === null || product.price_cents <= 0) throw new ValidationError("Set the price before creating a Stripe price.");
  if (product.stripe_price_id && product.stripe_price_cents === product.price_cents) {
    throw new ValidationError(`Stripe price ${product.stripe_price_id} already charges this amount; no new price is needed.`);
  }
  if (product.payment_type === "recurring" && (product.category === "software_update" || (await repo.listVersions(product.id)).length > 0)) {
    throw new ValidationError("This product must stay a one-time payment.");
  }
  try {
    const price = await stripe.createPrice({
      product: product.stripe_product_id,
      unit_amount: product.price_cents,
      currency: product.currency,
      ...(product.payment_type === "recurring" && product.billing_interval ? { recurring: { interval: product.billing_interval } } : {}),
      metadata: { monarch_product_id: product.id },
    });
    const previous = product.stripe_price_id ? ` Previous price ${product.stripe_price_id} was left unchanged (existing payment links and past payments are unaffected).` : "";
    return record(repo, product.id, { ok: true, message: `Stripe price ${price.id} created and linked.${previous}` }, { stripe_price_id: price.id, stripe_price_cents: price.unit_amount ?? product.price_cents });
  } catch (e) {
    return record(repo, product.id, { ok: false, message: errorText(e) });
  }
}

/** Describes how the catalog price relates to what Stripe charges. */
export function priceSyncState(product: Product): "no_stripe_price" | "in_sync" | "unverified" | "differs" {
  if (!product.stripe_price_id) return "no_stripe_price";
  if (product.stripe_price_cents === null) return "unverified";
  return product.stripe_price_cents === product.price_cents ? "in_sync" : "differs";
}
