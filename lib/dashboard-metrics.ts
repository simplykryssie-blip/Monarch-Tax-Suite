import { isInternalOrder } from "./commerce/fulfillment.ts";
import type { Order } from "./commerce/types.ts";

// Pure chart data for the admin dashboard. Every number comes from recorded orders, customers and licenses.

export type SeriesPoint = { key: string; label: string; value: number };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/** The last `count` calendar months ending at `now`, oldest first, each with a zero value. */
export function emptyMonths(now: Date, count = 12): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push({ key: monthKey(d), label: `${MONTHS[d.getUTCMonth()]}${d.getUTCMonth() === 0 || i === count - 1 ? ` '${String(d.getUTCFullYear()).slice(2)}` : ""}`, value: 0 });
  }
  return out;
}

const settled = (o: Order) => o.payment_status === "paid" || o.payment_status === "partially_refunded" || o.payment_status === "refunded";
const when = (o: Order) => new Date(o.paid_at ?? o.created_at);

/** Net revenue per month (cents, one currency) from settled sales. Internal $0 licenses add nothing. */
export function revenueByMonth(orders: Order[], now: Date, currency = "usd", count = 12): SeriesPoint[] {
  const series = emptyMonths(now, count);
  const at = new Map(series.map((p) => [p.key, p]));
  for (const o of orders) {
    if (!settled(o) || o.currency !== currency || isInternalOrder(o)) continue;
    const p = at.get(monthKey(when(o)));
    if (p) p.value += o.amount_cents - o.amount_refunded_cents;
  }
  return series;
}

/** Sales (not internal licenses) per month. */
export function ordersByMonth(orders: Order[], now: Date, count = 12): SeriesPoint[] {
  const series = emptyMonths(now, count);
  const at = new Map(series.map((p) => [p.key, p]));
  for (const o of orders) {
    if (!(o.payment_status === "paid" || o.payment_status === "partially_refunded") || isInternalOrder(o)) continue;
    const p = at.get(monthKey(when(o)));
    if (p) p.value += 1;
  }
  return series;
}

/** Running total of records created by each month end, for a "growth" sparkline. */
export function cumulativeByMonth(items: { created_at: string }[], now: Date, count = 12): SeriesPoint[] {
  const series = emptyMonths(now, count);
  let before = 0;
  const first = series[0].key;
  for (const it of items) if (monthKey(new Date(it.created_at)) < first) before++;
  const at = new Map(series.map((p) => [p.key, p]));
  for (const it of items) {
    const p = at.get(monthKey(new Date(it.created_at)));
    if (p) p.value += 1;
  }
  let run = before;
  for (const p of series) {
    run += p.value;
    p.value = run;
  }
  return series;
}

export function countBy<T>(items: T[], pick: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) out[pick(it)] = (out[pick(it)] ?? 0) + 1;
  return out;
}

/** Round-number axis ticks from 0 to just above max. */
export function niceTicks(max: number, target = 4, integer = false): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? pow * 10;
  if (integer) step = Math.max(1, Math.ceil(step));
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.999; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

export type Change = { kind: "up" | "down" | "flat" | "new" | "none"; pct: number };

/** This period against the one before it. "new" means there was nothing before; "none" means nothing in either. */
export function change(current: number, previous: number): Change {
  if (current === 0 && previous === 0) return { kind: "none", pct: 0 };
  if (previous === 0) return { kind: "new", pct: 0 };
  const pct = Math.round(((current - previous) / previous) * 100);
  return { kind: pct > 0 ? "up" : pct < 0 ? "down" : "flat", pct: Math.abs(pct) };
}

/** Month-over-month change of a per-month series (last point against the one before it). */
export function monthOverMonth(series: SeriesPoint[]): Change {
  const n = series.length;
  return change(series[n - 1]?.value ?? 0, series[n - 2]?.value ?? 0);
}

/** Records added this month against last month, from a cumulative series. */
export function growthOverMonth(cumulative: SeriesPoint[]): Change {
  const n = cumulative.length;
  const v = (i: number) => cumulative[i]?.value ?? 0;
  return change(v(n - 1) - v(n - 2), v(n - 2) - v(n - 3));
}
