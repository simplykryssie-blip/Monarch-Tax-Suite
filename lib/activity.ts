import { isInternalOrder } from "./commerce/fulfillment.ts";
import type { Customer, Installation, Order, Product } from "./commerce/types.ts";

// A merged "recent activity" feed built only from recorded events: sign-ups, payments, installation requests
// and automation runs. Nothing is invented; an empty system gives an empty feed.

export type ActivityKind = "customer" | "order" | "installation" | "email" | "alert";
export type ActivityItem = { id: string; at: string; kind: ActivityKind; title: string; detail: string };

export function ago(iso: string, now: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
}

export function buildActivity(
  data: { customers: Customer[]; orders: Order[]; products: Product[]; installations: Installation[] },
  automation: ActivityItem[],
  limit = 7,
): ActivityItem[] {
  const customer = new Map(data.customers.map((c) => [c.id, c]));
  const product = new Map(data.products.map((p) => [p.id, p]));
  const name = (id: string) => customer.get(id)?.full_name ?? customer.get(id)?.email ?? "A customer";
  const items: ActivityItem[] = [];
  for (const c of data.customers) items.push({ id: `c:${c.id}`, at: c.created_at, kind: "customer", title: "New customer", detail: c.full_name ?? c.email });
  for (const o of data.orders) {
    if (o.payment_status === "pending" || isInternalOrder(o)) continue;
    items.push({ id: `o:${o.id}`, at: o.paid_at ?? o.created_at, kind: "order", title: o.payment_status === "paid" ? "Payment received" : "Order updated", detail: `${name(o.customer_id)} · ${product.get(o.product_id)?.name ?? "Order"}` });
  }
  for (const i of data.installations) items.push({ id: `i:${i.id}`, at: i.created_at, kind: "installation", title: "Installation requested", detail: name(i.customer_id) });
  return [...items, ...automation].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
