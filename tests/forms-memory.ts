import { randomUUID } from "node:crypto";
import type { FirmsRepo, FormEvent, FormRow, FormsRepo, FormVersion, Submission, SubmissionPatch, SubmissionQuery, SubmissionStatus, UploadRow } from "../lib/forms/types.ts";

/**
 * One tenant's form rows in memory. Mirrors the database rules that matter here: answers lock once submitted,
 * only drafts and spam can be deleted, versions never change, and numbers are taken atomically. (The database's
 * tenant scoping is tested separately in SQL.)
 */
export class MemoryFormsRepo implements FormsRepo {
  forms: FormRow[] = [];
  versions: FormVersion[] = [];
  submissions: Submission[] = [];
  uploads: UploadRow[] = [];
  events: FormEvent[] = [];
  orders: { id: string; customer_id: string; paid_at: string }[] = [];
  tenantId: string;
  constructor(tenantId: string) {
    this.tenantId = tenantId;
  }
  private now = () => new Date().toISOString();
  private c = <T>(v: T): T => structuredClone(v);

  async listForms() { return this.c(this.forms); }
  async getForm(id: string) { return this.c(this.forms.find((f) => f.id === id) ?? null); }
  async getFormByPublicId(p: string) { return this.c(this.forms.find((f) => f.public_id === p) ?? null); }
  async insertForm(input: Partial<FormRow>) {
    const f = { description: null, status: "draft", draft_updated_at: null, current_version_id: null, signature_consent: null, submission_seq: 0, ...input, id: randomUUID(), tenant_id: this.tenantId, created_at: this.now(), updated_at: this.now() } as FormRow;
    this.forms.push(f);
    return this.c(f);
  }
  async updateForm(id: string, patch: Partial<FormRow>) { const f = this.forms.find((x) => x.id === id)!; Object.assign(f, this.c(patch), { updated_at: this.now() }); return this.c(f); }
  async deleteFormWithSubmissions(id: string) {
    if (!this.forms.some((f) => f.id === id)) throw new Error("FORM_NOT_FOUND");
    const gone = this.submissions.filter((s) => s.form_id === id).map((s) => s.id);
    this.submissions = this.submissions.filter((s) => s.form_id !== id);
    this.uploads = this.uploads.filter((u) => !gone.includes(u.submission_id));
    this.forms = this.forms.filter((f) => f.id !== id);
    this.versions = this.versions.filter((v) => v.form_id !== id);
    return gone.length;
  }
  async formFiles(formId: string) {
    const subs = this.submissions.filter((s) => s.form_id === formId);
    return { uploads: this.uploads.filter((u) => subs.some((s) => s.id === u.submission_id)).map((u) => u.storage_path), pdfs: subs.map((s) => s.pdf_path).filter((p): p is string => !!p) };
  }
  async deleteForm(id: string) {
    if (this.submissions.some((s) => s.form_id === id)) throw new Error("violates foreign key constraint");
    this.forms = this.forms.filter((f) => f.id !== id);
    this.versions = this.versions.filter((v) => v.form_id !== id);
  }
  async takeNumber(formId: string) { const f = this.forms.find((x) => x.id === formId)!; f.submission_seq += 1; return f.submission_seq; }

  async insertVersion(input: Pick<FormVersion, "form_id" | "version" | "definition" | "published_by">) {
    if (this.versions.some((v) => v.form_id === input.form_id && v.version === input.version)) throw new Error("duplicate key");
    const v: FormVersion = { ...this.c(input), id: randomUUID(), tenant_id: this.tenantId, published_at: this.now() };
    this.versions.push(v);
    return this.c(v);
  }
  async getVersion(id: string) { return this.c(this.versions.find((v) => v.id === id) ?? null); }
  async listVersions(formId: string) { return this.c(this.versions.filter((v) => v.form_id === formId).sort((a, b) => b.version - a.version)); }

