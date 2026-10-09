import "server-only";
import type Stripe from "stripe";
import { stripeClient } from "./admin";
import { modeFromKey, StripeLookupError, type StripeCatalogPort } from "./commerce/stripe-verify.ts";
import type { StripePriceFacts } from "./commerce/types.ts";

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
