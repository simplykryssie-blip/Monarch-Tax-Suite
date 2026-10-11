import { test } from "node:test";
import assert from "node:assert/strict";
import { cumulativeByMonth, emptyMonths, niceTicks, ordersByMonth, revenueByMonth } from "../lib/dashboard-metrics.ts";
import { INTERNAL_ORDER_MARKER } from "../lib/commerce/fulfillment.ts";
import type { Order } from "../lib/commerce/types.ts";

const NOW = new Date(Date.UTC(2026, 9, 11));
const order = (over: Partial<Order>): Order => ({
  id: "o", order_number: 1, order_type: "purchase", customer_id: "c", product_id: "p", amount_cents: 7500, amount_refunded_cents: 0, currency: "usd", payment_status: "paid", provider: "stripe",
  provider_payment_intent_id: "pi_1", provider_checkout_session_id: null, installation_type: null, license_id: null, tax_year: null, previous_tax_year: null, verification_method: "stripe_webhook",
  verified_by: null, verified_at: "2026-10-01T00:00:00Z", notes: null, paid_at: "2026-10-05T00:00:00Z", refunded_at: null, created_at: "2026-10-05T00:00:00Z", updated_at: "2026-10-05T00:00:00Z", ...over,
} as Order);

test("twelve months, oldest first, ending in the current month", () => {
  const m = emptyMonths(NOW);
  assert.equal(m.length, 12);
  assert.equal(m[0].key, "2025-11");
  assert.equal(m[11].key, "2026-10");
});

test("revenue is net of refunds, per month, and ignores unpaid and internal orders", () => {
  const orders = [
    order({ id: "a" }),
    order({ id: "b", payment_status: "partially_refunded", amount_refunded_cents: 2500, paid_at: "2026-09-02T00:00:00Z" }),
    order({ id: "c", payment_status: "pending", paid_at: null }),
    order({ id: "d", amount_cents: 0, provider_payment_intent_id: null, verification_method: "admin_manual", notes: `${INTERNAL_ORDER_MARKER} test` }),
  ];
  const s = revenueByMonth(orders, NOW);
  assert.equal(s[11].value, 7500);
  assert.equal(s[10].value, 5000);
  assert.equal(s.reduce((n, p) => n + p.value, 0), 12500);
  assert.equal(ordersByMonth(orders, NOW)[11].value, 1);
});

test("cumulative growth counts earlier records and never decreases", () => {
  const s = cumulativeByMonth([{ created_at: "2024-01-01T00:00:00Z" }, { created_at: "2026-03-10T00:00:00Z" }, { created_at: "2026-10-02T00:00:00Z" }], NOW);
  assert.equal(s[0].value, 1);
  assert.equal(s[11].value, 3);
  assert.ok(s.every((p, i) => i === 0 || p.value >= s[i - 1].value));
});

test("axis ticks are round numbers and integer-only for counts", () => {
  assert.deepEqual(niceTicks(0), [0, 1]);
  assert.ok(niceTicks(7500).every((t) => t % 500 === 0));
  assert.ok(niceTicks(1, 3, true).every((t) => Number.isInteger(t)));
});
