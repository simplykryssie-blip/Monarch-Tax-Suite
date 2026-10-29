import { randomUUID } from "node:crypto";
import type { Installment } from "../lib/workspace/plan.ts";
import type { Business, BusinessInput, Client, ClientDoc, ClientEvent, InvoiceLine, Spouse, SpouseInput, Dependent, DependentInput, ClientInput, ClientMessage, NewClientMessage, ClientNote, ClientReturn, ReturnDetails, StateFiling, StateFilingStatus, ClientTask, ClientWork, BillingSettings, InvoiceReceipt, ReceiptInsert, FeeProduct, FeeProductInput, WorkInput, Invoice, InvoiceInsert, PaymentImport, PaymentRow, PaymentRowInsert, ReturnInput, WorkspaceRepo } from "../lib/workspace/types.ts";

// The workspace in memory, with the database rules that matter: one original and one extension per client per year,
// unique invoice numbers. Returns copies.
export class MemoryWorkspace implements WorkspaceRepo {
  clients: Client[] = []; returns: ClientReturn[] = []; docs: ClientDoc[] = []; messages: ClientMessage[] = []; tasks: ClientTask[] = []; notes: ClientNote[] = [];
  invoices: Invoice[] = []; imports: PaymentImport[] = []; rows: PaymentRow[] = [];
  private c = <T>(v: T): T => structuredClone(v);
  private at = () => "2026-10-15T12:00:00.000Z";

