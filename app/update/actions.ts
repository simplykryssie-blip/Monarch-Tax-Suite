"use server";

import { redirect } from "next/navigation";
import { serviceClient } from "@/lib/supabase/service";
import { SupabaseCommerceRepo } from "@/lib/commerce/supabase-repo.ts";
import { assertOneTimeUpdatePrice, lookupUpdate } from "@/lib/commerce/versions.ts";
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
 * Creates a one-time Stripe Checkout Session for the update. Nothing is granted
 * here: the license changes only when the signed webhook confirms payment.
 */
export async function startUpdateCheckoutAction(form: FormData) {
  const stripe = stripeClient();
  let url: string;
  try {
    if (!stripe) throw new ValidationError("Online updates are not available yet. Please contact Monarch Tax Suite.");
    const { license, customer, offer } = await lookupUpdate(new SupabaseCommerceRepo(serviceClient()), text(form, "license_key"));
    if (!offer.eligible) throw new ValidationError("There is no update available for this license.");
    const version = offer.version;
    if (!version.stripe_update_price_id) throw new ValidationError("This update is not yet available for online purchase. Please contact Monarch Tax Suite.");
    assertOneTimeUpdatePrice(await stripe.prices.retrieve(version.stripe_update_price_id), version);
    const origin = await appOrigin();
    const metadata = { purpose: "annual_update", license_id: license.id, tax_year: String(version.tax_year) };
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: version.stripe_update_price_id, quantity: 1 }],
      customer_email: customer.email,
      metadata,
      payment_intent_data: { metadata },
      success_url: `${origin}/update/complete`,
      cancel_url: `${origin}/update`,
    });
    if (!session.url) throw new ValidationError("Stripe did not return a checkout page. Please try again.");
    url = session.url;
  } catch (error) {
    if (error instanceof ValidationError) redirect(`/update?error=${encodeURIComponent(error.message)}`);
    throw error;
  }
  redirect(url);
}
