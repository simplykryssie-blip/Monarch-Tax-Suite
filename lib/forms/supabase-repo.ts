import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "../commerce/supabase-repo.ts";
import type { FirmsRepo, FormEvent, FormRow, FormsRepo, FormVersion, Submission, SubmissionPatch, SubmissionQuery, SubmissionStatus, UploadRow } from "./types.ts";

export const UPLOAD_BUCKET = "tenant-form-uploads";

/** Form tables, on a tenant-scoped client: row-level security limits every call to that tenant's rows. */
export class SupabaseFormsRepo implements FormsRepo {
  constructor(private db: SupabaseClient) {}

  async listForms() {
    return unwrap(await this.db.from("forms").select("*").order("updated_at", { ascending: false })) as FormRow[];
  }
  async getForm(id: string) {
    return unwrap(await this.db.from("forms").select("*").eq("id", id).maybeSingle()) as FormRow | null;
  }
  async getFormByPublicId(publicId: string) {
    return unwrap(await this.db.from("forms").select("*").eq("public_id", publicId).maybeSingle()) as FormRow | null;
  }
  async insertForm(input: Partial<FormRow>) {
    return unwrap(await this.db.from("forms").insert(input).select("*").single()) as FormRow;
  }
  async updateForm(id: string, patch: Partial<FormRow>) {
    return unwrap(await this.db.from("forms").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select("*").single()) as FormRow;
  }
  async deleteForm(id: string) {
    unwrap(await this.db.from("forms").delete().eq("id", id));
  }
  async takeNumber(formId: string) {
    const { data, error } = await this.db.rpc("form_take_number", { p_form: formId });
    if (error) throw new Error(error.message);
    const n = Number(data);
    if (!Number.isInteger(n) || n < 1) throw new Error("Could not number the submission.");
    return n;
  }

  async insertVersion(input: Pick<FormVersion, "form_id" | "version" | "definition" | "published_by">) {
    return unwrap(await this.db.from("form_versions").insert(input).select("*").single()) as FormVersion;
  }
  async getVersion(id: string) {
    return unwrap(await this.db.from("form_versions").select("*").eq("id", id).maybeSingle()) as FormVersion | null;
  }
  async listVersions(formId: string) {
    return unwrap(await this.db.from("form_versions").select("*").eq("form_id", formId).order("version", { ascending: false })) as FormVersion[];
  }

  async insertSubmission(input: Partial<Submission>) {
    return unwrap(await this.db.from("form_submissions").insert(input).select("*").single()) as Submission;
  }
  async getSubmission(id: string) {
    return unwrap(await this.db.from("form_submissions").select("*").eq("id", id).maybeSingle()) as Submission | null;
  }
  async findDraftByTokenHash(hash: string) {
    return unwrap(await this.db.from("form_submissions").select("*").eq("draft_token_hash", hash).maybeSingle()) as Submission | null;
  }
  async transitionSubmission(id: string, from: SubmissionStatus[], patch: SubmissionPatch) {
    const rows = unwrap(await this.db.from("form_submissions").update(patch).eq("id", id).in("status", from).select("*")) as Submission[];
    return rows[0] ?? null;
  }
  async updateSubmission(id: string, patch: SubmissionPatch) {
    return unwrap(await this.db.from("form_submissions").update(patch).eq("id", id).select("*").single()) as Submission;
  }
  async listSubmissions(formId: string, q: SubmissionQuery) {
    let query = this.db.from("form_submissions").select("*", { count: "exact" }).eq("form_id", formId);
    if (q.status && q.status !== "all") query = query.eq("status", q.status);
    else query = query.neq("status", "draft");
    if (!q.includeTests) query = query.eq("is_test", false);
    const term = (q.search ?? "").replace(/[%,()_\\]/g, " ").trim().slice(0, 80);
    if (term) query = query.or(`respondent_name.ilike.%${term}%,respondent_email.ilike.%${term}%`);
    const from = q.offset ?? 0;
    const { data, error, count } = await query.order("number", { ascending: false, nullsFirst: false }).range(from, from + q.limit - 1);
    if (error) throw new Error(error.message);
    return { rows: (data ?? []) as Submission[], total: count ?? 0 };
  }
  async listSubmissionsForCustomer(customerId: string) {
    return unwrap(await this.db.from("form_submissions").select("*").eq("customer_id", customerId).neq("status", "draft").order("submitted_at", { ascending: false }).limit(100)) as Submission[];
  }
  async countSubmitted(formId: string) {
    const { count, error } = await this.db.from("form_submissions").select("id", { count: "exact", head: true }).eq("form_id", formId).eq("is_test", false).in("status", ["new", "in_review", "done"]);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }
  async listDueDrafts(nowIso: string, limit: number) {
    return unwrap(await this.db.from("form_submissions").select("*").eq("status", "draft").lt("draft_expires_at", nowIso).limit(limit)) as Submission[];
  }
  async listPendingPdfs(limit: number) {
    return unwrap(await this.db.from("form_submissions").select("*").in("status", ["new", "in_review", "done"]).is("pdf_path", null).lt("pdf_attempts", 5).order("created_at", { ascending: true }).limit(limit)) as Submission[];
  }
  async listUnnotified(sinceIso: string, limit: number) {
    return unwrap(await this.db.from("form_submissions").select("*").in("status", ["new", "in_review", "done"]).eq("is_test", false).is("notified_at", null).gte("submitted_at", sinceIso).limit(limit)) as Submission[];
  }
  async deleteSubmissions(ids: string[]) {
    if (!ids.length) return;
    unwrap(await this.db.from("form_submissions").delete().in("id", ids).in("status", ["draft", "spam"]));
  }
  async listSpam(formId: string, limit: number) {
    return unwrap(await this.db.from("form_submissions").select("*").eq("form_id", formId).eq("status", "spam").limit(limit)) as Submission[];
  }

