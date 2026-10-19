"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { hideReview } from "@/lib/reviews/service.ts";
import { reviewsRepo } from "@/lib/reviews/server";

const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string) : "");

/** Hide a review from the storefront (kept, with the reason) or show it again. */
export async function hideReviewAction(form: FormData) {
  await requireAdmin();
  const productId = str(form, "product_id");
  const back = `/products/${/^[0-9a-f-]{36}$/i.test(productId) ? productId : ""}`;
  let message = "";
  let key: "notice" | "error" = "notice";
  try {
    const hide = str(form, "hide") === "yes";
    await hideReview(reviewsRepo(), str(form, "id"), hide, str(form, "reason"));
    message = hide ? "Review hidden. It is kept, and you can show it again." : "Review is showing again.";
  } catch (e) {
    unstable_rethrow(e);
    key = "error";
    message = e instanceof ValidationError ? e.message : "That did not work. Nothing was changed.";
  }
  revalidatePath("/shop", "layout");
  redirect(`${back}?${key}=${encodeURIComponent(message)}`);
}
