"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientAddress, hashClient, windowStart } from "@/lib/commerce/rate-limit.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { rateLimitStore } from "@/lib/rate-limit-server";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { postReview } from "@/lib/reviews/service.ts";
import { reviewsRepo } from "@/lib/reviews/server";
import { publishedProductBySlug } from "@/lib/storefront";

const text = (form: FormData, k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");

/** A verified purchaser posts a review. Limited per visitor; the purchase is checked again on the server. */
export async function postReviewAction(form: FormData) {
  const slug = text(form, "slug").slice(0, 120);
  if (!/^[a-z0-9-]+$/.test(slug)) redirect("/shop");
  let message: { key: "rn" | "re"; text: string };
  try {
    const product = await publishedProductBySlug(slug);
    if (!product) redirect("/shop");
    const ip = clientAddress((await headers()).get("x-forwarded-for"));
    if (ip) {
      const hits = await rateLimitStore().hit(`review:ip:${hashClient(ip, process.env.MONARCH_ENCRYPTION_KEY)}`, windowStart(Date.now()).startIso).catch(() => 0);
      if (hits > 8) throw new ValidationError("Too many attempts. Please wait a minute and try again.");
    }
    const repo = reviewsRepo();
    await postReview(repo, repo, product.id, { email: text(form, "email"), orderNumber: text(form, "order_number"), rating: text(form, "rating"), body: text(form, "body"), displayName: text(form, "display_name") });
    message = { key: "rn", text: "Thank you! Your review is live." };
  } catch (e) {
    if (e instanceof ValidationError) message = { key: "re", text: e.message };
    else if (e && typeof e === "object" && "digest" in e) throw e;
    else {
      console.error(`review failed: ${sanitizeError(e, 160)}`);
      message = { key: "re", text: "Something went wrong on our side. Please try again in a minute." };
    }
  }
  redirect(`/shop/${slug}?${message.key}=${encodeURIComponent(message.text)}#reviews`);
}
