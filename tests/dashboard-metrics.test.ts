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

import { ago, buildActivity } from "../lib/activity.ts";

test("activity feed merges real events newest first, skips internal and pending orders, and is empty when nothing happened", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  assert.deepEqual(buildActivity({ customers: [], orders: [], products: [], installations: [] }, []), []);
  const feed = buildActivity(
    { customers: [{ id: "c", email: "a@b.co", full_name: "Ann", created_at: "2026-10-10T00:00:00Z" } as never], orders: [order({ payment_status: "pending" }), order({ customer_id: "c", paid_at: "2026-10-11T10:00:00Z" })], products: [], installations: [] },
    [{ id: "x", at: "2026-10-11T11:00:00Z", kind: "email", title: "Automation ran", detail: "W" }],
  );
  assert.deepEqual(feed.map((f) => f.kind), ["email", "order", "customer"]);
  assert.equal(ago("2026-10-11T11:00:00Z", now), "1 hour ago");
  assert.equal(ago("2026-10-11T11:59:50Z", now), "just now");
});

import { searchRecords } from "../lib/search.ts";

test("search matches every term across names, emails, order numbers and pages, and returns nothing for blank input", () => {
  const data = {
    customers: [{ id: "c1", email: "danica_mckethan@hotmail.com", full_name: "Danica Mckethan" } as never],
    orders: [order({ id: "o1", order_number: 1004, customer_id: "c1", product_id: "p1" })],
    licenses: [{ id: "l1", customer_id: "c1", key_prefix: "MTS-GH6H3", status: "active" } as never],
    products: [{ id: "p1", name: "Monarch Basic Tax Calculator", slug: "monarch-basic", status: "published" } as never],
    installations: [],
  };
  assert.deepEqual(searchRecords(data, "   "), []);
  assert.equal(searchRecords(data, "danica hotmail").filter((h) => h.group === "Customers").length, 1);
  assert.ok(searchRecords(data, "1004").some((h) => h.group === "Orders"));
  assert.ok(searchRecords(data, "GH6H3").some((h) => h.href === "/licenses/l1"));
  assert.ok(searchRecords(data, "calculator").some((h) => h.group === "Products"));
  assert.ok(searchRecords(data, "automation").some((h) => h.group === "Pages"));
  assert.equal(searchRecords(data, "zzzz nothing").length, 0);
});

import { change, growthOverMonth, monthOverMonth } from "../lib/dashboard-metrics.ts";

test("period-over-period change handles zero, growth and decline", () => {
  assert.deepEqual(change(0, 0), { kind: "none", pct: 0 });
  assert.deepEqual(change(5, 0), { kind: "new", pct: 0 });
  assert.deepEqual(change(150, 100), { kind: "up", pct: 50 });
  assert.deepEqual(change(50, 100), { kind: "down", pct: 50 });
  assert.deepEqual(change(100, 100), { kind: "flat", pct: 0 });
  const pts = (...v: number[]) => v.map((value, i) => ({ key: String(i), label: String(i), value }));
  assert.equal(monthOverMonth(pts(0, 100, 200)).pct, 100);
  assert.equal(growthOverMonth(pts(1, 3, 6)).pct, 50);
});
