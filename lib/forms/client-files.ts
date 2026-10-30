import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FormDeps } from "./service.ts";
import type { FormRow, Submission } from "./types.ts";

/**
 * A finished form's PDF copied into a client's files. Through the client's personal link the client is certain, so it is shared
 * with their portal; matched only by the email typed into the form, it stays staff-only (anyone can type any email).
 * Done once per submission. The PDF is the one the form already made (answers, signature and the signing certificate).
 */
export async function saveFormToClient(db: SupabaseClient, deps: FormDeps, submission: Submission, form: FormRow, opts: { share?: boolean } = {}): Promise<void> {
  if (!submission.client_id || !submission.pdf_path || submission.is_test) return;
  const { data: existing, error: lookup } = await db.from("client_docs").select("id").eq("form_submission_id", submission.id).maybeSingle();
  if (lookup) throw new Error(`client file lookup failed: ${lookup.message}`);
  if (existing) return;
  const bytes = await deps.stores.pdfs.download(submission.pdf_path);
  if (!bytes) throw new Error("The form's PDF is not there yet.");
  const path = `${deps.tenantId}/clients/${submission.client_id}/${randomUUID()}.pdf`;
  await deps.stores.pdfs.upload(path, bytes, "application/pdf");
  const { error } = await db.from("client_docs").insert({
    client_id: submission.client_id, title: `${form.name} (completed)`.slice(0, 200), file_path: path, file_type: "pdf", size_bytes: bytes.byteLength,
    status: "stored", uploaded_by: null, source: "staff", shared_with_client: opts.share !== false, form_submission_id: submission.id,
  });
  if (error) {
    await deps.stores.pdfs.remove([path]).catch(() => undefined);
    throw new Error(`client file failed: ${error.message}`);
  }
}

/**
 * A finished form's PDF copied into a lead's documents (the respondent is a lead, not yet a client). Done once per submission.
 * When the lead becomes a client the documents move to the client and no longer live here (lib/leads/docs.ts).
 */
export async function saveFormToLead(db: SupabaseClient, deps: FormDeps, submission: Submission, form: FormRow, leadId: string): Promise<void> {
  if (!submission.pdf_path || submission.is_test) return;
  const { data: existing, error: lookup } = await db.from("lead_docs").select("id").eq("form_submission_id", submission.id).maybeSingle();
  if (lookup) throw new Error(`lead file lookup failed: ${lookup.message}`);
  if (existing) return;
  const bytes = await deps.stores.pdfs.download(submission.pdf_path);
  if (!bytes) throw new Error("The form's PDF is not there yet.");
  const path = `${deps.tenantId}/leads/${leadId}/${randomUUID()}.pdf`;
  await deps.stores.pdfs.upload(path, bytes, "application/pdf");
  const { error } = await db.from("lead_docs").insert({
    lead_id: leadId, title: `${form.name} (completed)`.slice(0, 200), file_path: path, file_type: "pdf", size_bytes: bytes.byteLength, status: "stored", form_submission_id: submission.id,
  });
  if (error) {
    await deps.stores.pdfs.remove([path]).catch(() => undefined);
    throw new Error(`lead file failed: ${error.message}`);
  }
}
