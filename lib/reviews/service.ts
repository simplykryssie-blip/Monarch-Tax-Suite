import { ValidationError } from "../commerce/validation.ts";
import type { PurchaseCheck, Review, ReviewsRepo } from "./types.ts";

export const BODY_MIN = 10;
export const BODY_MAX = 2000;
/** The one answer for every way a purchase check can fail, so the form never reveals which email or order exists. */
export const NOT_VERIFIED = "We couldn't find a paid order for that email and order number on this product. Use the email you bought with and the order number from your receipt.";

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** "Casey Client" becomes "Casey C."; a single name stays; nothing at all is "Verified buyer". */
export function defaultName(fullName: string | null): string {
  const words = (fullName ?? "").replace(/[^\p{L}\p{N}' .-]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "Verified buyer";
  if (words.length === 1) return words[0].slice(0, 40);
  return `${words[0].slice(0, 30)} ${words[words.length - 1][0].toUpperCase()}.`;
}

export type ReviewInput = { email: unknown; orderNumber: unknown; rating: unknown; body: unknown; displayName?: unknown };

/**
 * Posts a review. The reviewer proves they bought this product with the email and order number of a paid order. It is
 * live at once. One review per customer per product.
 */
export async function postReview(repo: ReviewsRepo, check: PurchaseCheck, productId: string, input: ReviewInput): Promise<Review> {
  const rating = Number(clean(input.rating, 2));
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new ValidationError("Choose a star rating from 1 to 5.");
  const body = clean(input.body, BODY_MAX + 1);
  if (body.length < BODY_MIN) throw new ValidationError(`Write at least ${BODY_MIN} characters about your experience.`);
  if (body.length > BODY_MAX) throw new ValidationError(`Reviews can be up to ${BODY_MAX} characters.`);
  const email = clean(input.email, 254).toLowerCase();
  const number = Number(clean(input.orderNumber, 12).replace(/^#/, ""));
  if (!EMAIL.test(email) || !Number.isInteger(number) || number <= 0) throw new ValidationError(NOT_VERIFIED);

  const customer = await check.findCustomerByEmail(email);
  const order = customer ? await check.findPaidOrder(customer.id, productId, number) : null;
  if (!customer || !order) throw new ValidationError(NOT_VERIFIED);
  if (await repo.findByCustomer(productId, customer.id)) throw new ValidationError("You have already reviewed this product. Thank you!");

  const display = clean(input.displayName, 40).replace(/\s+/g, " ") || defaultName(customer.full_name);
  try {
    return await repo.insert({ product_id: productId, customer_id: customer.id, order_id: order.id, rating, body, display_name: display });
  } catch (e) {
    if (/product_reviews_one_per_customer|duplicate key/i.test(e instanceof Error ? e.message : "")) throw new ValidationError("You have already reviewed this product. Thank you!");
    throw e;
  }
}

export async function hideReview(repo: ReviewsRepo, id: string, hide: boolean, reason: unknown, now = new Date()): Promise<Review> {
  const review = await repo.get(id);
  if (!review) throw new ValidationError("That review wasn't found.");
  return repo.setHidden(id, hide ? now.toISOString() : null, hide ? clean(reason, 300) || null : null);
}

export type Summary = { count: number; average: number; stars: Record<1 | 2 | 3 | 4 | 5, number> };
/** The average (one decimal) and how many reviews gave each star. Hidden reviews are not counted. */
export function summarize(reviews: Pick<Review, "rating" | "hidden_at">[]): Summary {
  const visible = reviews.filter((r) => !r.hidden_at);
  const stars: Summary["stars"] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of visible) stars[r.rating as 1 | 2 | 3 | 4 | 5]++;
  const sum = visible.reduce((n, r) => n + r.rating, 0);
  return { count: visible.length, average: visible.length ? Math.round((sum / visible.length) * 10) / 10 : 0, stars };
}
