import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Blocks, SiteFrame } from "@/components/sites/render";
import { buildView, loadPublicSite, requestSiteHost } from "@/lib/sites/public";

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
  const view = await buildView(r.ps, null);
  return {
    title: r.page.is_home ? view.name : `${r.page.published_title ?? r.page.title} | ${view.name}`,
    description: r.page.published_description ?? undefined,
    robots: { index: true, follow: true },
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
