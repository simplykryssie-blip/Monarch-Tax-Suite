import "server-only";
import type Stripe from "stripe";
import { commerceRepo, stripeClient } from "./admin";
import { modeFromKey, StripeLookupError, type StripeCatalogPort } from "./commerce/stripe-verify.ts";
import type { StripePriceFacts } from "./commerce/types.ts";
import { isPurchasable } from "./commerce/catalog.ts";
import { expireOpenCheckouts, type StorefrontSessionPort } from "./commerce/storefront-checkout.ts";
import { syncStripeAvailability, type StripePort } from "./commerce/stripe-sync.ts";

// Server-only adapter from the Stripe SDK to StripeCatalogPort. The secret
// key stays in process.env on the server; only its mode (live/test) is used
// for display and checks.

export function stripeConfig() {
  const mode = modeFromKey(process.env.STRIPE_SECRET_KEY);
  return {
    secretKey: Boolean(process.env.STRIPE_SECRET_KEY),
    keyModeRecognized: mode !== null,
    mode,
    webhookSecret: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
  };
}

function mapError(e: unknown, what: string): StripeLookupError {
  const err = e as { type?: string; code?: string; statusCode?: number; message?: string };
  if (err?.code === "resource_missing" || err?.statusCode === 404) return new StripeLookupError("not_found", `${what} was not found in this Stripe account (${modeFromKey(process.env.STRIPE_SECRET_KEY) ?? "unknown"} mode).`);
  if (err?.type === "StripeAuthenticationError") return new StripeLookupError("auth", "Invalid Stripe key.");
  if (err?.type === "StripePermissionError") return new StripeLookupError("permission", "Missing Stripe permission.");
  if (err?.type === "StripeConnectionError" || err?.type === "StripeAPIError") return new StripeLookupError("connection", "Stripe unavailable.");
  return new StripeLookupError("other", (err?.message ?? "Stripe request failed.").slice(0, 300));
}

function facts(price: Stripe.Price): StripePriceFacts {
  const product = typeof price.product === "string" ? null : (price.product as Stripe.Product | Stripe.DeletedProduct);
  const live = product && !("deleted" in product && product.deleted) ? (product as Stripe.Product) : null;
  return {
    id: price.id,
    product_id: typeof price.product === "string" ? price.product : price.product.id,
    product_name: live?.name ?? null,
    product_active: live ? live.active : null,
    active: price.active,
    currency: price.currency,
    unit_amount: price.unit_amount,
    type: price.type === "recurring" || price.recurring ? "recurring" : "one_time",
    interval: price.recurring?.interval ?? null,
    livemode: price.livemode,
  };
}

/** Null when STRIPE_SECRET_KEY is missing or not a recognizable Stripe secret/restricted key. */
export function stripeCatalogPort(): StripeCatalogPort | null {
  const stripe = stripeClient();
  const mode = modeFromKey(process.env.STRIPE_SECRET_KEY);
  if (!stripe || !mode) return null;
  return {
    mode,
    async getProduct(id) {
      try {
        const p = await stripe.products.retrieve(id);
        return { id: p.id, name: p.name, active: p.active, livemode: p.livemode };
      } catch (e) {
        throw mapError(e, `Stripe product ${id}`);
      }
    },
    async getPrice(id) {
      try {
        return facts(await stripe.prices.retrieve(id, { expand: ["product"] }));
      } catch (e) {
        throw mapError(e, `Stripe price ${id}`);
      }
    },
    async listActivePrices(productId) {
      try {
        const list = await stripe.prices.list({ product: productId, active: true, limit: 100, expand: ["data.product"] });
        return list.data.map(facts);
      } catch (e) {
        throw mapError(e, `Prices of ${productId}`);
      }
    },
    async createOneTimePrice({ productId, unitAmount, currency, idempotencyKey, metadata }) {
      try {
        const price = await stripe.prices.create({ product: productId, unit_amount: unitAmount, currency, metadata }, { idempotencyKey });
        return facts(await stripe.prices.retrieve(price.id, { expand: ["product"] }));
      } catch (e) {
        throw mapError(e, `New price on ${productId}`);
      }
    },
  };
}

/** Stripe SDK adapter for the explicit product sync operations. */
export function stripeSyncPort(stripe: Stripe): StripePort {
  return {
    updateProduct: (id, params) => stripe.products.update(id, params),
    setProductActive: (id, active) => stripe.products.update(id, { active }),
    // Idempotency keys stop a double-submit from creating two Stripe objects.
    createProduct: (params) => stripe.products.create(params, { idempotencyKey: `monarch-product-${params.metadata.monarch_product_id}` }),
    createPrice: (params) =>
      stripe.prices.create(params, {
        idempotencyKey: `monarch-price-${params.metadata.monarch_product_id}-${params.unit_amount}-${params.currency}-${params.recurring?.interval ?? "once"}`,
      }),
  };
}

/**
 * After a status change, sets the linked Stripe product active only when it is published. Returns a sentence to
 * append to the administrator's notice; the status change itself always stands.
 */
export async function stripeAvailabilityNote(productId: string): Promise<string> {
  const stripe = stripeClient();
  if (!stripe) return "";
  const result = await syncStripeAvailability(commerceRepo(), stripeSyncPort(stripe), productId);
  if (!result) return "";
  return result.ok ? ` ${result.message}` : ` Warning: ${result.message} Payments may still be accepted in Stripe until this is fixed; use "Update Stripe product info" to try again.`;
}

/** Stripe SDK adapter for storefront Checkout Sessions (one-time payments only). */
export function stripeStorefrontSessions(stripe: Stripe): StorefrontSessionPort {
  return {
    async create(input) {
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          line_items: [{ price: input.priceId, quantity: 1 }],
          metadata: input.metadata,
          payment_intent_data: { metadata: input.metadata },
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          expires_at: input.expiresAt,
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return { id: session.id, url: session.url, expires_at: session.expires_at };
    },
    async expire(id) {
      await stripe.checkout.sessions.expire(id);
    },
  };
}

/**
 * After a product stops being purchasable, closes its open storefront checkouts. Returns a sentence for the
 * administrator's notice (empty when there was nothing to close).
 */
export async function closeOpenCheckoutsNote(productId: string): Promise<string> {
  const stripe = stripeClient();
  if (!stripe) return "";
  const product = await commerceRepo().getProduct(productId);
  if (!product || isPurchasable(product)) return "";
  try {
    const closed = await expireOpenCheckouts(commerceRepo(), stripeStorefrontSessions(stripe), productId);
    return closed ? ` ${closed} open checkout${closed === 1 ? " was" : "s were"} closed.` : "";
  } catch (e) {
    console.error(`closeOpenCheckouts ${productId}: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
    return " Warning: open checkouts could not be checked; any payment for this product is still held for review.";
  }
}