  async insertSubmission(input: Partial<Submission>) {
    const s = {
      number: null, respondent_email: null, respondent_name: null, customer_id: null, organization_id: null, firm_status: "none", firm_error: null,
      draft_token_hash: null, draft_expires_at: null, resume_email: null, resume_sent_at: null, submitted_at: null, ip_hash: null, user_agent: null,
      consent_text: null, consented_at: null, signature: null, pdf_path: null, pdf_sha256: null, pdf_generated_at: null, pdf_attempts: 0, pdf_error: null,
      receipt_token_hash: null, receipt_expires_at: null, notified_at: null, notify_error: null, confirmation_sent_at: null, spam_reason: null,
      ...this.c(input), tenant_id: this.tenantId, created_at: this.now(), updated_at: this.now(),
    } as Submission;
    if (this.submissions.some((x) => x.id === s.id)) throw new Error("duplicate key");
    this.submissions.push(s);
    return this.c(s);
  }
  async getSubmission(id: string) { return this.c(this.submissions.find((s) => s.id === id) ?? null); }
  async findDraftByTokenHash(h: string) { return this.c(this.submissions.find((s) => s.draft_token_hash === h) ?? null); }
  private guard(s: Submission, patch: SubmissionPatch) {
    if (s.status === "draft") return;
    if (patch.status === "draft") throw new Error("SUBMISSION_LOCKED");
    for (const k of ["answers", "version_id", "number", "submitted_at", "started_at", "signature", "consent_text", "consented_at", "is_test"] as const) {
      if (k in patch && JSON.stringify(patch[k]) !== JSON.stringify(s[k])) throw new Error("SUBMISSION_LOCKED: answers cannot be changed after submission");
    }
  }
  async transitionSubmission(id: string, from: SubmissionStatus[], patch: SubmissionPatch) {
    const s = this.submissions.find((x) => x.id === id);
    if (!s || !from.includes(s.status)) return null;
    this.guard(s, patch);
    Object.assign(s, this.c(patch), { updated_at: this.now() });
    return this.c(s);
  }
  async updateSubmission(id: string, patch: SubmissionPatch) {
    const s = this.submissions.find((x) => x.id === id)!;
    this.guard(s, patch);
    Object.assign(s, this.c(patch), { updated_at: this.now() });
    return this.c(s);
  }
  async listSubmissions(formId: string, q: SubmissionQuery) {
    let rows = this.submissions.filter((s) => s.form_id === formId && (q.status && q.status !== "all" ? s.status === q.status : s.status !== "draft") && (q.includeTests || !s.is_test));
    const term = (q.search ?? "").toLowerCase();
    if (term) rows = rows.filter((s) => `${s.respondent_name ?? ""} ${s.respondent_email ?? ""}`.toLowerCase().includes(term));
    rows.sort((a, b) => (b.number ?? 0) - (a.number ?? 0));
    return { rows: this.c(rows.slice(q.offset ?? 0, (q.offset ?? 0) + q.limit)), total: rows.length };
  }
  async listSubmissionsForCustomer(customerId: string) { return this.c(this.submissions.filter((s) => s.customer_id === customerId && s.status !== "draft")); }
  async countSubmitted(formId: string) { return this.submissions.filter((s) => s.form_id === formId && !s.is_test && ["new", "in_review", "done"].includes(s.status)).length; }
  async listDueDrafts(nowIso: string, limit: number) { return this.c(this.submissions.filter((s) => s.status === "draft" && s.draft_expires_at && s.draft_expires_at < nowIso).slice(0, limit)); }
  async listPendingPdfs(limit: number) { return this.c(this.submissions.filter((s) => ["new", "in_review", "done"].includes(s.status) && !s.pdf_path && s.pdf_attempts < 5).slice(0, limit)); }
  async listUnnotified(sinceIso: string, limit: number) { return this.c(this.submissions.filter((s) => ["new", "in_review", "done"].includes(s.status) && !s.is_test && !s.notified_at && (s.submitted_at ?? "") >= sinceIso).slice(0, limit)); }
  async deleteSubmissions(ids: string[]) {
    for (const id of ids) {
      const s = this.submissions.find((x) => x.id === id);
      if (s && s.status !== "draft" && s.status !== "spam") throw new Error("SUBMISSION_KEPT: submitted forms cannot be deleted");
    }
    this.submissions = this.submissions.filter((s) => !ids.includes(s.id));
    this.uploads = this.uploads.filter((u) => !ids.includes(u.submission_id));
  }
  async listSpam(formId: string, limit: number) { return this.c(this.submissions.filter((s) => s.form_id === formId && s.status === "spam").slice(0, limit)); }

