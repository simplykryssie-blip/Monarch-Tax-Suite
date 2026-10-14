import "server-only";
import { tenantClient } from "../supabase/service";
import { currentTenantId } from "../tenants.ts";
import { SupabaseLeadsRepo } from "./supabase-repo.ts";
import type { LeadsDeps } from "./types.ts";

// Server wiring for Leads. Admin pages act for the signed-in tenant; the WISP page and the Stripe webhook pass the
// tenant they already act for.

export function leadsDeps(tenantId: string = currentTenantId()): LeadsDeps {
  return { repo: new SupabaseLeadsRepo(tenantClient(tenantId)) };
}
