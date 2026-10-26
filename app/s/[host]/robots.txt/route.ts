import { loadPublicSite, requestSiteHost } from "@/lib/sites/public";
import { settingsOf } from "@/lib/sites/settings.ts";

export async function GET(_req: Request, { params }: { params: Promise<{ host: string }> }) {
  const host = await requestSiteHost((await params).host);
  const ps = host ? await loadPublicSite(host).catch(() => null) : null;
  const live = ps?.site.status === "published" && !settingsOf(ps.site.published_settings ?? ps.site.settings ?? {}).seo.noindex;
  const body = live ? `User-agent: *\nAllow: /\nSitemap: https://${ps?.primaryHost ?? host}/sitemap.xml\n` : "User-agent: *\nDisallow: /\n";
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" } });
}
