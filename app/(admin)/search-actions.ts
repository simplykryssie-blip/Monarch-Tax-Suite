"use server";

import { commerceRepo, requireAdmin } from "@/lib/admin";
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
  if (!allows(tier, "store")) return searchRecords({ customers: [], orders: [], licenses: [], products: [], installations: [] }, q, 4, pages);
  try {
    const repo = commerceRepo();
    const [customers, orders, licenses, products, installations] = await Promise.all([repo.listCustomers(), repo.listOrders(), repo.listLicenses(), repo.listProducts(), repo.listInstallations()]);
    return searchRecords({ customers, orders, licenses, products, installations }, q, 4, pages);
  } catch {
    return searchRecords({ customers: [], orders: [], licenses: [], products: [], installations: [] }, q, 4, pages);
  }
}
