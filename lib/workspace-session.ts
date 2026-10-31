import "server-only";
import { cache } from "react";
import { platformClient } from "./supabase/service";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";
import { setTenantResolver } from "./tenants.ts";
import type { Membership } from "./workspace-tenant.ts";

// The per-request holder for the workspace's tenant. The workspace gate (requireAdmin) works the tenant out from the signed-in
// person's memberships and remembers it here; currentTenantId() (lib/tenants.ts) reads it. `cache` makes the holder private to
// one request, so one person's tenant can never be seen by another request.

const renderHolder = cache(() => ({ tenantId: null as string | null }));
const byRequest = new WeakMap<object, { tenantId: string | null }>();

// React's `cache` only lasts for a page render. A server action (saving a lead, a contact, a website) runs outside one, so every
// holder() call there got a fresh empty holder and the action fell back to Monarch. The request's own headers object is the same
// for the whole request, pages and actions alike, so it is the key when there is one; `cache` stays as the fallback.
function holder(): { tenantId: string | null } {
  const store = workUnitAsyncStorage.getStore() as { headers?: object } | undefined;
  const key = store?.headers;
  if (!key) return renderHolder();
  let h = byRequest.get(key);
  if (!h) byRequest.set(key, (h = { tenantId: null }));
  return h;
}

export function rememberWorkspaceTenant(tenantId: string) {
  holder().tenantId = tenantId;
}

setTenantResolver(() => holder().tenantId);

/** Every tenant this account is a member of, with its role. Reads only the signed-in person's own rows. */
export async function workspaceMemberships(userId: string): Promise<Membership[]> {
  const { data, error } = await platformClient("workspace_member").from("tenant_members").select("tenant_id, role").eq("user_id", userId);
  if (error) return [];
  return (data ?? []) as Membership[];
}