  async listClients(f: { q?: string; includeArchived?: boolean; ownerId?: string; organizationId?: string } = {}) { return this.c(this.clients.filter((x) => (f.includeArchived || !x.archived_at) && (!f.ownerId || x.owner_id === f.ownerId) && (!f.organizationId || x.organization_id === f.organizationId) && (!f.q || [x.full_name, x.email, x.phone].some((v) => (v ?? "").toLowerCase().includes(f.q!.toLowerCase()))))); }
  async getClient(id: string) { return this.c(this.clients.find((x) => x.id === id) ?? null); }
  async insertClient(input: ClientInput & { created_by: string | null; owner_id?: string | null; organization_id?: string | null }) { const x: Client = { owner_id: null, organization_id: null, ...this.c(input), id: randomUUID(), tenant_id: "t", archived_at: null, created_at: this.at(), updated_at: this.at() }; this.clients.push(x); return this.c(x); }
  dependents: Dependent[] = []; businesses: Business[] = []; spouses: Spouse[] = []; events: (ClientEvent & { client_id: string })[] = []; fees: InvoiceLine[] | null = null;
  async getSpouse(clientId: string) { return this.c(this.spouses.find((s) => s.client_id === clientId) ?? null); }
  async upsertSpouse(input: SpouseInput) { const rest: Record<string, unknown> = { ...input }; delete rest.created_by; this.spouses = this.spouses.filter((s) => s.client_id !== input.client_id); const s = { ...this.c(rest) as unknown as Spouse, id: randomUUID(), tenant_id: "t", created_at: this.at() }; this.spouses.push(s); return this.c(s); }
  async deleteSpouse(clientId: string) { this.spouses = this.spouses.filter((s) => s.client_id !== clientId); }
  async getInvoiceDefaults() { return this.fees ? this.c(this.fees) : null; }
  async saveInvoiceDefaults(lines: InvoiceLine[]) { this.fees = this.c(lines); }
  installments: (Installment & { invoice_id: string })[] = [];
  async listInstallments(ids: string[]) { return this.c(this.installments.filter((p) => ids.includes(p.invoice_id))); }
  async replaceInstallments(invoiceId: string, plan: Installment[]) { this.installments = this.installments.filter((p) => p.invoice_id !== invoiceId).concat(plan.map((p) => ({ ...p, invoice_id: invoiceId }))); }
  receipts: InvoiceReceipt[] = [];
  async listReceipts(ids?: string[]) { return this.c(this.receipts.filter((r) => !ids || ids.includes(r.invoice_id))); }
  async insertReceipt(input: ReceiptInsert) { const r: InvoiceReceipt = { ...this.c(input), id: randomUUID(), tenant_id: "t", created_at: this.at() }; this.receipts.push(r); return this.c(r); }
  settings: BillingSettings | null = null; products: FeeProduct[] = [];
  async getBillingSettings() { return this.settings ? this.c(this.settings) : null; }
  async saveBillingSettings(s: BillingSettings) { this.settings = this.c(s); }
  async listFeeProducts() { return this.c(this.products.filter((p) => !p.archived_at)); }
  async insertFeeProduct(input: FeeProductInput & { created_by: string | null }) { const p: FeeProduct = { id: randomUUID(), tenant_id: "t", kind: input.kind, name: input.name, lines: this.c(input.lines), created_at: this.at(), archived_at: null }; this.products.push(p); return this.c(p); }
  async updateFeeProduct(id: string, patch: Partial<Pick<FeeProduct, "name" | "lines" | "archived_at">>) { const p = this.products.find((x) => x.id === id)!; Object.assign(p, this.c(patch)); return this.c(p); }
  async addClientEvent(e: { clientId: string; action: string; actorId: string | null; detail: Record<string, unknown> }) { this.events.push({ id: randomUUID(), client_id: e.clientId, action: e.action, actor_id: e.actorId, detail: e.detail, created_at: this.at() }); }
  async listClientEvents(clientId: string, limit: number) { return this.c(this.events.filter((e) => e.client_id === clientId).reverse().slice(0, limit)); }
  async mergeClients(keep: string, drop: string, actorId: string | null) {
    const k = this.clients.find((c) => c.id === keep); const d = this.clients.find((c) => c.id === drop);
    if (!k || !d || keep === drop) throw new Error("Choose two different clients.");
    const moved: Record<string, number> = {};
    const move = <T extends { client_id: string }>(rows: T[], name: string) => { let n = 0; for (const r of rows) if (r.client_id === drop) { r.client_id = keep; n++; } moved[name] = n; };
    const clash = (r: ClientReturn) => this.returns.some((x) => x.client_id === keep && x.tax_year === r.tax_year && x.kind === r.kind && r.kind !== "amendment" && !x.archived_at && !r.archived_at);
    let rn = 0; for (const r of this.returns) if (r.client_id === drop && !clash(r)) { r.client_id = keep; rn++; } moved.returns = rn;
    move(this.docs, "documents"); move(this.messages, "messages"); move(this.tasks, "tasks"); move(this.notes, "notes"); move(this.dependents, "dependents"); move(this.businesses, "businesses");
    if (k.spouse_id === drop) k.spouse_id = null; if (d.spouse_id === keep) d.spouse_id = null;
    for (const key of ["email", "phone", "ssn_last4", "address", "dob"] as const) if (!k[key] && d[key]) (k as Record<string, unknown>)[key] = d[key];
    d.archived_at = d.archived_at ?? this.at();
    this.events.push({ id: randomUUID(), client_id: keep, action: "client.merged", actor_id: actorId, detail: { merged_name: d.full_name, merged_id: drop, moved }, created_at: this.at() });
    return moved;
  }
  async listDependents(clientId: string) { return this.c(this.dependents.filter((d) => d.client_id === clientId)); }
  async insertDependent(input: DependentInput) { const rest: Record<string, unknown> = { ...input }; delete rest.created_by; const d = { ...this.c(rest) as unknown as Dependent, id: randomUUID(), tenant_id: "t", created_at: this.at() }; this.dependents.push(d); return this.c(d); }
  async deleteDependent(id: string) { this.dependents = this.dependents.filter((d) => d.id !== id); }
  async listBusinesses(clientId: string) { return this.c(this.businesses.filter((b) => b.client_id === clientId)); }
  async insertBusiness(input: BusinessInput) { const rest: Record<string, unknown> = { ...input }; delete rest.created_by; const b = { ...this.c(rest) as unknown as Business, id: randomUUID(), tenant_id: "t", created_at: this.at() }; this.businesses.push(b); return this.c(b); }
  async deleteBusiness(id: string) { this.businesses = this.businesses.filter((b) => b.id !== id); }
  async updateClient(id: string, patch: Partial<ClientInput> & { archived_at?: string | null; spouse_id?: string | null; tags?: string[]; owner_id?: string | null }) { const x = this.clients.find((y) => y.id === id)!; Object.assign(x, this.c(patch)); return this.c(x); }

