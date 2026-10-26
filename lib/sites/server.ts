import "server-only";
import { platformClient, tenantClient } from "../supabase/service";
import { vercelDomains } from "./vercel.ts";
import type { Site, SiteDomain, SitePage, SitesDeps } from "./service.ts";
import { SupabaseSitesRepo } from "./supabase-repo.ts";
import { cleanRequestHost } from "./host.ts";

// Server wiring for websites. The editor acts as the signed-in office (tenant client). The public renderer finds which
// office a hostname belongs to with one logged platform lookup of site_domains, and from then on acts as that office.

/** Whether any office uses this hostname. A yes-or-no answer; nothing about the owner leaves this function. */
async function hostnameTaken(host: string): Promise<boolean> {
  const { data, error } = await platformClient("site_host").from("site_domains").select("id").eq("hostname", host).maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export function sitesDeps(tenantId: string): SitesDeps {
  return { repo: new SupabaseSitesRepo(tenantClient(tenantId), hostnameTaken), domains: vercelDomains() };
}

export type PublicSite = { tenantId: string; site: Site; pages: SitePage[]; domain: Pick<SiteDomain, "hostname" | "kind" | "status"> };

/** The site behind a hostname, with its published pages; null when no office uses that hostname. */
export async function siteForHost(rawHost: string): Promise<PublicSite | null> {
  const host = cleanRequestHost(rawHost);
  if (!host) return null;
  const { data, error } = await platformClient("site_host").from("site_domains").select("tenant_id, site_id, hostname, kind, status").eq("hostname", host).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const tenantId = data.tenant_id as string;
  const repo = new SupabaseSitesRepo(tenantClient(tenantId), hostnameTaken);
  const site = await repo.getSite(data.site_id as string);
  if (!site) return null;
  const pages = await repo.listPages(site.id);
  return { tenantId, site, pages, domain: { hostname: data.hostname as string, kind: data.kind as SiteDomain["kind"], status: data.status as SiteDomain["status"] } };
}

// A short memory of which hostnames have a site, so the proxy doesn't query on every request.
const known = new Map<string, { at: number; has: boolean }>();
const TTL_MS = 30_000;

/** For the proxy: whether a hostname outside the platform domain belongs to a site. Errs toward "no" (the app serves it). */
export async function hostHasSite(host: string): Promise<boolean> {
  const hit = known.get(host);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.has;
  let has = false;
  try {
    has = await hostnameTaken(host);
  } catch (e) {
    console.error(`sites: host lookup failed: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`);
    return false;
  }
  if (known.size > 500) known.clear();
  known.set(host, { at: Date.now(), has });
  return has;
}
