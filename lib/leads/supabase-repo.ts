import type { SupabaseClient } from "@supabase/supabase-js";
import { dayStart } from "./service.ts";
import type { Lead, LeadEvent, LeadFilter, LeadInsert, LeadsRepo } from "./types.ts";

// Lead rows for one tenant. The client is the tenant client, so the database's tenant policies scope every query.

const unwrap = <T>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

export class SupabaseLeadsRepo implements LeadsRepo {
  constructor(private db: SupabaseClient) {}

  async listLeads(f: LeadFilter) {
    const limit = f.limit ?? 500;
    const out: Lead[] = [];
    // A page at a time: the API returns at most 1,000 rows per request.
    for (let from = 0; from < limit; from += 1000) {
      let q = this.db.from("leads").select("*").order("created_at", { ascending: false }).order("id").range(from, Math.min(limit, from + 1000) - 1);
      if (f.source) q = q.eq("source", f.source);
      if (f.status) q = q.eq("status", f.status);
      if (f.from) q = q.gte("created_at", dayStart(f.from));
      if (f.to) q = q.lt("created_at", dayStart(f.to, 1));
      // Characters that mean something in a PostgREST filter are left out of the search.
      const term = f.q?.replace(/[,()*%\\"':]/g, " ").trim();
      if (term) q = q.or(["full_name", "email", "firm_name"].map((c) => `${c}.ilike.*${term}*`).join(","));
      const page = unwrap(await q) as Lead[];
      out.push(...page);
      if (page.length < Math.min(1000, limit - from)) break;
    }
    return out;
  }
  async getLead(id: string) { return unwrap(await this.db.from("leads").select("*").eq("id", id).maybeSingle()) as Lead | null; }
  async findByEmail(email: string) { return unwrap(await this.db.from("leads").select("*").eq("email", email).maybeSingle()) as Lead | null; }
  async findByAudit(auditId: string) { return unwrap(await this.db.from("leads").select("*").eq("audit_id", auditId).limit(1).maybeSingle()) as Lead | null; }
  async existingEmails(emails: string[]) {
    const found = new Set<string>();
    for (let i = 0; i < emails.length; i += 200) {
      const rows = unwrap(await this.db.from("leads").select("email").in("email", emails.slice(i, i + 200))) as { email: string }[];
      for (const r of rows) found.add(r.email);
    }
    return found;
  }
  async insertLead(input: LeadInsert) { return unwrap(await this.db.from("leads").insert(input).select("*").single()) as Lead; }
  async updateLead(id: string, patch: Partial<Lead>) { return unwrap(await this.db.from("leads").update(patch).eq("id", id).select("*").single()) as Lead; }
  async deleteLead(id: string) { unwrap(await this.db.from("leads").delete().eq("id", id)); }
  async addEvent(e: Omit<LeadEvent, "id" | "tenant_id" | "created_at">) { unwrap(await this.db.from("lead_events").insert(e)); }
  async listEvents(leadId: string) { return unwrap(await this.db.from("lead_events").select("*").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(200)) as LeadEvent[]; }
}
