import "server-only";
import { platformClient } from "./supabase/service";
import { platformDomain, RESERVED_LABELS } from "./sites/domains.ts";
import { defaultHostFor, labelOfDefaultHost } from "./default-host-pick.ts";

// Every workspace has a public web address from the day it is created: its own name under the platform's site domain, with no
// website needed. Booking links and forms use it until the workspace connects a website or domain of its own. It is derived
// from the workspace's name (tenants.slug), so it needs no table of its own.

/** The default address of a workspace, or null when its name can't make a valid one. */
export async function defaultHostOf(tenantId: string): Promise<string | null> {
  const { data } = await platformClient("default_host").from("tenants").select("slug").eq("id", tenantId).maybeSingle();
  return defaultHostFor((data as { slug: string } | null)?.slug, platformDomain());
}

/** The workspace whose default address this is, or null. */
export async function tenantForDefaultHost(host: string): Promise<string | null> {
  const label = labelOfDefaultHost(host, platformDomain(), RESERVED_LABELS);
  if (!label) return null;
  const { data } = await platformClient("default_host").from("tenants").select("id").eq("slug", label).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** Whether a website address is a workspace's default one, so no website may claim it. */
export async function isDefaultHost(host: string): Promise<boolean> {
  return (await tenantForDefaultHost(host)) !== null;
}