  stateFilings: StateFiling[] = [];
  async listStateFilings(returnId: string) { return this.c(this.stateFilings.filter((x) => x.return_id === returnId).sort((a, b) => a.state.localeCompare(b.state))); }
  async saveStateFiling(returnId: string, state: string, status: StateFilingStatus, filedOn: string | null) {
    const hit = this.stateFilings.find((x) => x.return_id === returnId && x.state === state);
    if (hit) { hit.status = status; hit.filed_on = filedOn; return this.c(hit); }
    const x: StateFiling = { id: randomUUID(), tenant_id: "t", return_id: returnId, state, status, filed_on: filedOn, created_at: this.at() };
    this.stateFilings.push(x);
    return this.c(x);
  }
  async removeStateFiling(id: string) { this.stateFilings = this.stateFilings.filter((x) => x.id !== id); }
  async listReturns(f: { year?: number; clientId?: string; includeArchived?: boolean; assigneeId?: string; organizationId?: string } = {}) { return this.c(this.returns.filter((r) => (f.includeArchived || !r.archived_at) && (!f.assigneeId || r.assignee_id === f.assigneeId) && (!f.organizationId || r.organization_id === f.organizationId) && (!f.year || r.tax_year === f.year) && (!f.clientId || r.client_id === f.clientId))); }
  work: ClientWork[] = [];
  async listWork(f: { clientId?: string; pipelineId?: string } = {}) { return this.c(this.work.filter((w) => !w.archived_at && (!f.clientId || w.client_id === f.clientId) && (!f.pipelineId || w.pipeline_id === f.pipelineId))); }
  async getWork(id: string) { return this.c(this.work.find((w) => w.id === id) ?? null); }
  async insertWork(input: WorkInput & { created_by: string | null; assignee_id?: string | null }) { const w: ClientWork = { assignee_id: null, ...this.c(input), id: randomUUID(), tenant_id: "t", created_at: this.at(), archived_at: null }; this.work.push(w); return this.c(w); }
  async updateWork(id: string, patch: Partial<Pick<ClientWork, "stage_id" | "title" | "due_on" | "notes" | "assignee_id" | "archived_at">>) { const w = this.work.find((x) => x.id === id)!; Object.assign(w, this.c(patch)); return this.c(w); }
  async getReturn(id: string) { return this.c(this.returns.find((r) => r.id === id) ?? null); }
  async insertReturn(input: ReturnInput & { assignee_id?: string | null; organization_id?: string | null }) {
    if (input.kind !== "amendment" && this.returns.some((r) => !r.archived_at && r.client_id === input.client_id && r.tax_year === input.tax_year && r.kind === input.kind)) throw new Error('duplicate key value violates unique constraint "client_returns_one_per_year"');
    const r: ClientReturn = { assignee_id: null, organization_id: null, prep_status: "not_started", handed_off_at: null, ...this.c(input), id: randomUUID(), tenant_id: "t", filed_on: null, archived_at: null, created_at: this.at(), updated_at: this.at() };
    this.returns.push(r); return this.c(r);
  }
  async updateReturn(id: string, patch: Partial<Pick<ClientReturn, "stage_id" | "due_on" | "filed_on" | "notes" | "archived_at" | "assignee_id" | "prep_status" | "handed_off_at">> & ReturnDetails) { const r = this.returns.find((x) => x.id === id)!; Object.assign(r, this.c(patch)); return this.c(r); }

  async listDocs(clientId: string) { return this.c(this.docs.filter((d) => d.client_id === clientId && d.status === "stored")); }
  async getDoc(id: string) { return this.c(this.docs.find((d) => d.id === id) ?? null); }
  async insertDoc(input: Omit<ClientDoc, "id" | "tenant_id" | "created_at">) { const d: ClientDoc = { ...this.c(input), id: randomUUID(), tenant_id: "t", created_at: this.at() }; this.docs.push(d); return this.c(d); }
  async updateDoc(id: string, patch: Partial<Pick<ClientDoc, "status" | "folder_id">>) { const d = this.docs.find((x) => x.id === id)!; Object.assign(d, patch); return this.c(d); }
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
  async updateInvoice(id: string, patch: Partial<Pick<Invoice, "status" | "lines" | "total_cents" | "paid_cents" | "paid_on" | "due_on" | "notes" | "tax_year" | "tax_cents" | "payer" | "archived_at">>) { const i = this.invoices.find((x) => x.id === id)!; Object.assign(i, this.c(patch)); return this.c(i); }
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
