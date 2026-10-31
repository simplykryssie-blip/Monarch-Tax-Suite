import "server-only";
import { platformClient, tenantClient } from "../supabase/service";
import { vercelDomains } from "./vercel.ts";
import { CUSTOM_DOMAINS_BY_TIER, type Site, type SiteDomain, type SitePage, type SitesDeps } from "./service.ts";
import { isTier } from "../tier.ts";
import { SupabaseSitesRepo } from "./supabase-repo.ts";
import { cleanRequestHost } from "./host.ts";
import { MONARCH_TENANT_ID } from "../tenants.ts";
import { isDefaultHost } from "../default-host";

// Server wiring for websites. The editor acts as the signed-in office (tenant client). The public renderer finds which
// office a hostname belongs to with one logged platform lookup of site_domains, and from then on acts as that office.

/** Whether any office uses this hostname. A yes-or-no answer; nothing about the owner leaves this function. */
async function hostnameTaken(host: string): Promise<boolean> {
  const { data, error } = await platformClient("site_host").from("site_domains").select("id").eq("hostname", host).maybeSingle();
  if (error) throw new Error(error.message);
  // A workspace's default address (its name under the platform site domain) is already someone's.
  return Boolean(data) || (await isDefaultHost(host));
}

/** How many domains this account's plan allows. An account with no tier is treated as a Service Bureau, like everywhere else. */
async function domainLimit(tenantId: string): Promise<number> {
  const { data } = await tenantClient(tenantId).from("tenants").select("tier").limit(1).maybeSingle();
  const tier = (data as { tier: string | null } | null)?.tier;
  return isTier(tier) ? CUSTOM_DOMAINS_BY_TIER[tier] : CUSTOM_DOMAINS_BY_TIER.bureau;
}

export const sitesDeps = (tenantId: string): SitesDeps => ({ repo: new SupabaseSitesRepo(tenantClient(tenantId), hostnameTaken), domains: vercelDomains(), adoptOwn: tenantId === MONARCH_TENANT_ID, registerAddresses: process.env.VERCEL_ENV === "production", maxCustomDomains: () => domainLimit(tenantId) });

export type PublicSite = {
  tenantId: string; site: Site; pages: SitePage[]; domain: Pick<SiteDomain, "hostname" | "kind" | "status">;
  /** The office's own connected domain, once it is working. The free address then sends visitors here. */
  primaryHost: string | null;
};

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
  const own = (await repo.listDomains(site.id)).find((d) => d.kind === "custom" && d.status === "active");
  return { tenantId, site, pages, primaryHost: own?.hostname ?? null, domain: { hostname: data.hostname as string, kind: data.kind as SiteDomain["kind"], status: data.status as SiteDomain["status"] } };
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
