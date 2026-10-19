import { randomUUID } from "node:crypto";
import { isStorefrontVisible } from "./catalog.ts";
import { lookupMessage, priceIssues, type StripeCatalogPort } from "./stripe-verify.ts";
import { publishBlockers, ValidationError } from "./validation.ts";
import { INSTALLATION_TYPES, type CommerceRepo, type InstallationType, type StorefrontCheckout } from "./types.ts";

// The only way to buy from the storefront. The server starts every Stripe Checkout Session itself, after checking
// that the product is published and sellable and that its Stripe price still matches the catalog. The session
// carries server-set metadata and is recorded, with the Terms / Refund Policy version the buyer accepted, so the
// webhook can tell a genuine storefront purchase from a pasted payment link and check the amount paid.
// The browser supplies only the product slug, the installation option and the acceptance checkbox.

export type StorefrontSessionPort = {
  create(input: {
    priceId: string;
    metadata: Record<string, string>;
    successUrl: string;
    cancelUrl: string;
    expiresAt: number;
    idempotencyKey: string;
  }): Promise<{ id: string; url: string | null; expires_at: number }>;
  /** Closes an open session so it can no longer be paid. */
  expire(id: string): Promise<void>;
};

export const CHECKOUT_PURPOSE = "storefront_purchase";
const SESSION_MINUTES = 60;
const UNAVAILABLE = "This product is not available for online purchase right now. Please contact Monarch Tax Suite.";

export type StartCheckoutInput = {
  slug: string;
  installationType: string | null;
  termsAccepted: boolean;
  termsVersion: string;
  origin: string;
  now?: Date;
  /** For checkouts started elsewhere than the shop page (the WISP Generator): extra server-set metadata and pages. */
  extraMetadata?: Record<string, string>;
  successPath?: string;
  cancelPath?: string;
};

export async function startStorefrontCheckout(repo: CommerceRepo, catalog: StripeCatalogPort, sessions: StorefrontSessionPort, input: StartCheckoutInput): Promise<{ url: string; sessionId: string }> {
  const now = input.now ?? new Date();
  if (!input.termsAccepted) throw new ValidationError("Please confirm that you have read and accept the Terms of Service and the Refund Policy.");
  const product = (await repo.listProducts()).find((p) => p.slug === input.slug) ?? null;
  // Drafts, unpublished, archived and update products answer exactly like an unknown product.
  if (!product || !isStorefrontVisible(product)) throw new ValidationError(UNAVAILABLE);
  const images = await repo.listProductImages([product.id]);
  if (publishBlockers(product, images.length).length || !product.stripe_price_id || product.price_cents === null) throw new ValidationError(UNAVAILABLE);
  // A WISP is bought from the builder, with the plan it pays for; never as a bare purchase.
  if (product.metadata?.delivery === "wisp_generator" && !input.extraMetadata?.wisp_plan_id) throw new ValidationError("Build your WISP first: the purchase is made from the last step of the WISP builder.");

  let installationType: InstallationType | null = null;
  if (product.access_type === "license") {
    const requested = input.installationType && (INSTALLATION_TYPES as readonly string[]).includes(input.installationType) ? (input.installationType as InstallationType) : null;
    installationType = requested && product.installation_options.includes(requested) ? requested : product.installation_options.length === 1 ? product.installation_options[0] : null;
    if (!installationType) throw new ValidationError("Choose how you would like the calculator installed.");
  }

  // Verify the price live before every checkout; refuse safely if Stripe cannot confirm it.
  let issues: string[];
  try {
    const price = await catalog.getPrice(product.stripe_price_id);
    issues = priceIssues(price, catalog.mode, { productId: product.stripe_product_id, amountCents: product.price_cents, currency: product.currency, oneTime: true });
  } catch (e) {
    console.error(`storefront-checkout: price verification failed for ${product.id}: ${lookupMessage(e)}`);
    throw new ValidationError("Online checkout is temporarily unavailable. Please try again later.");
  }
  if (issues.length) {
    console.error(`storefront-checkout: price ${product.stripe_price_id} failed verification for ${product.id}`);
    throw new ValidationError(UNAVAILABLE);
  }

  const checkoutRef = randomUUID();
  const acceptedAt = now.toISOString();
  const metadata: Record<string, string> = { purpose: CHECKOUT_PURPOSE, product_id: product.id, checkout_ref: checkoutRef, terms_version: input.termsVersion };
  if (installationType) metadata.installation_type = installationType;
  for (const [k, v] of Object.entries(input.extraMetadata ?? {})) if (!(k in metadata)) metadata[k] = v;
  const session = await sessions.create({
    priceId: product.stripe_price_id,
    metadata,
    successUrl: `${input.origin}${input.successPath ?? `/shop/${product.slug}/thank-you`}`,
    cancelUrl: `${input.origin}${input.cancelPath ?? `/shop/${product.slug}`}`,
    expiresAt: Math.floor(now.getTime() / 1000) + SESSION_MINUTES * 60,
    idempotencyKey: `monarch-shop-${checkoutRef}`,
  });
  if (!session.url) throw new ValidationError("Stripe did not return a checkout page. Please try again.");
  try {
    await repo.recordStorefrontCheckout({
      product_id: product.id,
      stripe_session_id: session.id,
      stripe_price_id: product.stripe_price_id,
      amount_cents: product.price_cents,
      currency: product.currency.toLowerCase(),
      installation_type: installationType,
      terms_version: input.termsVersion,
      terms_accepted_at: acceptedAt,
      expires_at: new Date(session.expires_at * 1000).toISOString(),
    });
  } catch (e) {
    // An unrecorded session could never be fulfilled, so it must not be paid: close it and refuse.
    console.error(`storefront-checkout: could not record session ${session.id}: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
    await sessions.expire(session.id).catch(() => undefined);
    throw new ValidationError("Online checkout is temporarily unavailable. Please try again later.");
  }
  return { url: session.url, sessionId: session.id };
}

/**
 * Closes every open storefront checkout for a product that is no longer purchasable, so a buyer who opened
 * checkout before it was unpublished cannot complete payment. The webhook still refuses a payment that slips
 * through. Returns how many were closed.
 */
export async function expireOpenCheckouts(repo: CommerceRepo, sessions: StorefrontSessionPort, productId: string, now = new Date()): Promise<number> {
  const open = (await repo.listStorefrontCheckouts(100, productId)).filter((c) => c.status === "open" && c.expires_at > now.toISOString());
  let closed = 0;
  for (const c of open) {
    try {
      await sessions.expire(c.stripe_session_id);
      await repo.updateStorefrontCheckout(c.id, { status: "expired" });
      closed++;
    } catch (e) {
      console.error(`storefront-checkout: could not expire ${c.stripe_session_id}: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
    }
  }
  return closed;
}

/** Why a paid storefront session must not be fulfilled automatically, or null when it matches its recorded checkout. */
export function checkoutMismatch(checkout: StorefrontCheckout | null, session: { amount_total?: number | null; currency?: string | null }, productId: string): string | null {
  if (!checkout) return "this payment did not come from a checkout the Monarch storefront started (for example an old payment link)";
  if (checkout.product_id !== productId) return "the paid product does not match the product the checkout was started for";
  if ((session.amount_total ?? -1) !== checkout.amount_cents || (session.currency ?? "").toLowerCase() !== checkout.currency) {
    return `the amount paid (${session.amount_total ?? "unknown"} ${session.currency ?? ""}) does not match the checkout price (${checkout.amount_cents} ${checkout.currency})`;
  }
  return null;
}
