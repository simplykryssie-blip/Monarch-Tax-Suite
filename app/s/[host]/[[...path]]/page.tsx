import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Blocks, SiteFrame } from "@/components/sites/render";
import { buildView, loadPublicSite, requestSiteHost } from "@/lib/sites/public";
import { cleanPageSeo, pageDescriptionFor, pageIsIndexed, pageTitleFor, settingsOf } from "@/lib/sites/settings.ts";
import { tenantClient } from "@/lib/supabase/service";

// A published website page. The proxy rewrites every request on an office's address here; the page shows only what
// the office published (never a draft), and nothing at all on an address no office uses.

type Params = { params: Promise<{ host: string; path?: string[] }> };

async function resolve({ params }: Params) {
  const { host: rawHost, path } = await params;
  const host = await requestSiteHost(rawHost);
  if (!host || (path?.length ?? 0) > 1) return null;
  const ps = await loadPublicSite(host);
  if (!ps || ps.site.status !== "published") return { ps, page: null as null };
  const slug = path?.[0]?.toLowerCase() ?? "";
  const page = ps.pages.find((p) => p.slug === slug && p.published !== null) ?? null;
  return { ps, page };
}

export async function generateMetadata(input: Params): Promise<Metadata> {
  const r = await resolve(input).catch(() => null);
  if (!r?.ps || !r.page) return { title: "Website", robots: { index: false, follow: false } };
  const settings = settingsOf(r.ps.site.published_settings ?? r.ps.site.settings ?? {});
  const seo = cleanPageSeo(r.page.published_seo ?? {});
  const indexed = pageIsIndexed(settings, seo);
  const imageId = seo.shareImageId ?? settings.seo.shareImageId;
  let share: string | undefined;
  if (imageId) {
    const { data } = await tenantClient(r.ps.tenantId).from("tenant_images").select("storage_path").eq("id", imageId).maybeSingle();
    if (data?.storage_path) share = `/media/${r.ps.tenantId}/${data.storage_path as string}`;
  }
  const title = pageTitleFor({ siteName: r.ps.site.name, settings, pageTitle: r.page.published_title ?? r.page.title, seo, isHome: r.page.is_home });
  const description = pageDescriptionFor({ description: r.page.published_description, settings });
  const faviconId = settings.brand.faviconImageId;
  let icon: string | undefined;
  if (faviconId) {
    const { data } = await tenantClient(r.ps.tenantId).from("tenant_images").select("storage_path").eq("id", faviconId).maybeSingle();
    if (data?.storage_path) icon = `/media/${r.ps.tenantId}/${data.storage_path as string}`;
  }
  return {
    title,
    description,
    alternates: { canonical: `https://${r.ps.domain.hostname}${r.page.is_home ? "/" : `/${r.page.slug}`}` },
    robots: { index: indexed, follow: indexed },
    openGraph: { title, description, type: "website", ...(share ? { images: [share] } : {}) },
    ...(icon ? { icons: { icon } } : {}),
  };
}

export default async function SitePage(input: Params) {
  const r = await resolve(input);
  if (!r) notFound();
  const { ps, page } = r!;
  if (!ps) notFound();
  if (!page) {
    // A site that isn't published yet (or a page that doesn't exist) shows a plain notice, never a draft.
    notFound();
  }
  const blocks = page!.published ?? [];
  const view = { ...(await buildView(ps!, blocks)), base: (await headers()).get("x-site-base") ?? "" };
  return (
    <SiteFrame view={view} currentPath={page!.is_home ? "/" : `/${page!.slug}`}>
      <Blocks blocks={blocks} view={view} />
    </SiteFrame>
  );
}
