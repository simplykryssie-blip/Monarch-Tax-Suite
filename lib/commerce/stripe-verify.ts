import { ValidationError } from "./validation.ts";
import type { CommerceRepo, Product, ProductVersion, StripePriceFacts, StripeVerification } from "./types.ts";

// Server-side verification of Stripe products and prices, and the
// tax-year version price workflow. Nothing here changes a configured Stripe
// id unless the administrator explicitly confirmed a verified link, and no
// Stripe object is created without explicit confirmation.

export type StripeMode = "live" | "test";

/** Mode of a secret or restricted key, from its prefix (the key itself is never stored or shown). */
export function modeFromKey(key: string | undefined | null): StripeMode | null {
  if (!key) return null;
  if (/^(sk|rk)_live_/.test(key)) return "live";
  if (/^(sk|rk)_test_/.test(key)) return "test";
  return null;
}

export class StripeLookupError extends Error {
  kind: "not_found" | "auth" | "permission" | "connection" | "other";
  constructor(kind: StripeLookupError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

/** The Stripe operations this module needs (wrapped by the server around the Stripe SDK; mocked in tests). */
export interface StripeCatalogPort {
  mode: StripeMode;
  getProduct(id: string): Promise<{ id: string; name: string | null; active: boolean; livemode: boolean }>;
  getPrice(id: string): Promise<StripePriceFacts>;
  /** Active prices of a product (all billing types). */
  listActivePrices(productId: string): Promise<StripePriceFacts[]>;
  createOneTimePrice(input: { productId: string; unitAmount: number; currency: string; idempotencyKey: string; metadata: Record<string, string> }): Promise<StripePriceFacts>;
}

export const lookupMessage = (e: unknown): string => {
  if (e instanceof StripeLookupError) {
    if (e.kind === "not_found") return e.message;
    if (e.kind === "auth") return "Stripe rejected the configured secret key (invalid or revoked).";
    if (e.kind === "permission") return "The configured Stripe key does not have permission for this request.";
    if (e.kind === "connection") return "Could not reach Stripe. Try again in a moment.";
  }
  return e instanceof Error ? e.message.slice(0, 300) : "Stripe request failed.";
};

const dollars = (cents: number | null) => (cents === null ? "no amount" : `$${(cents / 100).toFixed(2)}`);

/** Checks one price against what the catalog expects. Returns the facts and every mismatch. */
export function priceIssues(
  price: StripePriceFacts,
  mode: StripeMode,
  expect: { productId?: string | null; amountCents?: number | null; currency?: string; oneTime?: boolean },
): string[] {
  const issues: string[] = [];
  if (price.livemode !== (mode === "live")) issues.push(`Price ${price.id} is a ${price.livemode ? "live" : "test"}-mode price, but the configured key is ${mode} mode.`);
  if (expect.productId && price.product_id !== expect.productId) issues.push(`Price ${price.id} belongs to ${price.product_id}, not ${expect.productId}.`);
  if (!price.active) issues.push(`Price ${price.id} is archived (inactive) in Stripe.`);
  if ((expect.oneTime ?? true) && price.type !== "one_time") issues.push(`Price ${price.id} is recurring (${price.interval ?? "subscription"}), not a one-time price.`);
  const currency = (expect.currency ?? "usd").toLowerCase();
  if (price.currency.toLowerCase() !== currency) issues.push(`Price ${price.id} is in ${price.currency.toUpperCase()}, not ${currency.toUpperCase()}.`);
  if (expect.amountCents !== undefined && expect.amountCents !== null && price.unit_amount !== expect.amountCents) {
    issues.push(`Price ${price.id} charges ${dollars(price.unit_amount)}, but the catalog expects ${dollars(expect.amountCents)}.`);
  }
  return issues;
}

const nowIso = () => new Date().toISOString();

// --------------------------------------------------------------- products

/**
 * Verifies a catalog product's Stripe product and price ids. Records a
 * snapshot either way; only when everything matches does it also record the
 * verified amount. The ids themselves are never changed here.
 */
export async function verifyCatalogProduct(repo: CommerceRepo, port: StripeCatalogPort, productId: string): Promise<StripeVerification> {
  const product = await repo.getProduct(productId);
  if (!product) throw new ValidationError("Product not found.");
  const snap: StripeVerification = { checked_at: nowIso(), mode: port.mode, ok: false, issues: [], price: null, product: null };
  if (!product.stripe_product_id) snap.issues.push("No Stripe product id is configured for this product.");
  try {
    if (product.stripe_product_id) {
      const p = await port.getProduct(product.stripe_product_id);
      snap.product = p;
      if (p.livemode !== (port.mode === "live")) snap.issues.push(`Stripe product ${p.id} is ${p.livemode ? "live" : "test"} mode, but the key is ${port.mode} mode.`);
      if (!p.active) snap.issues.push(`Stripe product ${p.id} is archived (inactive).`);
    }
    if (product.stripe_price_id) {
      const price = await port.getPrice(product.stripe_price_id);
      snap.price = price;
      snap.issues.push(...priceIssues(price, port.mode, { productId: product.stripe_product_id, amountCents: product.price_cents, currency: product.currency, oneTime: product.payment_type !== "recurring" }));
      if (product.payment_type === "recurring" && price.type !== "recurring") snap.issues.push(`Price ${price.id} is one-time, but this product is set to recurring.`);
    } else {
      snap.issues.push("No Stripe price id is configured for this product.");
    }
  } catch (e) {
    snap.issues.push(lookupMessage(e));
  }
  snap.ok = snap.issues.length === 0;
  const patch: Partial<Product> = {
    stripe_verification: snap,
    stripe_sync_status: snap.ok ? "synced" : "failed",
    stripe_synced_at: snap.checked_at,
    stripe_sync_error: snap.ok ? null : snap.issues.join(" ").slice(0, 500),
  };
  if (snap.ok && snap.price) patch.stripe_price_cents = snap.price.unit_amount;
  await repo.updateProduct(product.id, patch);
  return snap;
}

// ------------------------------------------------- annual update versions

/** The catalog's Annual Tax-Year Update product: exactly one non-archived software_update product with a Stripe product id. */
export async function updateProductFor(repo: CommerceRepo): Promise<Product> {
  const candidates = (await repo.listProducts()).filter((p) => p.category === "software_update" && p.status !== "archived" && p.stripe_product_id);
  if (candidates.length === 0) throw new ValidationError("No Annual Tax-Year Update product (category: annual software update) with a Stripe product id is in the catalog.");
  if (candidates.length > 1) throw new ValidationError(`More than one annual update product is configured (${candidates.map((c) => c.name).join(", ")}). Archive the extra one before linking prices.`);
  return candidates[0];
}

const matchesVersion = (price: StripePriceFacts, mode: StripeMode, productId: string, amount: number) => priceIssues(price, mode, { productId, amountCents: amount, currency: "usd", oneTime: true }).length === 0;

/**
 * Looks up the right Stripe price for a version without changing anything:
 * verifies an already linked price, or finds existing matching prices on the
 * Annual Update product. The result is saved as the version's snapshot so the
 * admin can review it before linking, creating or publishing.
 */
export async function checkVersionPrice(repo: CommerceRepo, port: StripeCatalogPort, versionId: string): Promise<StripeVerification> {
  const version = await repo.getVersion(versionId);
  if (!version) throw new ValidationError("Version not found.");
  const snap: StripeVerification = { checked_at: nowIso(), mode: port.mode, ok: false, issues: [], price: null, candidates: [] };
  try {
    const updateProduct = await updateProductFor(repo);
    const p = await port.getProduct(updateProduct.stripe_product_id!);
    snap.product = p;
    if (!p.active || p.livemode !== (port.mode === "live")) {
      snap.state = "product_invalid";
      snap.issues.push(!p.active ? `The Annual Update product ${p.id} is archived in Stripe.` : `The Annual Update product ${p.id} is not a ${port.mode}-mode product.`);
    } else if (version.stripe_update_price_id) {
      const price = await port.getPrice(version.stripe_update_price_id);
      snap.price = price;
      snap.issues.push(...priceIssues(price, port.mode, { productId: p.id, amountCents: version.update_price_cents, currency: "usd", oneTime: true }));
      snap.state = snap.issues.length ? "linked_invalid" : "linked_verified";
    } else {
      const matches = (await port.listActivePrices(p.id)).filter((x) => matchesVersion(x, port.mode, p.id, version.update_price_cents));
      snap.candidates = matches;
      snap.state = matches.length === 0 ? "create_required" : matches.length === 1 ? "reuse_candidate" : "ambiguous";
      if (matches.length > 1) snap.issues.push(`${matches.length} active one-time ${dollars(version.update_price_cents)} prices exist on the Annual Update product. Review them in Stripe and link the correct one.`);
    }
  } catch (e) {
    snap.state = undefined;
    snap.issues.push(e instanceof ValidationError ? e.message : lookupMessage(e));
  }
  snap.ok = snap.state === "linked_verified";
  await repo.updateVersion(version.id, { stripe_verification: snap });
  return snap;
}

/** Links a specific Stripe price to a version after the admin confirmed it; refuses unless Stripe confirms every detail. */
export async function linkVersionPrice(repo: CommerceRepo, port: StripeCatalogPort, versionId: string, priceId: string, confirmed: boolean) {
  if (!confirmed) throw new ValidationError("Confirm that this Stripe price should be used for the update.");
  if (!/^price_[A-Za-z0-9]+$/.test(priceId)) throw new ValidationError("Invalid Stripe price id.");
  const version = await repo.getVersion(versionId);
  if (!version) throw new ValidationError("Version not found.");
  const updateProduct = await updateProductFor(repo);
  let price: StripePriceFacts;
  try {
    price = await port.getPrice(priceId);
  } catch (e) {
    throw new ValidationError(lookupMessage(e));
  }
  const issues = priceIssues(price, port.mode, { productId: updateProduct.stripe_product_id, amountCents: version.update_price_cents, currency: "usd", oneTime: true });
  if (issues.length) throw new ValidationError(`Not linked: ${issues.join(" ")}`);
  const snap: StripeVerification = { checked_at: nowIso(), mode: port.mode, ok: true, state: "linked_verified", issues: [], price, candidates: [], product: null };
  return repo.updateVersion(version.id, { stripe_update_price_id: price.id, stripe_verification: snap });
}

/**
 * Creates a new one-time price on the existing Annual Update product (never a
 * new product) and links it, only after explicit confirmation and only when no
 * existing matching price exists. Idempotent per version and amount.
 */
export async function createVersionPrice(repo: CommerceRepo, port: StripeCatalogPort, versionId: string, confirmed: boolean) {
  if (!confirmed) throw new ValidationError("Confirm that a new Stripe price should be created.");
  const version = await repo.getVersion(versionId);
  if (!version) throw new ValidationError("Version not found.");
  if (version.stripe_update_price_id) throw new ValidationError("This version already has a linked price. Check it instead of creating another.");
  const updateProduct = await updateProductFor(repo);
  let existing: StripePriceFacts[];
  try {
    existing = (await port.listActivePrices(updateProduct.stripe_product_id!)).filter((x) => matchesVersion(x, port.mode, updateProduct.stripe_product_id!, version.update_price_cents));
  } catch (e) {
    throw new ValidationError(lookupMessage(e));
  }
  if (existing.length) throw new ValidationError(`A matching ${dollars(version.update_price_cents)} one-time price already exists (${existing.map((p) => p.id).join(", ")}). Link it instead of creating a duplicate.`);
  let price: StripePriceFacts;
  try {
    price = await port.createOneTimePrice({
      productId: updateProduct.stripe_product_id!,
      unitAmount: version.update_price_cents,
      currency: "usd",
      idempotencyKey: `monarch-version-price-${version.id}-${version.update_price_cents}`,
      metadata: { monarch_version_id: version.id, tax_year: String(version.tax_year) },
    });
  } catch (e) {
    throw new ValidationError(lookupMessage(e));
  }
  return linkVersionPrice(repo, port, version.id, price.id, true);
}

/** A version may be published only with a Stripe-verified price that still matches its catalog price. */
export function publishBlockersForVersion(version: ProductVersion): string[] {
  const v = version.stripe_verification;
  if (!version.stripe_update_price_id) return ["Link a verified Stripe price first."];
  if (!v || v.state !== "linked_verified" || v.price?.id !== version.stripe_update_price_id) return ["Verify the linked Stripe price first (Check Stripe price)."];
  if (v.price?.unit_amount !== version.update_price_cents) return ["The verified Stripe price no longer matches the update price. Check Stripe price again."];
  return [];
}
