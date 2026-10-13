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

/** The firms (My Service Bureau) a lead can be linked to. */
export async function firmOptions(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await tenantClient(currentTenantId()).from("organizations").select("id, legal_name, dba_name").is("archived_at", null).order("legal_name").limit(1000);
  if (error) return [];
  return (data as { id: string; legal_name: string; dba_name: string | null }[]).map((o) => ({ id: o.id, name: o.dba_name ? `${o.legal_name} (${o.dba_name})` : o.legal_name }));
}

export async function firmExists(id: string): Promise<boolean> {
  const { data, error } = await tenantClient(currentTenantId()).from("organizations").select("id").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

/** The customer and order a converted lead is linked to, for the lead's page. */
export async function linkedRecords(customerId: string | null, orderId: string | null) {
  const db = tenantClient(currentTenantId());
  const [customer, order] = await Promise.all([
    customerId ? db.from("calculator_customers").select("id, full_name, email").eq("id", customerId).maybeSingle().then((r) => r.data as { id: string; full_name: string | null; email: string } | null) : null,
    orderId ? db.from("orders").select("id, amount_cents, currency, created_at").eq("id", orderId).maybeSingle().then((r) => r.data as { id: string; amount_cents: number; currency: string; created_at: string } | null) : null,
  ]);
  return { customer, order };
}
