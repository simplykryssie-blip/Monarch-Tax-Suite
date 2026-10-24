import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Business, BusinessInput, Client, ClientDoc, ClientEvent, InvoiceLine, Spouse, SpouseInput, Dependent, DependentInput, ClientInput, ClientMessage, NewClientMessage, ClientNote, ClientReturn, ClientTask, Invoice, InvoiceInsert, PaymentImport, PaymentRow, PaymentRowInsert, ReturnInput, WorkspaceRepo } from "./types.ts";

// Workspace rows for one tenant, on the tenant client: the database's tenant policies scope every query.
const unwrap = <T>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};
const like = (v: string) => v.replace(/[\\%_,()*"':]/g, " ").trim();

export class SupabaseWorkspaceRepo implements WorkspaceRepo {
  constructor(private db: SupabaseClient) {}

  async listClients(f: { q?: string; includeArchived?: boolean; ownerId?: string; organizationId?: string } = {}) {
    let q = this.db.from("clients").select("*").order("full_name").limit(2000);
    if (!f.includeArchived) q = q.is("archived_at", null);
    if (f.ownerId) q = q.eq("owner_id", f.ownerId);
    if (f.organizationId) q = q.eq("organization_id", f.organizationId);
    const term = f.q ? like(f.q) : "";
    if (term) q = q.or(["full_name", "email", "phone"].map((c) => `${c}.ilike.*${term}*`).join(","));
    return unwrap(await q) as Client[];
  }
  async getClient(id: string) { return unwrap(await this.db.from("clients").select("*").eq("id", id).maybeSingle()) as Client | null; }
  async insertClient(input: ClientInput & { created_by: string | null; owner_id?: string | null; organization_id?: string | null; tags?: string[] }) { return unwrap(await this.db.from("clients").insert(input).select("*").single()) as Client; }
  async listDependents(clientId: string) { return unwrap(await this.db.from("client_dependents").select("*").eq("client_id", clientId).order("created_at")) as Dependent[]; }
  async insertDependent(input: DependentInput) { return unwrap(await this.db.from("client_dependents").insert(input).select("*").single()) as Dependent; }
  async deleteDependent(id: string) { unwrap(await this.db.from("client_dependents").delete().eq("id", id).select("id")); }
  async getSpouse(clientId: string) { return unwrap(await this.db.from("client_spouses").select("*").eq("client_id", clientId).maybeSingle()) as Spouse | null; }
  async upsertSpouse(input: SpouseInput) { return unwrap(await this.db.from("client_spouses").upsert(input, { onConflict: "tenant_id,client_id" }).select("*").single()) as Spouse; }
  async deleteSpouse(clientId: string) { unwrap(await this.db.from("client_spouses").delete().eq("client_id", clientId).select("id")); }
  async getInvoiceDefaults() {
    const row = unwrap(await this.db.from("invoice_defaults").select("lines").maybeSingle()) as { lines: InvoiceLine[] } | null;
    return row ? row.lines : null;
  }
  async saveInvoiceDefaults(lines: InvoiceLine[], actorId: string | null) {
    unwrap(await this.db.from("invoice_defaults").upsert({ lines, updated_by: actorId, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" }).select("tenant_id"));
  }
  async addClientEvent(e: { clientId: string; action: string; actorId: string | null; detail: Record<string, unknown> }) {
    unwrap(await this.db.from("workspace_audit_events").insert({ actor_id: e.actorId, action: e.action, subject_type: "client", subject_id: e.clientId, detail: e.detail }).select("id"));
  }
  async listClientEvents(clientId: string, limit: number) {
    return unwrap(await this.db.from("workspace_audit_events").select("id, action, actor_id, detail, created_at").eq("subject_type", "client").eq("subject_id", clientId).order("created_at", { ascending: false }).limit(limit)) as ClientEvent[];
  }
  async mergeClients(keep: string, drop: string, actorId: string | null) {
    return unwrap(await this.db.rpc("merge_clients", { p_keep: keep, p_drop: drop, p_actor: actorId })) as Record<string, number>;
  }
  async listBusinesses(clientId: string) { return unwrap(await this.db.from("client_businesses").select("*").eq("client_id", clientId).order("created_at")) as Business[]; }
  async insertBusiness(input: BusinessInput) { return unwrap(await this.db.from("client_businesses").insert(input).select("*").single()) as Business; }
  async deleteBusiness(id: string) { unwrap(await this.db.from("client_businesses").delete().eq("id", id).select("id")); }
  async updateClient(id: string, patch: Partial<ClientInput> & { archived_at?: string | null; spouse_id?: string | null }) { return unwrap(await this.db.from("clients").update(patch).eq("id", id).select("*").single()) as Client; }

  async listReturns(f: { year?: number; clientId?: string; includeArchived?: boolean; assigneeId?: string; organizationId?: string } = {}) {
    let q = this.db.from("client_returns").select("*").order("created_at").limit(5000);
    if (!f.includeArchived) q = q.is("archived_at", null);
    if (f.year) q = q.eq("tax_year", f.year);
    if (f.clientId) q = q.eq("client_id", f.clientId);
    if (f.assigneeId) q = q.eq("assignee_id", f.assigneeId);
    if (f.organizationId) q = q.eq("organization_id", f.organizationId);
    return unwrap(await q) as ClientReturn[];
  }
  async getReturn(id: string) { return unwrap(await this.db.from("client_returns").select("*").eq("id", id).maybeSingle()) as ClientReturn | null; }
  async insertReturn(input: ReturnInput & { assignee_id?: string | null; organization_id?: string | null }) { return unwrap(await this.db.from("client_returns").insert(input).select("*").single()) as ClientReturn; }
  async updateReturn(id: string, patch: Partial<Pick<ClientReturn, "stage_id" | "due_on" | "filed_on" | "notes" | "archived_at" | "assignee_id" | "prep_status" | "handed_off_at">>) { return unwrap(await this.db.from("client_returns").update(patch).eq("id", id).select("*").single()) as ClientReturn; }

  async listDocs(clientId: string) { return unwrap(await this.db.from("client_docs").select("*").eq("client_id", clientId).eq("status", "stored").order("created_at", { ascending: false })) as ClientDoc[]; }
  async getDoc(id: string) { return unwrap(await this.db.from("client_docs").select("*").eq("id", id).maybeSingle()) as ClientDoc | null; }
  async insertDoc(input: Omit<ClientDoc, "id" | "tenant_id" | "created_at">) { return unwrap(await this.db.from("client_docs").insert(input).select("*").single()) as ClientDoc; }
  async updateDoc(id: string, patch: Partial<Pick<ClientDoc, "status">>) { return unwrap(await this.db.from("client_docs").update(patch).eq("id", id).select("*").single()) as ClientDoc; }
  async deleteDoc(id: string) { unwrap(await this.db.from("client_docs").delete().eq("id", id)); }
  async listStalePendingDocs(before: string) { return unwrap(await this.db.from("client_docs").select("*").eq("status", "pending").lt("created_at", before).limit(200)) as ClientDoc[]; }

  async listMessages(clientId: string) { return unwrap(await this.db.from("client_messages").select("*").eq("client_id", clientId).order("occurred_at", { ascending: false }).limit(300)) as ClientMessage[]; }
  async insertMessage(input: NewClientMessage) { return unwrap(await this.db.from("client_messages").insert(input).select("*").single()) as ClientMessage; }
  async listTasks(f: { clientId?: string; openOnly?: boolean } = {}) {
    let q = this.db.from("client_tasks").select("*").order("due_on", { ascending: true, nullsFirst: false }).limit(1000);
    if (f.clientId) q = q.eq("client_id", f.clientId);
    if (f.openOnly) q = q.is("done_at", null);
    return unwrap(await q) as ClientTask[];
  }
  async insertTask(input: Pick<ClientTask, "client_id" | "return_id" | "title" | "due_on" | "created_by">) { return unwrap(await this.db.from("client_tasks").insert(input).select("*").single()) as ClientTask; }
  async updateTask(id: string, patch: Partial<Pick<ClientTask, "done_at">>) { return unwrap(await this.db.from("client_tasks").update(patch).eq("id", id).select("*").single()) as ClientTask; }
  async listNotes(clientId: string) { return unwrap(await this.db.from("client_notes").select("*").eq("client_id", clientId).order("created_at", { ascending: false }).limit(300)) as ClientNote[]; }
  async insertNote(input: Pick<ClientNote, "client_id" | "body" | "created_by">) { return unwrap(await this.db.from("client_notes").insert(input).select("*").single()) as ClientNote; }

  async listInvoices(f: { clientId?: string; year?: number } = {}) {
    let q = this.db.from("invoices").select("*").order("issued_on", { ascending: false }).order("number", { ascending: false }).limit(5000);
    if (f.clientId) q = q.eq("client_id", f.clientId);
    if (f.year) q = q.eq("tax_year", f.year);
    return unwrap(await q) as Invoice[];
  }
  async getInvoice(id: string) { return unwrap(await this.db.from("invoices").select("*").eq("id", id).maybeSingle()) as Invoice | null; }
  async insertInvoice(input: InvoiceInsert) { return unwrap(await this.db.from("invoices").insert(input).select("*").single()) as Invoice; }
  async updateInvoice(id: string, patch: Partial<Pick<Invoice, "status" | "lines" | "total_cents" | "paid_cents" | "paid_on" | "due_on" | "notes">>) { return unwrap(await this.db.from("invoices").update(patch).eq("id", id).select("*").single()) as Invoice; }
  async nextInvoiceNumber() {
    const rows = unwrap(await this.db.from("invoices").select("number").order("number", { ascending: false }).limit(1)) as { number: string }[];
    const n = rows[0] ? Number(rows[0].number.replace(/\D/g, "")) + 1 : 1;
    return `INV-${String(n).padStart(4, "0")}`;
  }

  async insertImport(input: Pick<PaymentImport, "file_name" | "file_sha256" | "row_count" | "created_by">) { return unwrap(await this.db.from("payment_imports").insert(input).select("*").single()) as PaymentImport; }
  async getImport(id: string) { return unwrap(await this.db.from("payment_imports").select("*").eq("id", id).maybeSingle()) as PaymentImport | null; }
  async findImportByHash(sha: string) { return unwrap(await this.db.from("payment_imports").select("*").eq("file_sha256", sha).order("created_at", { ascending: false }).limit(1).maybeSingle()) as PaymentImport | null; }
  async listImports(limit: number) { return unwrap(await this.db.from("payment_imports").select("*").order("created_at", { ascending: false }).limit(limit)) as PaymentImport[]; }
  async updateImport(id: string, patch: Partial<Pick<PaymentImport, "status" | "applied_at">>) { return unwrap(await this.db.from("payment_imports").update(patch).eq("id", id).select("*").single()) as PaymentImport; }
  async insertImportRows(rows: PaymentRowInsert[]) {
    const out: PaymentRow[] = [];
    for (let i = 0; i < rows.length; i += 500) out.push(...(unwrap(await this.db.from("payment_import_rows").insert(rows.slice(i, i + 500)).select("*")) as PaymentRow[]));
    return out;
  }
  async listImportRows(importId: string) { return unwrap(await this.db.from("payment_import_rows").select("*").eq("import_id", importId).order("row_no").limit(5000)) as PaymentRow[]; }
  async updateImportRow(id: string, patch: Partial<Pick<PaymentRow, "invoice_id" | "amount_cents" | "match" | "status">>) { return unwrap(await this.db.from("payment_import_rows").update(patch).eq("id", id).select("*").single()) as PaymentRow; }
}
