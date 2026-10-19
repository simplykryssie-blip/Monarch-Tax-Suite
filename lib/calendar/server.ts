import "server-only";
import { documentDeps } from "../documents/server";
import { tenantClient } from "../supabase/service";
import { currentTenantId } from "../tenants.ts";
import { SupabaseBusinessRepo } from "./supabase-repo.ts";
import type { BusinessDeps } from "./service.ts";

/** Business-calendar dependencies for a tenant; the time zone comes from its firm profile. */
export function businessDeps(tenantId: string = currentTenantId()): BusinessDeps {
  return {
    repo: new SupabaseBusinessRepo(tenantClient(tenantId)),
    timeZone: async () => (await documentDeps(tenantId).repo.getProfile().catch(() => null))?.time_zone ?? null,
  };
}
