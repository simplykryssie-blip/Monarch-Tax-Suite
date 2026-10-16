import "server-only";
import { headers } from "next/headers";
import { hostFromHeaders } from "../brands.ts";
import { documentDeps } from "../documents/server";
import { platformClient, tenantClient } from "../supabase/service";
import { currentTenantId } from "../tenants.ts";
import { brandOf, type Brand, type TenantBrandRow } from "./brand.ts";
import { SupabaseBrandRepo } from "./supabase-repo.ts";

export const brandRepo = (tenantId: string = currentTenantId()) => new SupabaseBrandRepo(tenantClient(tenantId), tenantId);

/** The brand for a tenant. Never throws: before the migration, or on any error, it falls back to the firm name. */
export async function loadBrand(tenantId: string = currentTenantId()): Promise<Brand> {
  const [row, profile] = await Promise.all([brandRepo(tenantId).get().catch(() => null), documentDeps(tenantId).repo.getProfile().catch(() => null)]);
  return brandOf(row, profile?.display_name);
}

/**
 * The brand for the address a visitor came in on, for the sign-in page (nobody is signed in yet, so this is the one
 * logged platform lookup: it reads only the public brand fields of the tenant that registered that address).
 */
export async function brandForRequestHost(): Promise<Brand | null> {
  const host = hostFromHeaders(await headers())?.replace(/:\d+$/, "");
  if (!host) return null;
  const { data } = await platformClient("brand_host").from("tenant_brands").select("*").eq("app_host", host).maybeSingle();
  return data ? brandOf(data as TenantBrandRow) : null;
}
