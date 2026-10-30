import "server-only";
import { headers } from "next/headers";
import { hostFromHeaders } from "./brands.ts";
import { tenantForDefaultHost } from "./default-host";
import { platformClient } from "./supabase/service";
import { MONARCH_TENANT_ID } from "./tenants.ts";

// Which tenant a public page belongs to: the tenant whose brand web address (or website address) the page was opened on,
// or Monarch for the app's own address. Used by the public booking pages and the Monarch store's WISP funnel.

/** The tenant whose brand owns this web address, or Monarch. One indexed lookup, logged as platform access. */
export async function tenantForHost(host: string | null): Promise<string> {
  if (!host) return MONARCH_TENANT_ID;
  const bare = host.replace(/:\d+$/, "");
  const { data } = await platformClient("wisp_link").from("email_domains").select("tenant_id").eq("link_host", bare).maybeSingle();
  if (data?.tenant_id) return data.tenant_id as string;
  // An office's website address also names the office, so booking pages and forms embedded in its site work on it.
  const site = await platformClient("site_host").from("site_domains").select("tenant_id").eq("hostname", bare).maybeSingle();
  if (site.data?.tenant_id) return site.data.tenant_id as string;
  // A workspace with no website is still reached on its default address (its name under the platform site domain).
  return (await tenantForDefaultHost(bare)) ?? MONARCH_TENANT_ID;
}

export async function requestTenant(): Promise<string> {
  return tenantForHost(hostFromHeaders(await headers()));
}
