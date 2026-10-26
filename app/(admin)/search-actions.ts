"use server";

import { commerceRepo, requireAdmin } from "@/lib/admin";
import { leadsDeps } from "@/lib/leads/server";
import { workspaceRepo } from "@/lib/workspace/server";
import { PAGES, searchRecords, type SearchHit } from "@/lib/search.ts";
import { currentTier } from "@/lib/tier-server";
import { allows, sectionOf } from "@/lib/tier.ts";

/** Global search. Administrator-only; reads only what the admin screens already show. */
export async function searchAction(query: string): Promise<SearchHit[]> {
  await requireAdmin();
  const q = String(query ?? "").slice(0, 80).trim();
  const tier = await currentTier();
  // Only pages this tier has; customers, orders and the rest belong to the store.
  const pages = PAGES.filter((p) => { const section = sectionOf(p.href); return !section || allows(tier, section); });
  if (!q) return pages.slice(0, 8);
  // Clients and leads come first on every plan: the people the office works with.
  const people = await findPeople(q);
  if (!allows(tier, "store")) return [...people, ...searchRecords({ customers: [], orders: [], licenses: [], products: [], installations: [] }, q, 4, pages)];
  try {
    const repo = commerceRepo();
    const [customers, orders, licenses, products, installations] = await Promise.all([repo.listCustomers(), repo.listOrders(), repo.listLicenses(), repo.listProducts(), repo.listInstallations()]);
    return [...people, ...searchRecords({ customers, orders, licenses, products, installations }, q, 4, pages)];
  } catch {
    return [...people, ...searchRecords({ customers: [], orders: [], licenses: [], products: [], installations: [] }, q, 4, pages)];
  }
}

/** Clients and leads whose name, email or phone match. */
async function findPeople(q: string): Promise<SearchHit[]> {
  const [clients, leads] = await Promise.all([
    workspaceRepo().listClients({ q, includeArchived: false }).catch(() => []),
    leadsDeps().repo.listLeads({ q, limit: 6 }).catch(() => []),
  ]);
  const detail = (email: string | null, phone: string | null) => [email, phone].filter(Boolean).join(" · ") || "No email";
  return [
    ...clients.slice(0, 6).map((c) => ({ id: `client:${c.id}`, group: "Contacts" as const, title: c.full_name, detail: `Client · ${detail(c.email, c.phone)}`, href: `/workspace/clients/${c.id}` })),
    ...leads.map((l) => ({ id: `lead:${l.id}`, group: "Contacts" as const, title: l.full_name, detail: `Lead · ${detail(l.email, l.phone)}`, href: `/contacts/lead-${l.id}` })),
  ];
}
