"use server";

import { redirect } from "next/navigation";
import { serviceClient } from "@/lib/supabase/service";
import { SupabaseCommerceRepo } from "@/lib/commerce/supabase-repo.ts";
import { lookupUpdate } from "@/lib/commerce/versions.ts";
import { startUpdateCheckout, type CheckoutSessionPort } from "@/lib/commerce/update-checkout.ts";
import { stripeCatalogPort } from "@/lib/stripe-catalog";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { appOrigin, stripeClient } from "@/lib/admin";

export type UpdateState = {
  error?: string;
  info?: { currentYear: number | null; latestYear: number | null; label?: string; priceCents?: number; eligible: boolean; reason?: string; status: string };
};

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
};

/** Shows the customer's licensed version and any available update. */
export async function checkUpdateAction(_prev: UpdateState, form: FormData): Promise<UpdateState> {
  try {
    const { license, offer } = await lookupUpdate(new SupabaseCommerceRepo(serviceClient()), text(form, "license_key"));
    return {
      info: offer.eligible
        ? { currentYear: offer.currentYear, latestYear: offer.version.tax_year, label: offer.version.label, priceCents: offer.priceCents, eligible: true, status: license.status }
        : { currentYear: offer.currentYear, latestYear: offer.latestYear, eligible: false, reason: offer.reason, status: license.status },
    };
  } catch (error) {
    if (error instanceof ValidationError) return { error: error.message };
    throw error;
  }
}

/**
 * Starts (or resumes) a one-time Stripe Checkout Session for the update.
 * Nothing is granted here: the license changes only when the signed webhook
 * confirms payment.
 */
export async function startUpdateCheckoutAction(form: FormData) {
  const stripe = stripeClient();
  const catalog = stripeCatalogPort();
  let url: string;
  try {
    if (!stripe || !catalog) throw new ValidationError("Online updates are not available yet. Please contact Monarch Tax Suite.");
    const sessions: CheckoutSessionPort = {
      async create(input) {
        const session = await stripe.checkout.sessions.create(
          {
            mode: "payment",
            line_items: [{ price: input.priceId, quantity: 1 }],
            customer_email: input.customerEmail,
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
      async get(id) {
        const session = await stripe.checkout.sessions.retrieve(id);
        const status: "open" | "complete" | "expired" = session.status === "open" ? "open" : session.status === "complete" ? "complete" : "expired";
        return { id: session.id, status, url: session.url };
      },
    };
    ({ url } = await startUpdateCheckout(new SupabaseCommerceRepo(serviceClient()), catalog, sessions, { licenseKey: text(form, "license_key"), origin: await appOrigin() }));
  } catch (error) {
    if (error instanceof ValidationError) redirect(`/update?error=${encodeURIComponent(error.message)}`);
    throw error;
  }
  redirect(url);
}
