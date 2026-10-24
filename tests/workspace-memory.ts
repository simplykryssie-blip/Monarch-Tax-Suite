import { randomUUID } from "node:crypto";
import type { Business, BusinessInput, Client, ClientDoc, Dependent, DependentInput, ClientInput, ClientMessage, NewClientMessage, ClientNote, ClientReturn, ClientTask, Invoice, InvoiceInsert, PaymentImport, PaymentRow, PaymentRowInsert, ReturnInput, WorkspaceRepo } from "../lib/workspace/types.ts";

// The workspace in memory, with the database rules that matter: one original and one extension per client per year,
// unique invoice numbers. Returns copies.
export class MemoryWorkspace implements WorkspaceRepo {
  clients: Client[] = []; returns: ClientReturn[] = []; docs: ClientDoc[] = []; messages: ClientMessage[] = []; tasks: ClientTask[] = []; notes: ClientNote[] = [];
  invoices: Invoice[] = []; imports: PaymentImport[] = []; rows: PaymentRow[] = [];
  private c = <T>(v: T): T => structuredClone(v);
  private at = () => "2026-10-15T12:00:00.000Z";

  async listClients(f: { q?: string; includeArchived?: boolean; ownerId?: string; organizationId?: string } = {}) { return this.c(this.clients.filter((x) => (f.includeArchived || !x.archived_at) && (!f.ownerId || x.owner_id === f.ownerId) && (!f.organizationId || x.organization_id === f.organizationId) && (!f.q || x.full_name.toLowerCase().includes(f.q.toLowerCase())))); }
  async getClient(id: string) { return this.c(this.clients.find((x) => x.id === id) ?? null); }
  async insertClient(input: ClientInput & { created_by: string | null; owner_id?: string | null; organization_id?: string | null }) { const x: Client = { owner_id: null, organization_id: null, ...this.c(input), id: randomUUID(), tenant_id: "t", archived_at: null, created_at: this.at(), updated_at: this.at() }; this.clients.push(x); return this.c(x); }
  dependents: Dependent[] = []; businesses: Business[] = [];
  async listDependents(clientId: string) { return this.c(this.dependents.filter((d) => d.client_id === clientId)); }
  async insertDependent(input: DependentInput) { const rest: Record<string, unknown> = { ...input }; delete rest.created_by; const d = { ...this.c(rest) as unknown as Dependent, id: randomUUID(), tenant_id: "t", created_at: this.at() }; this.dependents.push(d); return this.c(d); }
  async deleteDependent(id: string) { this.dependents = this.dependents.filter((d) => d.id !== id); }
  async listBusinesses(clientId: string) { return this.c(this.businesses.filter((b) => b.client_id === clientId)); }
  async insertBusiness(input: BusinessInput) { const rest: Record<string, unknown> = { ...input }; delete rest.created_by; const b = { ...this.c(rest) as unknown as Business, id: randomUUID(), tenant_id: "t", created_at: this.at() }; this.businesses.push(b); return this.c(b); }
  async deleteBusiness(id: string) { this.businesses = this.businesses.filter((b) => b.id !== id); }
  async updateClient(id: string, patch: Partial<ClientInput> & { archived_at?: string | null; spouse_id?: string | null }) { const x = this.clients.find((y) => y.id === id)!; Object.assign(x, this.c(patch)); return this.c(x); }

  async listReturns(f: { year?: number; clientId?: string; includeArchived?: boolean; assigneeId?: string; organizationId?: string } = {}) { return this.c(this.returns.filter((r) => (f.includeArchived || !r.archived_at) && (!f.assigneeId || r.assignee_id === f.assigneeId) && (!f.organizationId || r.organization_id === f.organizationId) && (!f.year || r.tax_year === f.year) && (!f.clientId || r.client_id === f.clientId))); }
  async getReturn(id: string) { return this.c(this.returns.find((r) => r.id === id) ?? null); }
  async insertReturn(input: ReturnInput & { assignee_id?: string | null; organization_id?: string | null }) {
    if (input.kind !== "amendment" && this.returns.some((r) => !r.archived_at && r.client_id === input.client_id && r.tax_year === input.tax_year && r.kind === input.kind)) throw new Error('duplicate key value violates unique constraint "client_returns_one_per_year"');
    const r: ClientReturn = { assignee_id: null, organization_id: null, prep_status: "not_started", handed_off_at: null, ...this.c(input), id: randomUUID(), tenant_id: "t", filed_on: null, archived_at: null, created_at: this.at(), updated_at: this.at() };
    this.returns.push(r); return this.c(r);
  }
  async updateReturn(id: string, patch: Partial<Pick<ClientReturn, "stage_id" | "due_on" | "filed_on" | "notes" | "archived_at" | "assignee_id" | "prep_status" | "handed_off_at">>) { const r = this.returns.find((x) => x.id === id)!; Object.assign(r, this.c(patch)); return this.c(r); }

