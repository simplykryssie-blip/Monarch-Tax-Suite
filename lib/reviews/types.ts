// Product reviews: a star rating and a written review from a verified purchaser, live at once, hideable by an administrator.

export type Review = {
  id: string; tenant_id: string; product_id: string; customer_id: string; order_id: string; rating: number; body: string; display_name: string;
  hidden_at: string | null; hidden_reason: string | null; created_at: string;
};
export type ReviewInsert = Pick<Review, "product_id" | "customer_id" | "order_id" | "rating" | "body" | "display_name">;

export interface ReviewsRepo {
  /** Newest first. `includeHidden` is for the administrator only. */
  listForProduct(productId: string, includeHidden: boolean): Promise<Review[]>;
  /** Visible reviews' ratings by product, for star averages on a list of products. */
  ratingsByProduct(productIds: string[]): Promise<Map<string, number[]>>;
  findByCustomer(productId: string, customerId: string): Promise<Review | null>;
  get(id: string): Promise<Review | null>;
  insert(input: ReviewInsert): Promise<Review>;
  setHidden(id: string, hiddenAt: string | null, reason: string | null): Promise<Review>;
}

/** What the reviewer's email and order number are checked against. */
export interface PurchaseCheck {
  findCustomerByEmail(email: string): Promise<{ id: string; full_name: string | null } | null>;
  /** A paid order of this product, by its number, for this customer. */
  findPaidOrder(customerId: string, productId: string, orderNumber: number): Promise<{ id: string } | null>;
}
