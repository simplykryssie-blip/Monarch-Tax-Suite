import "server-only";
import { appOrigin } from "./admin";
import { SupabaseSendersRepo } from "./automation/supabase-senders.ts";
import { brandsOf } from "./brands.ts";
import { defaultHostOf } from "./default-host";
import { pickPublicOrigin, type SiteHost } from "./public-origin-pick.ts";
import { tenantClient } from "./supabase/service";
import { MONARCH_TENANT_ID } from "./tenants.ts";

/** The address a workspace's public pages live on, or null when it has none yet (no website, no brand address). */
export async function publicOriginFor(tenantId: string): Promise<string | null> {
  const db = tenantClient(tenantId);
  const [domains, hosts] = await Promise.all([
    new SupabaseSendersRepo(db).listDomains().catch(() => []),
    db.from("site_domains").select("hostname, kind, status").then((r) => (r.error ? [] : ((r.data ?? []) as SiteHost[])), () => [] as SiteHost[]),
  ]);
  const brands = brandsOf(domains);
  const only = brands.length === 1 ? brands[0] : null;
  return pickPublicOrigin({ production: process.env.VERCEL_ENV === "production", brandLinkHost: only?.linkHost ?? null, siteHosts: hosts, defaultHost: tenantId === MONARCH_TENANT_ID ? null : await defaultHostOf(tenantId), isMonarch: tenantId === MONARCH_TENANT_ID, appOrigin: await appOrigin() });
}
