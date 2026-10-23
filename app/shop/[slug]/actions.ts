"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientAddress, hashClient, windowStart } from "@/lib/commerce/rate-limit.ts";
import { rateLimitStore } from "@/lib/rate-limit-server";
import { appOrigin, commerceRepo } from "@/lib/admin";
import { startStorefrontCheckout } from "@/lib/commerce/storefront-checkout.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { LEGAL_PAGES_APPROVED, LEGAL_VERSION } from "@/lib/legal";
import { stripeCatalogPort, stripeStorefrontSessions } from "@/lib/stripe-catalog";
import { storeStripeClient } from "@/lib/store-stripe/server";

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
};

/**
 * Buy button. Starts a Stripe Checkout Session on the server; nothing is granted here. The order and the license
 * are created only when the signed webhook confirms payment.
 */
export async function startCheckoutAction(form: FormData) {
  const slug = text(form, "slug").slice(0, 120);
  if (!/^[a-z0-9-]+$/.test(slug)) redirect("/shop");
  let url: string;
  try {
    // Each click creates a Stripe session, so starting checkouts is limited per visitor.
    const ip = clientAddress((await headers()).get("x-forwarded-for"));
    if (ip) {
      const hits = await rateLimitStore().hit(`shop-checkout:ip:${hashClient(ip, process.env.MONARCH_ENCRYPTION_KEY)}`, windowStart(Date.now()).startIso).catch(() => 0);
      if (hits > 10) throw new ValidationError("Too many checkout attempts. Please wait a minute and try again.");
    }
    const stripe = await storeStripeClient();
    const catalog = await stripeCatalogPort();
    if (!stripe || !catalog || !LEGAL_PAGES_APPROVED) throw new ValidationError("Online checkout is not available yet. Please contact Monarch Tax Suite.");
    ({ url } = await startStorefrontCheckout(commerceRepo(), catalog, stripeStorefrontSessions(stripe), {
      slug,
      installationType: text(form, "installation_type") || null,
      termsAccepted: form.get("accept_terms") === "yes",
      termsVersion: LEGAL_VERSION,
      origin: (await appOrigin()).replace(/\/$/, ""),
    }));
  } catch (error) {
    if (error instanceof ValidationError) redirect(`/shop/${slug}?error=${encodeURIComponent(error.message)}`);
    throw error;
  }
  redirect(url);
}
