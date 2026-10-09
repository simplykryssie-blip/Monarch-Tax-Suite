import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "../commerce/supabase-repo.ts";
import type { CrmConnection, CrmRepo, DeliveryLogEntry, LeadSettings, NewConnection } from "./types.ts";

// Service-role store for buyer CRM destinations, lead-form settings and the
// delivery log (no personal data). RLS is on for every table with no
// anon/authenticated grants; callers authorize before using this.

const LIVE = ["connected", "reauth_required"];

export class SupabaseCrmRepo implements CrmRepo {
  private db: SupabaseClient;
  constructor(db: SupabaseClient) {
    this.db = db;
  }

  async createOAuthState(input: { state_hash: string; license_id: string; expires_at: string }) {
    unwrap(await this.db.from("crm_oauth_states").insert(input));
    await this.db.from("crm_oauth_states").delete().lt("expires_at", new Date(Date.now() - 86_400_000).toISOString());
  }

  async consumeOAuthState(stateHash: string, now: string) {
    const rows = unwrap(
      await this.db.from("crm_oauth_states").update({ used_at: now }).eq("state_hash", stateHash).is("used_at", null).gt("expires_at", now).select("license_id"),
    ) as { license_id: string }[];
    return rows.length === 1 ? rows[0].license_id : null;
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

  async logDelivery(entry: Omit<DeliveryLogEntry, "id" | "created_at">) {
    unwrap(await this.db.from("lead_delivery_log").insert(entry));
  }
  async countDeliveries(filter: { license_id?: string; ip_hash?: string }, since: string) {
    let q = this.db.from("lead_delivery_log").select("id", { count: "exact", head: true }).gte("created_at", since);
    if (filter.license_id) q = q.eq("license_id", filter.license_id);
    if (filter.ip_hash) q = q.eq("ip_hash", filter.ip_hash);
    const { count, error } = await q;
    unwrap({ data: null, error });
    return count ?? 0;
  }
  async listDeliveries(licenseId: string, limit: number) {
    return unwrap(await this.db.from("lead_delivery_log").select("*").eq("license_id", licenseId).order("created_at", { ascending: false }).limit(limit)) as DeliveryLogEntry[];
  }
  async pruneDeliveryLog(ipBefore: string, deleteBefore: string) {
    await this.db.from("lead_delivery_log").update({ ip_hash: null }).lt("created_at", ipBefore).not("ip_hash", "is", null);
    await this.db.from("lead_delivery_log").delete().lt("created_at", deleteBefore);
  }
}
