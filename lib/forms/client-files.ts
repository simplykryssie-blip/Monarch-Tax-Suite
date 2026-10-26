import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FormDeps } from "./service.ts";
import type { FormRow, Submission } from "./types.ts";

/**
 * A form filled in through a client's personal link: its PDF is copied into that client's files, shared with their portal.
 * Done once per submission. The PDF is the one the form already made (answers, signature and the signing certificate).
 */
export async function saveFormToClient(db: SupabaseClient, deps: FormDeps, submission: Submission, form: FormRow): Promise<void> {
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
    status: "stored", uploaded_by: null, source: "staff", shared_with_client: true, form_submission_id: submission.id,
  });
  if (error) {
    await deps.stores.pdfs.remove([path]).catch(() => undefined);
    throw new Error(`client file failed: ${error.message}`);
  }
}
