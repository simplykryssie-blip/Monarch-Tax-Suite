"use server";

import { commerceRepo, requireAdmin } from "@/lib/admin";
import { PAGES, searchRecords, type SearchHit } from "@/lib/search.ts";

/** Global search. Administrator-only; reads only what the admin screens already show. */
export async function searchAction(query: string): Promise<SearchHit[]> {
  await requireAdmin();
  const q = String(query ?? "").slice(0, 80).trim();
  if (!q) return PAGES.slice(0, 8);
  try {
    const repo = commerceRepo();
    const [customers, orders, licenses, products, installations] = await Promise.all([repo.listCustomers(), repo.listOrders(), repo.listLicenses(), repo.listProducts(), repo.listInstallations()]);
    return searchRecords({ customers, orders, licenses, products, installations }, q);
  } catch {
    return searchRecords({ customers: [], orders: [], licenses: [], products: [], installations: [] }, q);
  }
}
