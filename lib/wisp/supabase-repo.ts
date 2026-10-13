import type { SupabaseClient } from "@supabase/supabase-js";
import type { WispAudit, WispDelivery, WispPlan, WispRepo } from "./service.ts";

// WISP rows for one tenant. The client is the tenant client, so the database's tenant policies scope every query.

const unwrap = <T>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

export class SupabaseWispRepo implements WispRepo {
  constructor(private db: SupabaseClient) {}

  async insertAudit(input: Omit<WispAudit, "id" | "tenant_id" | "created_at">) { return unwrap(await this.db.from("wisp_audits").insert(input).select("*").single()) as WispAudit; }
  async getAudit(id: string) { return unwrap(await this.db.from("wisp_audits").select("*").eq("id", id).maybeSingle()) as WispAudit | null; }
  async insertPlan(input: Pick<WispPlan, "id" | "audit_id" | "firm_name" | "email" | "answers_sealed" | "access_token_hash">) { return unwrap(await this.db.from("wisp_plans").insert(input).select("*").single()) as WispPlan; }
  async getPlan(id: string) { return unwrap(await this.db.from("wisp_plans").select("*").eq("id", id).maybeSingle()) as WispPlan | null; }
  async findPlanBySession(sessionId: string) { return unwrap(await this.db.from("wisp_plans").select("*").eq("stripe_session_id", sessionId).maybeSingle()) as WispPlan | null; }
  async findPlanByLinkHash(hash: string) { return unwrap(await this.db.from("wisp_plans").select("*").eq("link_token_hash", hash).maybeSingle()) as WispPlan | null; }
  async updatePlan(id: string, patch: Partial<WispPlan>) { return unwrap(await this.db.from("wisp_plans").update(patch).eq("id", id).select("*").single()) as WispPlan; }
  async listPlans(opts: { customerId?: string; limit: number }) {
    let q = this.db.from("wisp_plans").select("*").order("created_at", { ascending: false }).limit(opts.limit);
    if (opts.customerId) q = q.eq("customer_id", opts.customerId);
    return unwrap(await q) as WispPlan[];
  }
  async listAudits(limit: number) { return unwrap(await this.db.from("wisp_audits").select("*").order("created_at", { ascending: false }).limit(limit)) as WispAudit[]; }
  async addDelivery(input: Omit<WispDelivery, "id" | "tenant_id" | "created_at">) { unwrap(await this.db.from("wisp_deliveries").insert(input)); }
  async listDeliveries(planId: string) { return unwrap(await this.db.from("wisp_deliveries").select("*").eq("plan_id", planId).order("created_at", { ascending: false }).limit(100)) as WispDelivery[]; }
}
