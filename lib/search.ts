import type { Customer, Installation, License, Order, Product } from "./commerce/types.ts";

// Global admin search over records the app already holds. Pure so it can be tested; the server action feeds it
// freshly loaded records after checking the caller is an administrator.

export type SearchHit = { id: string; group: "Customers" | "Orders" | "Licenses" | "Products" | "Installations" | "Pages"; title: string; detail: string; href: string };
export type SearchData = { customers: Customer[]; orders: Order[]; licenses: License[]; products: Product[]; installations: Installation[] };

export const PAGES: SearchHit[] = [
  { id: "p-home", group: "Pages", title: "Home", detail: "My Office", href: "/" },
  { id: "p-dash", group: "Pages", title: "Store dashboard", detail: "My Store", href: "/store" },
  { id: "p-cust", group: "Pages", title: "Customers", detail: "My Store", href: "/customers" },
  { id: "p-ord", group: "Pages", title: "Orders", detail: "My Store", href: "/orders" },
  { id: "p-prod", group: "Pages", title: "Products", detail: "My Store", href: "/products" },
  { id: "p-lic", group: "Pages", title: "Licenses", detail: "My Store", href: "/licenses" },
  { id: "p-inst", group: "Pages", title: "Installations", detail: "My Store", href: "/installations" },
  { id: "p-efin", group: "Pages", title: "EROs & EFINs", detail: "EFIN Management", href: "/efin" },
  { id: "p-efin-new", group: "Pages", title: "Add an ERO", detail: "EFIN Management", href: "/efin/new" },
  { id: "p-efin-ren", group: "Pages", title: "EFIN renewals & compliance", detail: "EFIN Management", href: "/efin/renewals" },
  { id: "p-efin-his", group: "Pages", title: "EFIN history", detail: "EFIN Management", href: "/efin/history" },
  { id: "p-auto", group: "Pages", title: "Automation", detail: "Operations", href: "/automation" },
  { id: "p-wf", group: "Pages", title: "Workflows", detail: "Automation", href: "/automation/workflows" },
  { id: "p-tpl", group: "Pages", title: "Email templates", detail: "Automation", href: "/automation/templates" },
  { id: "p-act", group: "Pages", title: "Automation activity", detail: "Automation", href: "/automation/activity" },
  { id: "p-newlic", group: "Pages", title: "Create a license", detail: "Action", href: "/orders/internal" },
  { id: "p-rec", group: "Pages", title: "Reconcile a payment", detail: "Action", href: "/orders/reconcile" },
];

const norm = (v: string | null | undefined) => (v ?? "").toLowerCase();
/** Every whitespace-separated term must appear somewhere in the haystack. */
const matches = (hay: string, terms: string[]) => terms.every((t) => hay.includes(t));

export function searchRecords(data: SearchData, query: string, limitPerGroup = 4): SearchHit[] {
  const terms = norm(query).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const customer = new Map(data.customers.map((c) => [c.id, c]));
  const product = new Map(data.products.map((p) => [p.id, p]));
  const who = (id: string) => customer.get(id)?.full_name ?? customer.get(id)?.email ?? "Customer";
  const out: SearchHit[] = [];
  const add = (hits: SearchHit[]) => out.push(...hits.slice(0, limitPerGroup));

  add(data.customers.filter((c) => matches(norm(`${c.full_name} ${c.email}`), terms)).map((c) => ({ id: `c:${c.id}`, group: "Customers" as const, title: c.full_name ?? c.email, detail: c.email, href: `/customers/${c.id}` })));
  add(data.orders.filter((o) => matches(norm(`${o.order_number} ${who(o.customer_id)} ${customer.get(o.customer_id)?.email} ${product.get(o.product_id)?.name}`), terms)).map((o) => ({ id: `o:${o.id}`, group: "Orders" as const, title: `Order #${o.order_number}`, detail: `${who(o.customer_id)} · ${product.get(o.product_id)?.name ?? ""}`, href: `/orders` })));
  add(data.licenses.filter((l) => matches(norm(`${l.key_prefix} ${who(l.customer_id)} ${customer.get(l.customer_id)?.email} ${l.status}`), terms)).map((l) => ({ id: `l:${l.id}`, group: "Licenses" as const, title: l.key_prefix ? `${l.key_prefix}…` : "License (no key yet)", detail: `${who(l.customer_id)} · ${l.status}`, href: `/licenses/${l.id}` })));
  add(data.products.filter((p) => matches(norm(`${p.name} ${p.slug}`), terms)).map((p) => ({ id: `p:${p.id}`, group: "Products" as const, title: p.name, detail: p.status, href: `/products/${p.id}` })));
  add(data.installations.filter((i) => matches(norm(`${who(i.customer_id)} ${customer.get(i.customer_id)?.email} ${i.target_location} ${i.platform}`), terms)).map((i) => ({ id: `i:${i.id}`, group: "Installations" as const, title: who(i.customer_id), detail: `${i.platform} · ${i.status}`, href: `/installations/${i.id}` })));
  const pages = PAGES.filter((p) => matches(norm(`${p.title} ${p.detail}`), terms));
  return [...out, ...pages.slice(0, 5)];
}
