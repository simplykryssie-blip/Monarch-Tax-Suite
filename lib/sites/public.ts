import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { loadBrand } from "../branding/server";
import { SupabaseDocumentsRepo } from "../documents/supabase-repo.ts";
import { tenantClient } from "../supabase/service";
import { imageIdsOf, type Block } from "./blocks.ts";
import { cleanRequestHost } from "./host.ts";
import { FONT_CHOICES, googleFontsHref, settingsOf, SOCIALS, type SiteSettings } from "./settings.ts";
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

/** The public view always uses the published copy of the settings, never the draft. */
export const buildView = (ps: PublicSite, blocks: Block[] | null): Promise<SiteView> => viewFor(ps.tenantId, ps.site.name, ps.pages, blocks, settingsOf(ps.site.published_settings ?? ps.site.settings ?? {}));

const SOCIAL_LABEL: Record<(typeof SOCIALS)[number], string> = { facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", youtube: "YouTube", x: "X", tiktok: "TikTok" };

/** The look of a site for the blocks about to be shown: brand, menu (published pages only), contact details, pictures. */
export async function viewFor(tenantId: string, siteName: string, pages: PublicSite["pages"], blocks: Block[] | null, settings: SiteSettings = settingsOf({})): Promise<SiteView> {
  const db = tenantClient(tenantId);
  const [brand, profile] = await Promise.all([loadBrand(tenantId).catch(() => null), new SupabaseDocumentsRepo(db).getProfile().catch(() => null)]);
  const ids = [...(blocks ? imageIdsOf(blocks) : []), ...(settings.brand.logoImageId ? [settings.brand.logoImageId] : [])];
  const images: SiteView["images"] = {};
  if (ids.length) {
    const { data } = await db.from("tenant_images").select("id, storage_path, width, height").in("id", ids);
    for (const row of (data ?? []) as { id: string; storage_path: string; width: number | null; height: number | null }[]) {
      images[row.id] = { url: `/media/${tenantId}/${row.storage_path}`, width: row.width, height: row.height };
    }
  }
  const nav = pages.filter((p) => p.published !== null && p.show_in_nav).sort((a, b) => a.position - b.position).map((p) => ({ href: p.is_home ? "/" : `/${p.slug}`, label: p.published_title ?? p.title }));
  const pick = (own: string | null, theirs: string | undefined, fallback: string) => (own && HEX.test(own) ? own : theirs && HEX.test(theirs) ? theirs : fallback);
  const logo = settings.brand.logoImageId ? images[settings.brand.logoImageId]?.url ?? null : null;
  return {
    name: siteName || brand?.name || profile?.display_name || "",
    primary: pick(settings.brand.primary, brand?.primary, "#2563eb"),
    pageBg: settings.brand.pageBg,
    accent: pick(settings.brand.accent, brand?.accent, "#171714"),
    logoUrl: logo ?? brand?.logoUrl ?? null,
    nav,
    contact: { phone: settings.contact.phone || profile?.phone || null, email: settings.contact.email || profile?.email || null, address: settings.contact.address || profile?.address || null },
    images,
    look: {
      fontsHref: googleFontsHref(settings.fonts), headingFont: FONT_CHOICES[settings.fonts.heading].stack, bodyFont: FONT_CHOICES[settings.fonts.body].stack,
      header: settings.header, footer: settings.footer, hours: settings.hours,
      social: SOCIALS.flatMap((k) => (settings.social[k] ? [{ label: SOCIAL_LABEL[k], href: settings.social[k]! }] : [])),
    },
  };
}
