import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { defaultName, hideReview, NOT_VERIFIED, postReview, summarize } from "../lib/reviews/service.ts";
import type { PurchaseCheck, Review, ReviewInsert, ReviewsRepo } from "../lib/reviews/types.ts";

// Product reviews: verified purchasers only, live at once, one per customer per product, hideable. Fake people only.

class Memory implements ReviewsRepo, PurchaseCheck {
  rows: Review[] = [];
  customers = new Map<string, { id: string; full_name: string | null }>();
  orders: { id: string; customer_id: string; product_id: string; number: number; status: string }[] = [];
  async listForProduct(productId: string, includeHidden: boolean) { return structuredClone(this.rows.filter((r) => r.product_id === productId && (includeHidden || !r.hidden_at))); }
  async ratingsByProduct() { return new Map<string, number[]>(); }
  async findByCustomer(productId: string, customerId: string) { return structuredClone(this.rows.find((r) => r.product_id === productId && r.customer_id === customerId) ?? null); }
  async get(id: string) { return structuredClone(this.rows.find((r) => r.id === id) ?? null); }
  async insert(input: ReviewInsert) {
    if (this.rows.some((r) => r.product_id === input.product_id && r.customer_id === input.customer_id)) throw new Error('duplicate key value violates unique constraint "product_reviews_one_per_customer"');
    const r: Review = { ...input, id: randomUUID(), tenant_id: "t", hidden_at: null, hidden_reason: null, created_at: "2026-10-15T12:00:00Z" };
    this.rows.push(r); return structuredClone(r);
  }
  async setHidden(id: string, hiddenAt: string | null, reason: string | null) { const r = this.rows.find((x) => x.id === id)!; r.hidden_at = hiddenAt; r.hidden_reason = reason; return structuredClone(r); }
  async findCustomerByEmail(email: string) { return this.customers.get(email) ?? null; }
  async findPaidOrder(customerId: string, productId: string, n: number) { const o = this.orders.find((x) => x.customer_id === customerId && x.product_id === productId && x.number === n && x.status === "paid"); return o ? { id: o.id } : null; }
}

const P1 = "p1";
const setup = () => {
  const m = new Memory();
  m.customers.set("casey@example.com", { id: "c1", full_name: "Casey Client" });
  m.customers.set("dana@example.com", { id: "c2", full_name: null });
  m.orders.push({ id: "o1", customer_id: "c1", product_id: P1, number: 1042, status: "paid" }, { id: "o2", customer_id: "c1", product_id: "p2", number: 1043, status: "paid" }, { id: "o3", customer_id: "c2", product_id: P1, number: 1044, status: "refunded" });
  return m;
};
const good = { email: "Casey@Example.com", orderNumber: "#1042", rating: "5", body: "Worked great for our office." };

describe("product reviews", () => {
  test("a verified buyer posts a review that is live at once, shown as first name and last initial", async () => {
    const m = setup();
    const r = await postReview(m, m, P1, good);
    assert.deepEqual([r.rating, r.display_name, r.hidden_at], [5, "Casey C.", null]);
    assert.equal((await m.listForProduct(P1, false)).length, 1);
  });

  test("the email and order number must match a paid order for this product; every failure says the same thing", async () => {
    const m = setup();
    for (const bad of [
      { ...good, email: "nobody@example.com" },
      { ...good, orderNumber: "9999" },
      { ...good, orderNumber: "1043" }, // a paid order, but for another product
      { ...good, email: "dana@example.com", orderNumber: "1044" }, // refunded
      { ...good, email: "not an email" },
      { ...good, orderNumber: "abc" },
    ]) await assert.rejects(postReview(m, m, P1, bad), (e: Error) => e.message === NOT_VERIFIED);
    assert.equal(m.rows.length, 0);
  });

  test("rating and text are checked; one review per customer per product", async () => {
    const m = setup();
    await assert.rejects(postReview(m, m, P1, { ...good, rating: "0" }), /star rating/);
    await assert.rejects(postReview(m, m, P1, { ...good, rating: "six" }), /star rating/);
    await assert.rejects(postReview(m, m, P1, { ...good, body: "short" }), /at least 10/);
    await assert.rejects(postReview(m, m, P1, { ...good, body: "x".repeat(2001) }), /up to 2000/);
    await postReview(m, m, P1, good);
    await assert.rejects(postReview(m, m, P1, good), /already reviewed/);
  });

  test("the name can be chosen; markup is just text; control characters are removed", async () => {
    const m = setup();
    const r = await postReview(m, m, P1, { ...good, displayName: "  Casey's  Tax  Co ", body: "<script>alert(1)</script> great\u0000 stuff" });
    assert.equal(r.display_name, "Casey's Tax Co");
    assert.equal(r.body, "<script>alert(1)</script> great  stuff");
    assert.equal(defaultName(null), "Verified buyer");
    assert.equal(defaultName("Prince"), "Prince");
    assert.equal(defaultName("Mary Ann van der Berg"), "Mary B.");
  });

  test("an administrator can hide a review (kept, with the reason) and show it again; hidden reviews don't count", async () => {
    const m = setup();
    const r = await postReview(m, m, P1, good);
    await hideReview(m, r.id, true, "Off topic", new Date("2026-10-16T00:00:00Z"));
    assert.equal((await m.listForProduct(P1, false)).length, 0);
    const kept = (await m.listForProduct(P1, true))[0];
    assert.deepEqual([kept.hidden_reason, kept.hidden_at], ["Off topic", "2026-10-16T00:00:00.000Z"]);
    assert.equal(summarize(await m.listForProduct(P1, true)).count, 0);
    await hideReview(m, r.id, false, "");
    assert.equal(summarize(await m.listForProduct(P1, false)).count, 1);
    await assert.rejects(hideReview(m, "missing", true, ""), /wasn't found/);
  });

  test("the summary has the average to one decimal and a count per star", () => {
    const s = summarize([{ rating: 5, hidden_at: null }, { rating: 4, hidden_at: null }, { rating: 4, hidden_at: null }, { rating: 1, hidden_at: "2026-10-01" }]);
    assert.deepEqual([s.count, s.average, s.stars[5], s.stars[4], s.stars[1]], [3, 4.3, 1, 2, 0]);
    assert.deepEqual(summarize([]), { count: 0, average: 0, stars: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
  });
});
