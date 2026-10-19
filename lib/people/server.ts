import "server-only";
import { SupabaseLeadsRepo } from "../leads/supabase-repo.ts";
import { tenantClient } from "../supabase/service";
import { currentTenantId } from "../tenants.ts";
import { SupabasePeopleRepo } from "./supabase-repo.ts";
import type { PeopleDeps } from "./match.ts";

export function peopleDeps(tenantId: string = currentTenantId()): PeopleDeps {
  const db = tenantClient(tenantId);
  return { people: new SupabasePeopleRepo(db), leads: new SupabaseLeadsRepo(db) };
}
