import "server-only";
import { tenantClient } from "../supabase/service";
import { currentTenantId } from "../tenants.ts";
import { SupabasePipelinesRepo } from "./supabase-repo.ts";

export const pipelinesRepo = (tenantId: string = currentTenantId()) => new SupabasePipelinesRepo(tenantClient(tenantId));
