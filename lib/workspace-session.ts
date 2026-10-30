import "server-only";
import { cache } from "react";
import { platformClient } from "./supabase/service";
import { setTenantResolver } from "./tenants.ts";
import type { Membership } from "./workspace-tenant.ts";

// The per-request holder for the workspace's tenant. The workspace gate (requireAdmin) works the tenant out from the signed-in
// person's memberships and remembers it here; currentTenantId() (lib/tenants.ts) reads it. `cache` makes the holder private to
// one request, so one person's tenant can never be seen by another request.

const holder = cache(() => ({ tenantId: null as string | null }));

export function rememberWorkspaceTenant(tenantId: string) {
  holder().tenantId = tenantId;
}

setTenantResolver(() => holder().tenantId);

/** Every tenant this account is a member of, with its role. Reads only the signed-in person's own rows. */
export const workspaceMemberships = cache(async (userId: string): Promise<Membership[]> => {
  const { data, error } = await platformClient("workspace_member").from("tenant_members").select("tenant_id, role").eq("user_id", userId);
  if (error) return [];
  return (data ?? []) as Membership[];
});

/** The workspace a person with more than one membership chose (Preview only). A name, never a trusted value: it counts only if it is one of their own memberships. */
export const WORKSPACE_COOKIE = "monarch_workspace";
