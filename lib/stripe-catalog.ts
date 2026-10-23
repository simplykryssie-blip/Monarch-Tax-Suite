import "server-only";
import type Stripe from "stripe";
import { appOrigin, commerceRepo } from "./admin";
import { assessWebhooks, expectedWebhookUrl, webhookFix, type WebhookHealth } from "./commerce/webhook-health.ts";
import { ValidationError } from "./commerce/validation.ts";
import { modeFromKey, StripeLookupError, type StripeCatalogPort } from "./commerce/stripe-verify.ts";
import type { StripePriceFacts } from "./commerce/types.ts";
import { isPurchasable } from "./commerce/catalog.ts";
import { expireOpenCheckouts, type StorefrontSessionPort } from "./commerce/storefront-checkout.ts";
import { syncStripeAvailability, type StripePort } from "./commerce/stripe-sync.ts";
import { loadStoreStripe, storeStripeClient } from "./store-stripe/server";

// Server-only adapter from the Stripe SDK to StripeCatalogPort. The workspace's secret key stays on the server (saved
// encrypted in its settings; see lib/store-stripe); only its mode (live/test) is used for display and checks.

export async function stripeConfig() {
  const st = await loadStoreStripe();
  const mode = modeFromKey(st.secretKey);
  return {
    secretKey: Boolean(st.secretKey),
    keyModeRecognized: mode !== null,
    mode,
    webhookSecret: Boolean(st.webhookSecret),
  };
}

function mapError(e: unknown, what: string, mode: "test" | "live" | null): StripeLookupError {
  const err = e as { type?: string; code?: string; statusCode?: number; message?: string };
  if (err?.code === "resource_missing" || err?.statusCode === 404) return new StripeLookupError("not_found", `${what} was not found in this Stripe account (${mode ?? "unknown"} mode).`);
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

/** Null when no Stripe secret key is set, or it isn't a recognizable secret/restricted key. */
export async function stripeCatalogPort(): Promise<StripeCatalogPort | null> {
  const st = await loadStoreStripe();
  const stripe = st.stripe;
  const mode = modeFromKey(st.secretKey);
  if (!stripe || !mode) return null;
  return {
    mode,
    async getProduct(id) {
      try {
        const p = await stripe.products.retrieve(id);
        return { id: p.id, name: p.name, active: p.active, livemode: p.livemode };
      } catch (e) {
        throw mapError(e, `Stripe product ${id}`, mode);
      }
    },
    async getPrice(id) {
      try {
        return facts(await stripe.prices.retrieve(id, { expand: ["product"] }));
      } catch (e) {
        throw mapError(e, `Stripe price ${id}`, mode);
      }
    },
    async listActivePrices(productId) {
      try {
        const list = await stripe.prices.list({ product: productId, active: true, limit: 100, expand: ["data.product"] });
        return list.data.map(facts);
      } catch (e) {
        throw mapError(e, `Prices of ${productId}`, mode);
      }
    },
    async createOneTimePrice({ productId, unitAmount, currency, idempotencyKey, metadata }) {
      try {
        const price = await stripe.prices.create({ product: productId, unit_amount: unitAmount, currency, metadata }, { idempotencyKey });
        return facts(await stripe.prices.retrieve(price.id, { expand: ["product"] }));
      } catch (e) {
        throw mapError(e, `New price on ${productId}`, mode);
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
  const stripe = await storeStripeClient();
  if (!stripe) return "";
  const result = await syncStripeAvailability(commerceRepo(), stripeSyncPort(stripe), productId, await stripeCatalogPort());
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
  const stripe = await storeStripeClient();
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

/**
 * The live state of this app's Stripe webhook. The one-click fix is offered only on the production deployment, so a
 * Preview (test key) can never repoint an endpoint at an address it does not own.
 */
export async function loadWebhookHealth(): Promise<{ health: WebhookHealth; canFix: boolean } | { error: string }> {
  const stripe = await storeStripeClient();
  if (!stripe) return { error: "Stripe is not connected, so the webhook cannot be checked." };
  try {
    const list = await stripe.webhookEndpoints.list({ limit: 100 });
    const endpoints = list.data.map((e) => ({ id: e.id, url: e.url, status: e.status, enabled_events: e.enabled_events, livemode: e.livemode }));
    const health = assessWebhooks(endpoints, expectedWebhookUrl(await appOrigin()));
    return { health, canFix: process.env.VERCEL_ENV === "production" && health.state === "fixable" };
  } catch (e) {
    const err = e as { type?: string; message?: string };
    return { error: err?.type === "StripePermissionError" ? "The Stripe key cannot read webhook endpoints (missing permission), so the webhook cannot be checked here." : `The webhook could not be checked: ${(err?.message ?? "Stripe request failed").slice(0, 200)}` };
  }
}

/** Repoints the existing endpoint at this app (and adds missing events). Keeps the signing secret. */
export async function fixWebhook(): Promise<string> {
  const stripe = await storeStripeClient();
  const loaded = await loadWebhookHealth();
  if (!stripe || "error" in loaded) throw new ValidationError("error" in loaded ? loaded.error : "Stripe is not connected.");
  if (!loaded.canFix || loaded.health.state !== "fixable") throw new ValidationError(loaded.health.state === "ok" ? "The webhook is already correct." : "This webhook cannot be fixed automatically here; follow the steps shown.");
  const { url, enabled_events } = webhookFix(loaded.health);
  await stripe.webhookEndpoints.update(loaded.health.endpoint.id, { url, ...(enabled_events ? { enabled_events: enabled_events as Stripe.WebhookEndpointUpdateParams.EnabledEvent[] } : {}) });
  const after = await loadWebhookHealth();
  if ("error" in after || after.health.state !== "ok") throw new ValidationError("Stripe accepted the change, but the webhook still does not check out. Reload to see what remains.");
  return `Webhook ${loaded.health.endpoint.id} now sends events to ${url}. Its signing secret is unchanged.`;
}
