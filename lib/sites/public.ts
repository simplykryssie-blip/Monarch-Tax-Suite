import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { loadBrand } from "../branding/server";
import { SupabaseDocumentsRepo } from "../documents/supabase-repo.ts";
import { tenantClient } from "../supabase/service";
import { imageIdsOf, type Block } from "./blocks.ts";
import { cleanRequestHost } from "./host.ts";
import { siteForHost, type PublicSite } from "./server";
import type { SiteView } from "@/components/sites/render";

// Everything the public renderer needs for one request, loaded once. The hostname must be the one the proxy decided is a
// site's (it sets x-site-host); the /s/<host> route cannot be reached directly on the application's own address.

const HEX = /^#[0-9a-f]{6}$/i;

export const requestSiteHost = cache(async (param: string): Promise<string | null> => {
  const wanted = cleanRequestHost(decodeURIComponent(param));
  const given = cleanRequestHost((await headers()).get("x-site-host"));
  return wanted && given && wanted === given ? wanted : null;
});

export const loadPublicSite = cache(async (host: string): Promise<PublicSite | null> => siteForHost(host));

export type RenderedSite = { view: SiteView; published: boolean };

export async function buildView(ps: PublicSite, blocks: Block[] | null): Promise<SiteView> {
  const db = tenantClient(ps.tenantId);
  const [brand, profile] = await Promise.all([loadBrand(ps.tenantId).catch(() => null), new SupabaseDocumentsRepo(db).getProfile().catch(() => null)]);
  const ids = blocks ? imageIdsOf(blocks) : [];
  const images: SiteView["images"] = {};
  if (ids.length) {
    const { data } = await db.from("tenant_images").select("id, storage_path, width, height").in("id", ids);
    for (const row of (data ?? []) as { id: string; storage_path: string; width: number | null; height: number | null }[]) {
      images[row.id] = { url: `/media/${ps.tenantId}/${row.storage_path}`, width: row.width, height: row.height };
    }
  }
  const nav = ps.pages.filter((p) => p.published !== null && p.show_in_nav).sort((a, b) => a.position - b.position).map((p) => ({ href: p.is_home ? "/" : `/${p.slug}`, label: p.published_title ?? p.title }));
  return {
    name: brand?.name || profile?.display_name || ps.site.name,
    primary: brand && HEX.test(brand.primary) ? brand.primary : "#2563eb",
    accent: brand && HEX.test(brand.accent) ? brand.accent : "#171714",
    logoUrl: brand?.logoUrl ?? null,
    nav,
    contact: { phone: profile?.phone ?? null, email: profile?.email ?? null, address: profile?.address ?? null },
    images,
  };
}
