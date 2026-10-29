import "server-only";
import { tenantClient } from "../supabase/service";
import { currentTenantId } from "../tenants.ts";
import { pairOf } from "./dismissals.ts";

export type Dismissal = { key_a: string; key_b: string; created_at: string };

// Reads and writes the "not a duplicate" pairs of the signed-in workspace.
export async function listDismissals(tenantId: string = currentTenantId()): Promise<Dismissal[]> {
  const { data, error } = await tenantClient(tenantId).from("contact_duplicate_dismissals").select("key_a, key_b, created_at").limit(5000);
  if (error) throw new Error(error.message);
  return (data ?? []) as Dismissal[];
}

export async function addDismissal(x: string, y: string, actorId: string, tenantId: string = currentTenantId()): Promise<void> {
  const [key_a, key_b] = pairOf(x, y);
  const { error } = await tenantClient(tenantId).from("contact_duplicate_dismissals").upsert({ key_a, key_b, dismissed_by: actorId, tenant_id: tenantId }, { onConflict: "tenant_id,key_a,key_b", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

export async function removeDismissal(x: string, y: string, tenantId: string = currentTenantId()): Promise<void> {
  const [key_a, key_b] = pairOf(x, y);
  const { error } = await tenantClient(tenantId).from("contact_duplicate_dismissals").delete().eq("key_a", key_a).eq("key_b", key_b);
  if (error) throw new Error(error.message);
}
