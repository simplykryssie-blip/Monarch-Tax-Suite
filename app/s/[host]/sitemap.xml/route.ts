import { loadPublicSite, requestSiteHost } from "@/lib/sites/public";
import { cleanPageSeo, settingsOf } from "@/lib/sites/settings.ts";

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

export async function GET(_req: Request, { params }: { params: Promise<{ host: string }> }) {
  const host = await requestSiteHost((await params).host);
  const ps = host ? await loadPublicSite(host).catch(() => null) : null;
  if (!host || !ps || ps.site.status !== "published") return new Response("Not found", { status: 404 });
  if (settingsOf(ps.site.published_settings ?? ps.site.settings ?? {}).seo.noindex) return new Response("Not found", { status: 404 });
  const urls = ps.pages.filter((p) => p.published !== null && !cleanPageSeo(p.published_seo ?? {}).noindex).sort((a, b) => a.position - b.position).map((p) => `  <url><loc>${esc(`https://${ps.primaryHost ?? host}${p.is_home ? "/" : `/${p.slug}`}`)}</loc>${p.published_at ? `<lastmod>${esc(p.published_at.slice(0, 10))}</lastmod>` : ""}</url>`);
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=300" } });
}
