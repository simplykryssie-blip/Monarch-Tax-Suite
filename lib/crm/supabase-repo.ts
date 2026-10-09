import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUniqueViolation, unwrap } from "../commerce/supabase-repo.ts";
import type { CalculatorLead, CrmConnection, CrmRepo, LeadPatch, LeadSettings, LeadStatus, NewConnection, NewLead } from "./types.ts";

// Service-role store for CRM connections and leads. These tables have RLS on
// and no anon/authenticated grants; callers authorize before using this.

const LIVE = ["connected", "reauth_required"];

export class SupabaseCrmRepo implements CrmRepo {
  constructor(private db: SupabaseClient) {}

  async createOAuthState(input: { state_hash: string; license_id: string; expires_at: string }) {
    unwrap(await this.db.from("crm_oauth_states").insert(input));
    // Opportunistic cleanup of expired states.
    await this.db.from("crm_oauth_states").delete().lt("expires_at", new Date(Date.now() - 86_400_000).toISOString());
  }

  async consumeOAuthState(stateHash: string, licenseId: string, now: string) {
    const rows = unwrap(
      await this.db.from("crm_oauth_states").update({ used_at: now }).eq("state_hash", stateHash).eq("license_id", licenseId).is("used_at", null).gt("expires_at", now).select("id"),
    ) as unknown[];
    return rows.length === 1;
  }

  async getLiveConnection(licenseId: string) {
    return unwrap(await this.db.from("crm_connections").select("*").eq("license_id", licenseId).in("status", LIVE).maybeSingle()) as CrmConnection | null;
  }
  async getConnection(id: string) {
    return unwrap(await this.db.from("crm_connections").select("*").eq("id", id).maybeSingle()) as CrmConnection | null;
  }
  async insertConnection(input: NewConnection) {
    return unwrap(await this.db.from("crm_connections").insert(input).select("*").single()) as CrmConnection;
  }
  async updateConnection(id: string, patch: Partial<CrmConnection>) {
    return unwrap(await this.db.from("crm_connections").update(patch).eq("id", id).select("*").single()) as CrmConnection;
  }
  async claimRefreshLock(id: string, until: string) {
    return unwrap(await this.db.rpc("crm_claim_refresh_lock", { p_id: id, p_until: until })) === true;
  }

  async getLeadSettings(licenseId: string) {
    return unwrap(await this.db.from("crm_lead_settings").select("*").eq("license_id", licenseId).maybeSingle()) as LeadSettings | null;
  }
  async saveLeadSettings(settings: Omit<LeadSettings, "updated_at">) {
    const { license_id, enabled, business_name, lead_source, tags, update_existing, include_summary } = settings;
    return unwrap(
      await this.db.from("crm_lead_settings").upsert({ license_id, enabled, business_name, lead_source, tags, update_existing, include_summary }, { onConflict: "license_id" }).select("*").single(),
    ) as LeadSettings;
  }

  async insertLead(input: NewLead) {
    const result = await this.db.from("calculator_leads").insert(input).select("*").single();
    if (isUniqueViolation(result.error)) {
      const existing = unwrap(await this.db.from("calculator_leads").select("*").eq("license_id", input.license_id).eq("submission_id", input.submission_id).single()) as CalculatorLead;
      return { lead: existing, created: false };
    }
    return { lead: unwrap(result) as CalculatorLead, created: true };
  }
  async getLead(id: string) {
    return unwrap(await this.db.from("calculator_leads").select("*").eq("id", id).maybeSingle()) as CalculatorLead | null;
  }
  async updateLead(id: string, patch: LeadPatch) {
    return unwrap(await this.db.from("calculator_leads").update(patch).eq("id", id).select("*").single()) as CalculatorLead;
  }
  async claimLead(id: string, lockUntil: string) {
    const rows = unwrap(await this.db.rpc("crm_claim_lead", { p_id: id, p_lock_until: lockUntil })) as CalculatorLead[] | null;
    return rows?.[0] ?? null;
  }
  async listDueLeadIds(_now: string, limit: number, licenseId?: string) {
    const rows = unwrap(await this.db.rpc("crm_due_lead_ids", { p_limit: limit, p_license_id: licenseId ?? null })) as string[] | null;
    return rows ?? [];
  }
  async listLeads(licenseId: string, limit: number) {
    return unwrap(await this.db.from("calculator_leads").select("*").eq("license_id", licenseId).order("created_at", { ascending: false }).limit(limit)) as CalculatorLead[];
  }
  async listLeadsByStatus(licenseId: string, statuses: LeadStatus[]) {
    return unwrap(await this.db.from("calculator_leads").select("*").eq("license_id", licenseId).in("status", statuses)) as CalculatorLead[];
  }
  async countLeadsSince(filter: { license_id?: string; ip_hash?: string }, since: string) {
    let q = this.db.from("calculator_leads").select("id", { count: "exact", head: true }).gte("created_at", since);
    if (filter.license_id) q = q.eq("license_id", filter.license_id);
    if (filter.ip_hash) q = q.eq("ip_hash", filter.ip_hash);
    const { count, error } = await q;
    unwrap({ data: null, error });
    return count ?? 0;
  }
  async leadCounts(licenseId: string) {
    const rows = unwrap(await this.db.from("calculator_leads").select("status").eq("license_id", licenseId)) as { status: LeadStatus }[];
    const counts = { received: 0, sending: 0, sent: 0, retry_pending: 0, reauth_required: 0, failed: 0 } as Record<LeadStatus, number>;
    for (const r of rows) counts[r.status]++;
    return counts;
  }
  async listPurgeableLeadIds(olderThan: string, limit: number) {
    const rows = unwrap(
      await this.db.from("calculator_leads").select("id").lt("created_at", olderThan).or("payload_enc.not.is.null,ip_hash.not.is.null").limit(limit),
    ) as { id: string }[];
    return rows.map((r) => r.id);
  }
  async deleteLeadsBefore(before: string) {
    const rows = unwrap(await this.db.from("calculator_leads").delete().lt("created_at", before).select("id")) as unknown[];
    return rows.length;
  }
}
