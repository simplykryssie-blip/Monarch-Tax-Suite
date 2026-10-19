import "server-only";
import { tenantClient } from "../supabase/service";
import { currentTenantId } from "../tenants.ts";
import type { FeesDeps } from "./service.ts";
import { SupabaseFeesRepo } from "./supabase-repo.ts";

/** Fees & Statements for the signed-in bureau's tenant. */
export function feesDeps(tenantId: string = currentTenantId()): FeesDeps {
  return { repo: new SupabaseFeesRepo(tenantClient(tenantId)) };
}
