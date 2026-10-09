import { copyProductImages } from "./images.ts";
import { publishBlockers, slugify, ValidationError } from "./validation.ts";
import type { CommerceRepo, ImageStore, NewProduct, Product, ProductStatus } from "./types.ts";

/**
 * Billing rules that protect the agreed models: products sold as a one-time
 * license with annual tax-year versions, and annual update products, are never
 * recurring.
 */
async function assertBillingModel(repo: CommerceRepo, productId: string | null, input: Pick<NewProduct, "payment_type" | "category">) {
  if (input.payment_type !== "recurring") return;
  if (input.category === "software_update") throw new ValidationError("Annual update products are one-time payments; recurring billing is not allowed.");
  if (productId && (await repo.listVersions(productId)).length > 0) {
    throw new ValidationError("This product is sold as a one-time license with optional one-time annual updates; it cannot be recurring.");
  }
}

/** Customers only ever see published products. */
export function isStorefrontVisible(product: Pick<Product, "status">): boolean {
  return product.status === "published";
}

export async function createProduct(repo: CommerceRepo, input: NewProduct): Promise<Product> {
  const existing = (await repo.listProducts()).find((p) => p.slug === input.slug);
  if (existing) throw new ValidationError("A product with this identifier already exists.");
  await assertBillingModel(repo, null, input);
  return repo.createProduct({ ...input, status: "draft" });
}

/** Edits product details. Status changes go through setProductStatus. */
export async function editProduct(repo: CommerceRepo, id: string, input: NewProduct): Promise<Product> {
  const current = await repo.getProduct(id);
  if (!current) throw new ValidationError("Product not found.");
  if (current.status === "archived") throw new ValidationError("Archived products cannot be edited.");
  const clash = (await repo.listProducts()).find((p) => p.slug === input.slug && p.id !== id);
  if (clash) throw new ValidationError("A product with this identifier already exists.");
  const { status: _ignored, ...details } = input;
  void _ignored;
  await assertBillingModel(repo, id, details);
  // A hand-edited Stripe price id has an unknown amount until it is synced again.
  if (details.stripe_price_id !== current.stripe_price_id) Object.assign(details, { stripe_price_cents: null, stripe_sync_status: null });
  if (current.status === "published") {
    const blockers = publishBlockers(details);
    if (blockers.length) throw new ValidationError(`A published product must stay sellable: ${blockers.join(" ")}`);
  }
  return repo.updateProduct(id, details);
}

const TRANSITIONS: Record<ProductStatus, ProductStatus[]> = {
  draft: ["published", "archived"],
  published: ["unpublished", "archived"],
  unpublished: ["published", "archived"],
  archived: [],
};

export async function setProductStatus(repo: CommerceRepo, id: string, status: ProductStatus): Promise<Product> {
  const current = await repo.getProduct(id);
  if (!current) throw new ValidationError("Product not found.");
  if (!TRANSITIONS[current.status].includes(status)) throw new ValidationError(`A ${current.status} product cannot be ${status}.`);
  if (status === "published") {
    const blockers = publishBlockers(current);
    if (blockers.length) throw new ValidationError(`Not ready to publish: ${blockers.join(" ")}`);
  }
  return repo.updateProduct(id, { status });
}

/**
 * Creates a draft copy of a product, including its images. Stripe ids are not
 * copied: each Stripe product maps to exactly one catalog product, so a copy
 * gets its own Stripe product only through an explicit sync.
 */
export async function duplicateProduct(repo: CommerceRepo, store: ImageStore, id: string, actorId: string): Promise<Product> {
  const source = await repo.getProduct(id);
  if (!source) throw new ValidationError("Product not found.");
  const slugs = new Set((await repo.listProducts()).map((p) => p.slug));
  const base = slugify(`${source.slug}-copy`).slice(0, 72);
  let slug = base;
  for (let n = 2; slugs.has(slug); n++) slug = `${base}-${n}`;
  const copy = await repo.createProduct({
    slug,
    name: `${source.name} (Copy)`.slice(0, 120),
    description: source.description,
    product_type: source.product_type,
    access_type: source.access_type,
    installation_options: source.installation_options,
    price_cents: source.price_cents,
    currency: source.currency,
    stripe_product_id: null,
    stripe_price_id: null,
    status: "draft",
    category: source.category,
    features: source.features,
    terms: source.terms,
    disclaimer: source.disclaimer,
    payment_type: source.payment_type,
    billing_interval: source.billing_interval,
    metadata: source.metadata,
  });
  await copyProductImages(repo, store, source.id, copy.id, actorId);
  return copy;
}