  async insertUpload(input: Partial<UploadRow>) {
    return unwrap(await this.db.from("form_uploads").insert(input).select("*").single()) as UploadRow;
  }
  async getUpload(id: string) {
    return unwrap(await this.db.from("form_uploads").select("*").eq("id", id).maybeSingle()) as UploadRow | null;
  }
  async listUploads(submissionId: string) {
    return unwrap(await this.db.from("form_uploads").select("*").eq("submission_id", submissionId).order("created_at", { ascending: true })) as UploadRow[];
  }
  async updateUpload(id: string, patch: Partial<UploadRow>) {
    return unwrap(await this.db.from("form_uploads").update(patch).eq("id", id).select("*").single()) as UploadRow;
  }
  async deleteUploads(ids: string[]) {
    if (!ids.length) return;
    unwrap(await this.db.from("form_uploads").delete().in("id", ids));
  }

  async listInternalValues(submissionId: string) {
    const rows = unwrap(await this.db.from("form_internal_values").select("field_key, value").eq("submission_id", submissionId)) as { field_key: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.field_key, r.value]));
  }
  async setInternalValue(submissionId: string, fieldKey: string, value: string, userId: string | null) {
    if (!value) {
      unwrap(await this.db.from("form_internal_values").delete().eq("submission_id", submissionId).eq("field_key", fieldKey));
      return;
    }
    unwrap(await this.db.from("form_internal_values").upsert({ submission_id: submissionId, field_key: fieldKey, value, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "submission_id,field_key" }));
  }

  async addEvent(input: Omit<FormEvent, "id" | "created_at">) {
    unwrap(await this.db.from("form_events").insert(input));
  }
  async listEvents(submissionId: string, limit: number) {
    return unwrap(await this.db.from("form_events").select("*").eq("submission_id", submissionId).order("created_at", { ascending: false }).limit(limit)) as FormEvent[];
  }

  async latestPaidOrderId(customerId: string) {
    const rows = unwrap(await this.db.from("orders").select("id").eq("customer_id", customerId).eq("payment_status", "paid").order("paid_at", { ascending: false, nullsFirst: false }).limit(1)) as { id: string }[];
    return rows[0]?.id ?? null;
  }
}

/** Firms in My Service Bureau, on the same tenant-scoped client. */
export class SupabaseFirmsRepo implements FirmsRepo {
  constructor(private db: SupabaseClient) {}
  async findForCustomer(customerId: string) {
    const rows = unwrap(await this.db.from("organizations").select("id, legal_name").eq("customer_id", customerId).is("archived_at", null).order("created_at", { ascending: true }).limit(1)) as { id: string; legal_name: string }[];
    return rows[0] ?? null;
  }
  async findByEfinHash(hash: string) {
    const efin = unwrap(await this.db.from("efin_records").select("organization_id").eq("efin_hash", hash).is("archived_at", null).limit(1)) as { organization_id: string }[];
    if (!efin[0]) return null;
    return unwrap(await this.db.from("organizations").select("id, legal_name, customer_id").eq("id", efin[0].organization_id).maybeSingle()) as { id: string; legal_name: string; customer_id: string | null } | null;
  }
  async linkCustomer(organizationId: string, customerId: string) {
    unwrap(await this.db.from("organizations").update({ customer_id: customerId }).eq("id", organizationId).is("customer_id", null));
  }
  async create(payload: Record<string, unknown>) {
    const { data, error } = await this.db.rpc("firm_from_submission", { p: payload });
    if (error) throw new Error(`${error.code ?? ""} ${error.message}`.trim());
    return String(data);
  }
}
