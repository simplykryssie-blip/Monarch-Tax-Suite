import { lookupUpdate } from "./versions.ts";
import { lookupMessage, priceIssues, updateProductFor, type StripeCatalogPort } from "./stripe-verify.ts";
import { ValidationError } from "./validation.ts";
import type { CommerceRepo } from "./types.ts";

// Starts (or resumes) the Stripe Checkout for an annual tax-year update.
// Everything that decides what is charged comes from the server: the license
// (from the customer's key), the newest available version, and that version's
// Stripe-verified price. The browser only supplies the license key.

export type CheckoutSessionPort = {
  create(input: {
    priceId: string;
    customerEmail: string;
    metadata: Record<string, string>;
    successUrl: string;
    cancelUrl: string;
    expiresAt: number;
    idempotencyKey: string;
  }): Promise<{ id: string; url: string | null; expires_at: number }>;
  get(id: string): Promise<{ id: string; status: "open" | "complete" | "expired"; url: string | null }>;
};

const SESSION_MINUTES = 60;

export async function startUpdateCheckout(
  repo: CommerceRepo,
  catalog: StripeCatalogPort,
  sessions: CheckoutSessionPort,
  input: { licenseKey: string; origin: string; now?: Date },
): Promise<{ url: string; resumed: boolean }> {
  const now = input.now ?? new Date();
  const { license, customer, offer } = await lookupUpdate(repo, input.licenseKey);
  if (!offer.eligible) throw new ValidationError("There is no update available for this license.");
  const version = offer.version;
  if (!version.stripe_update_price_id) throw new ValidationError("This update is not yet available for online purchase. Please contact Monarch Tax Suite.");

  // Verify the linked price live before every checkout; fail safely if Stripe cannot confirm it.
  const updateProduct = await updateProductFor(repo).catch(() => null);
  if (!updateProduct) throw new ValidationError("This update is not yet available for online purchase. Please contact Monarch Tax Suite.");
  let issues: string[];
  try {
    const price = await catalog.getPrice(version.stripe_update_price_id);
    issues = priceIssues(price, catalog.mode, { productId: updateProduct.stripe_product_id, amountCents: version.update_price_cents, currency: "usd", oneTime: true });
  } catch (e) {
    console.error("update-checkout: price verification failed:", lookupMessage(e));
    throw new ValidationError("Online updates are temporarily unavailable. Please try again later.");
  }
  if (issues.length) {
    console.error(`update-checkout: price ${version.stripe_update_price_id} failed verification for ${version.tax_year}`);
    throw new ValidationError("This update is not available for online purchase right now. Please contact Monarch Tax Suite.");
  }

  // One checkout per license and tax year: resume an open session instead of creating a second chargeable one.
  const existing = await repo.findOpenUpdateCheckout(license.id, version.tax_year, now.toISOString());
  if (existing) {
    const session = await sessions.get(existing.stripe_session_id).catch(() => null);
    if (session?.status === "open" && session.url) return { url: session.url, resumed: true };
    if (session?.status === "complete") throw new ValidationError("Payment for this update was already received. It will be applied to your license shortly.");
  }

  const metadata = { purpose: "annual_update", license_id: license.id, tax_year: String(version.tax_year) };
  const bucket = Math.floor(now.getTime() / (10 * 60 * 1000));
  const session = await sessions.create({
    priceId: version.stripe_update_price_id,
    customerEmail: customer.email,
    metadata,
    successUrl: `${input.origin}/update/complete`,
    cancelUrl: `${input.origin}/update`,
    expiresAt: Math.floor(now.getTime() / 1000) + SESSION_MINUTES * 60,
    // Concurrent clicks within the same window get the same session from Stripe.
    idempotencyKey: `monarch-update-${license.id}-${version.tax_year}-${bucket}`,
  });
  if (!session.url) throw new ValidationError("Stripe did not return a checkout page. Please try again.");
  await repo.recordUpdateCheckout({ license_id: license.id, tax_year: version.tax_year, stripe_session_id: session.id, expires_at: new Date(session.expires_at * 1000).toISOString() }).catch(() => undefined);
  return { url: session.url, resumed: false };
}
