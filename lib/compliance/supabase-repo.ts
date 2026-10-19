import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Ack, Attestation, ComplianceEvent, ComplianceItem, ComplianceRepo, ComplianceSettings, DocKind, Form8879, Incident, Notice, PtinRenewal, TeamMember, VaultDocument,
} from "./types.ts";

// Compliance rows for one tenant. The client is the tenant client, so the database's tenant policies scope every
// query; each method also filters by office where it lists.

const unwrap = <T>(r: { data: T | null; error: { message: string; code?: string } | null }): T => {
  if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code });
  return r.data as T;
};
// Characters that mean something in a PostgREST filter are left out of a search.
const term = (q?: string) => q?.replace(/[,()*%\\"':]/g, " ").trim() || "";

export class SupabaseComplianceRepo implements ComplianceRepo {
  constructor(private db: SupabaseClient) {}

  async getSettings(officeId: string) { return unwrap(await this.db.from("compliance_settings").select("*").eq("organization_id", officeId).maybeSingle()) as ComplianceSettings | null; }
  async saveSettings(officeId: string, patch: Partial<ComplianceSettings>) {
    return unwrap(await this.db.from("compliance_settings").upsert({ ...patch, organization_id: officeId, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,organization_id" }).select("*").single()) as ComplianceSettings;
  }

  async listDocuments(officeId: string, f: { kind?: DocKind; q?: string; includePending?: boolean } = {}) {
    let q = this.db.from("vault_documents").select("*").eq("organization_id", officeId).order("created_at", { ascending: false }).limit(1000);
    if (!f.includePending) q = q.eq("status", "stored");
    if (f.kind) q = q.eq("kind", f.kind);
    const t = term(f.q);
    if (t) q = q.ilike("title", `%${t}%`);
    return unwrap(await q) as VaultDocument[];
  }
  async getDocument(id: string) { return unwrap(await this.db.from("vault_documents").select("*").eq("id", id).maybeSingle()) as VaultDocument | null; }
  async insertDocument(input: Omit<VaultDocument, "id" | "created_at">) { return unwrap(await this.db.from("vault_documents").insert(input).select("*").single()) as VaultDocument; }
  async updateDocument(id: string, patch: Partial<VaultDocument>) { return unwrap(await this.db.from("vault_documents").update(patch).eq("id", id).select("*").single()) as VaultDocument; }
  async deleteDocument(id: string) { unwrap(await this.db.from("vault_documents").delete().eq("id", id)); }
  async listStalePending(before: string) { return unwrap(await this.db.from("vault_documents").select("*").eq("status", "pending").lt("created_at", before).limit(200)) as VaultDocument[]; }

  async listAttestations(officeId: string) { return unwrap(await this.db.from("compliance_attestations").select("*").eq("organization_id", officeId).order("attested_at", { ascending: false }).limit(50)) as Attestation[]; }
  async insertAttestation(input: Omit<Attestation, "id" | "created_at" | "attested_at">) { return unwrap(await this.db.from("compliance_attestations").insert(input).select("*").single()) as Attestation; }
  async listAcks(attestationId: string) { return unwrap(await this.db.from("compliance_acks").select("*").eq("attestation_id", attestationId).order("acknowledged_at")) as Ack[]; }
  async insertAck(input: Omit<Ack, "id" | "acknowledged_at">) { return unwrap(await this.db.from("compliance_acks").insert(input).select("*").single()) as Ack; }

  async list8879(officeId: string, f: { q?: string; taxYear?: number } = {}) {
    let q = this.db.from("form_8879_records").select("*").eq("organization_id", officeId).order("retention_until").limit(5000);
    if (f.taxYear) q = q.eq("tax_year", f.taxYear);
    const t = term(f.q);
    if (t) q = q.or(`return_ref.ilike.*${t}*,taxpayer_name.ilike.*${t}*`);
    return unwrap(await q) as Form8879[];
  }
  async get8879(id: string) { return unwrap(await this.db.from("form_8879_records").select("*").eq("id", id).maybeSingle()) as Form8879 | null; }
  async insert8879(input: Omit<Form8879, "id" | "created_at" | "updated_at" | "retention_until">) {
    // The database works out retention_until (form_8879_retention); the placeholder is replaced.
    return unwrap(await this.db.from("form_8879_records").insert({ ...input, retention_until: input.due_date }).select("*").single()) as Form8879;
  }
  async update8879(id: string, patch: Partial<Form8879>) { return unwrap(await this.db.from("form_8879_records").update(patch).eq("id", id).select("*").single()) as Form8879; }
  async delete8879(id: string) { unwrap(await this.db.from("form_8879_records").delete().eq("id", id)); }

  async listRenewals(officeId: string, year: number) { return unwrap(await this.db.from("ptin_renewals").select("*").eq("organization_id", officeId).eq("renewal_year", year)) as PtinRenewal[]; }
  async saveRenewal(input: Omit<PtinRenewal, "id" | "recorded_at">) {
    return unwrap(await this.db.from("ptin_renewals").upsert({ ...input, recorded_at: new Date().toISOString() }, { onConflict: "member_id,renewal_year" }).select("*").single()) as PtinRenewal;
  }

  async listIncidents(officeId: string) { return unwrap(await this.db.from("compliance_incidents").select("*").eq("organization_id", officeId).order("created_at", { ascending: false }).limit(500)) as Incident[]; }
  async getIncident(id: string) { return unwrap(await this.db.from("compliance_incidents").select("*").eq("id", id).maybeSingle()) as Incident | null; }
  async insertIncident(input: Parameters<ComplianceRepo["insertIncident"]>[0]) { return unwrap(await this.db.from("compliance_incidents").insert(input).select("*").single()) as Incident; }
  async updateIncident(id: string, patch: Partial<Incident>) { return unwrap(await this.db.from("compliance_incidents").update(patch).eq("id", id).select("*").single()) as Incident; }

  async listItems(officeId: string) { return unwrap(await this.db.from("compliance_items").select("*").eq("organization_id", officeId).order("due_on", { nullsFirst: false }).order("created_at").limit(500)) as ComplianceItem[]; }
  async getItem(id: string) { return unwrap(await this.db.from("compliance_items").select("*").eq("id", id).maybeSingle()) as ComplianceItem | null; }
  async insertItem(input: Parameters<ComplianceRepo["insertItem"]>[0]) { return unwrap(await this.db.from("compliance_items").insert(input).select("*").single()) as ComplianceItem; }
  async updateItem(id: string, patch: Partial<ComplianceItem>) { return unwrap(await this.db.from("compliance_items").update(patch).eq("id", id).select("*").single()) as ComplianceItem; }
  async deleteItem(id: string) { unwrap(await this.db.from("compliance_items").delete().eq("id", id)); }

  async addEvent(e: Omit<ComplianceEvent, "id" | "created_at">) { unwrap(await this.db.from("compliance_events").insert(e)); }
  async listEvents(officeId: string, f: { entity?: ComplianceEvent["entity"]; recordId?: string; limit?: number } = {}) {
    let q = this.db.from("compliance_events").select("*").eq("organization_id", officeId).order("created_at", { ascending: false }).limit(f.limit ?? 100);
    if (f.entity) q = q.eq("entity", f.entity);
    if (f.recordId) q = q.eq("record_id", f.recordId);
    return unwrap(await q) as ComplianceEvent[];
  }

  async listTeam(officeId: string) { return unwrap(await this.db.from("office_members").select("id, organization_id, role, email, full_name, status").eq("organization_id", officeId).order("full_name")) as TeamMember[]; }
  async listOffices() {
    const rows = unwrap(await this.db.from("organizations").select("id, legal_name, dba_name, archived_at").order("legal_name").limit(1000)) as { id: string; legal_name: string; dba_name: string | null; archived_at: string | null }[];
    return rows.map((o) => ({ id: o.id, name: o.dba_name || o.legal_name, archived: Boolean(o.archived_at) }));
  }

  async claimNotice(input: { organization_id: string; notice_key: string; recipient: string }) {
    const r = await this.db.from("compliance_notices").insert(input).select("*").single();
    if (!r.error) return r.data as Notice;
    if (r.error.code !== "23505") throw new Error(r.error.message);
    // Already recorded: send again only if the earlier attempt failed (up to 4 tries).
    const existing = unwrap(await this.db.from("compliance_notices").select("*").eq("notice_key", input.notice_key).eq("recipient", input.recipient).maybeSingle()) as Notice | null;
    return existing && existing.status === "failed" && existing.attempts < 4 ? existing : null;
  }
  async finishNotice(id: string, patch: Partial<Notice>) { unwrap(await this.db.from("compliance_notices").update(patch).eq("id", id)); }
}