  async insertUpload(input: Partial<UploadRow>) {
    const u = { sha256: null, status: "pending", ...this.c(input), id: randomUUID(), tenant_id: this.tenantId, created_at: this.now() } as UploadRow;
    this.uploads.push(u);
    return this.c(u);
  }
  async getUpload(id: string) { return this.c(this.uploads.find((u) => u.id === id) ?? null); }
  async listUploads(submissionId: string) { return this.c(this.uploads.filter((u) => u.submission_id === submissionId)); }
  async updateUpload(id: string, patch: Partial<UploadRow>) { const u = this.uploads.find((x) => x.id === id)!; Object.assign(u, patch); return this.c(u); }
  async deleteUploads(ids: string[]) { this.uploads = this.uploads.filter((u) => !ids.includes(u.id)); }

  internal = new Map<string, string>();
  async listInternalValues(submissionId: string) {
    return Object.fromEntries([...this.internal].filter(([k]) => k.startsWith(`${submissionId}:`)).map(([k, v]) => [k.slice(submissionId.length + 1), v]));
  }
  async setInternalValue(submissionId: string, fieldKey: string, value: string) {
    if (value) this.internal.set(`${submissionId}:${fieldKey}`, value);
    else this.internal.delete(`${submissionId}:${fieldKey}`);
  }
  async addEvent(input: Omit<FormEvent, "id" | "created_at">) { this.events.push({ ...this.c(input), id: randomUUID(), created_at: this.now() }); }
  async listEvents(submissionId: string, limit: number) { return this.c(this.events.filter((e) => e.submission_id === submissionId).slice(-limit).reverse()); }
  async latestPaidOrderId(customerId: string) { return this.orders.filter((o) => o.customer_id === customerId).sort((a, b) => b.paid_at.localeCompare(a.paid_at))[0]?.id ?? null; }
}

/** Firms as the database function would record them (only what the tests look at). */
export class MemoryFirms implements FirmsRepo {
  orgs: { id: string; legal_name: string; customer_id: string | null; efin_hash: string | null; payload: Record<string, unknown> }[] = [];
  ptinHashes = new Set<string>();
  async findForCustomer(customerId: string) { const o = this.orgs.find((x) => x.customer_id === customerId); return o ? { id: o.id, legal_name: o.legal_name } : null; }
  async findByEfinHash(hash: string) { const o = this.orgs.find((x) => x.efin_hash === hash); return o ? { id: o.id, legal_name: o.legal_name, customer_id: o.customer_id } : null; }
  async linkCustomer(id: string, customerId: string) { const o = this.orgs.find((x) => x.id === id)!; o.customer_id ??= customerId; }
  async create(p: Record<string, unknown>) {
    const people = (p.people as { ptin_hash: string | null }[]) ?? [];
    for (const person of people) if (person.ptin_hash && this.ptinHashes.has(person.ptin_hash)) throw new Error('23505 duplicate key value violates unique constraint "professional_credentials_unique"');
    for (const person of people) if (person.ptin_hash) this.ptinHashes.add(person.ptin_hash);
    const efin = p.efin as { efin_hash: string } | null;
    this.orgs.push({ id: p.org_id as string, legal_name: p.legal_name as string, customer_id: (p.customer_id as string | null) ?? null, efin_hash: efin?.efin_hash ?? null, payload: p });
    return p.org_id as string;
  }
}
