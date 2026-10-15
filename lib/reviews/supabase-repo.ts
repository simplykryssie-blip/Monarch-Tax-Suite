import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PurchaseCheck, Review, ReviewInsert, ReviewsRepo } from "./types.ts";

const unwrap = <T>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

export class SupabaseReviewsRepo implements ReviewsRepo, PurchaseCheck {
  constructor(private db: SupabaseClient) {}
  async listForProduct(productId: string, includeHidden: boolean) {
    let q = this.db.from("product_reviews").select("*").eq("product_id", productId).order("created_at", { ascending: false }).limit(500);
    if (!includeHidden) q = q.is("hidden_at", null);
    return unwrap(await q) as Review[];
  }
  async ratingsByProduct(productIds: string[]) {
    const out = new Map<string, number[]>();
    if (!productIds.length) return out;
    const rows = unwrap(await this.db.from("product_reviews").select("product_id, rating").in("product_id", productIds).is("hidden_at", null).limit(5000)) as { product_id: string; rating: number }[];
    for (const r of rows) out.set(r.product_id, [...(out.get(r.product_id) ?? []), r.rating]);
    return out;
  }
  async findByCustomer(productId: string, customerId: string) { return unwrap(await this.db.from("product_reviews").select("*").eq("product_id", productId).eq("customer_id", customerId).maybeSingle()) as Review | null; }
  async get(id: string) { return unwrap(await this.db.from("product_reviews").select("*").eq("id", id).maybeSingle()) as Review | null; }
  async insert(input: ReviewInsert) { return unwrap(await this.db.from("product_reviews").insert(input).select("*").single()) as Review; }
  async setHidden(id: string, hiddenAt: string | null, reason: string | null) { return unwrap(await this.db.from("product_reviews").update({ hidden_at: hiddenAt, hidden_reason: reason }).eq("id", id).select("*").single()) as Review; }

  async findCustomerByEmail(email: string) { return unwrap(await this.db.from("calculator_customers").select("id, full_name").eq("email", email).maybeSingle()) as { id: string; full_name: string | null } | null; }
  async findPaidOrder(customerId: string, productId: string, orderNumber: number) {
    return unwrap(await this.db.from("orders").select("id").eq("customer_id", customerId).eq("product_id", productId).eq("order_number", orderNumber).eq("payment_status", "paid").maybeSingle()) as { id: string } | null;
  }
}