  async listDocs(clientId: string) { return this.c(this.docs.filter((d) => d.client_id === clientId && d.status === "stored")); }
  async getDoc(id: string) { return this.c(this.docs.find((d) => d.id === id) ?? null); }
  async insertDoc(input: Omit<ClientDoc, "id" | "tenant_id" | "created_at">) { const d: ClientDoc = { ...this.c(input), id: randomUUID(), tenant_id: "t", created_at: this.at() }; this.docs.push(d); return this.c(d); }
  async updateDoc(id: string, patch: Partial<Pick<ClientDoc, "status">>) { const d = this.docs.find((x) => x.id === id)!; Object.assign(d, patch); return this.c(d); }
  async deleteDoc(id: string) { this.docs = this.docs.filter((d) => d.id !== id); }
  async listStalePendingDocs(before: string) { return this.c(this.docs.filter((d) => d.status === "pending" && d.created_at < before)); }

  async listMessages(clientId: string) { return this.c(this.messages.filter((m) => m.client_id === clientId)); }
  async insertMessage(input: NewClientMessage) { const m: ClientMessage = { status: "logged", sent_to: null, provider_id: null, error: null, segments: null, ...this.c(input), id: randomUUID(), tenant_id: "t", created_at: this.at() }; this.messages.push(m); return this.c(m); }
  async listTasks(f: { clientId?: string; openOnly?: boolean } = {}) { return this.c(this.tasks.filter((t) => (!f.clientId || t.client_id === f.clientId) && (!f.openOnly || !t.done_at))); }
  async insertTask(input: Pick<ClientTask, "client_id" | "return_id" | "title" | "due_on" | "created_by">) { const t: ClientTask = { ...this.c(input), id: randomUUID(), tenant_id: "t", done_at: null, created_at: this.at() }; this.tasks.push(t); return this.c(t); }
  async updateTask(id: string, patch: Partial<Pick<ClientTask, "done_at">>) { const t = this.tasks.find((x) => x.id === id)!; Object.assign(t, patch); return this.c(t); }
  async listNotes(clientId: string) { return this.c(this.notes.filter((n) => n.client_id === clientId)); }
  async insertNote(input: Pick<ClientNote, "client_id" | "body" | "created_by">) { const n: ClientNote = { ...this.c(input), id: randomUUID(), tenant_id: "t", created_at: this.at() }; this.notes.push(n); return this.c(n); }

  async listInvoices(f: { clientId?: string; year?: number } = {}) { return this.c(this.invoices.filter((i) => (!f.clientId || i.client_id === f.clientId) && (!f.year || i.tax_year === f.year))); }
  async getInvoice(id: string) { return this.c(this.invoices.find((i) => i.id === id) ?? null); }
  async insertInvoice(input: InvoiceInsert) {
    if (this.invoices.some((i) => i.number === input.number)) throw new Error("duplicate key invoices_number_key");
    const i: Invoice = { ...this.c(input), id: randomUUID(), tenant_id: "t", paid_cents: 0, paid_on: null, created_at: this.at(), updated_at: this.at() };
    this.invoices.push(i); return this.c(i);
  }
  async updateInvoice(id: string, patch: Partial<Pick<Invoice, "status" | "lines" | "total_cents" | "paid_cents" | "paid_on" | "due_on" | "notes">>) { const i = this.invoices.find((x) => x.id === id)!; Object.assign(i, this.c(patch)); return this.c(i); }
  async nextInvoiceNumber() { const max = Math.max(0, ...this.invoices.map((i) => Number(i.number.replace(/\D/g, "")))); return `INV-${String(max + 1).padStart(4, "0")}`; }

  async insertImport(input: Pick<PaymentImport, "file_name" | "file_sha256" | "row_count" | "created_by">) { const p: PaymentImport = { ...this.c(input), id: randomUUID(), tenant_id: "t", status: "review", created_at: this.at(), applied_at: null }; this.imports.push(p); return this.c(p); }
  async getImport(id: string) { return this.c(this.imports.find((p) => p.id === id) ?? null); }
  async findImportByHash(sha: string) { return this.c(this.imports.find((p) => p.file_sha256 === sha) ?? null); }
  async listImports() { return this.c(this.imports); }
  async updateImport(id: string, patch: Partial<Pick<PaymentImport, "status" | "applied_at">>) { const p = this.imports.find((x) => x.id === id)!; Object.assign(p, patch); return this.c(p); }
  async insertImportRows(rows: PaymentRowInsert[]) { const out = rows.map((r): PaymentRow => ({ ...this.c(r), id: randomUUID(), tenant_id: "t", status: "pending", created_at: this.at() })); this.rows.push(...out); return this.c(out); }
  async listImportRows(importId: string) { return this.c(this.rows.filter((r) => r.import_id === importId).sort((a, b) => a.row_no - b.row_no)); }
  async updateImportRow(id: string, patch: Partial<Pick<PaymentRow, "invoice_id" | "amount_cents" | "match" | "status">>) { const r = this.rows.find((x) => x.id === id)!; Object.assign(r, patch); return this.c(r); }
}
