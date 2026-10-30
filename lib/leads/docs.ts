import { randomUUID } from "node:crypto";
import { CONTENT_TYPES, type DocumentFileType } from "../documents/files.ts";
import type { DocumentStore } from "../documents/types.ts";
import { ValidationError } from "../commerce/validation.ts";

// A lead's documents: the PDFs of forms the lead completed. They live under the lead until the lead becomes a client; then they
// move to the client's files and exist only there. Files are in the private tenant-documents bucket, in the tenant's own folder.

export type LeadDoc = { id: string; lead_id: string; title: string; file_path: string; file_type: string; size_bytes: number | null; form_submission_id: string | null; uploaded_by: string | null; created_at: string };

/** The rows this needs, so the rules can be tested without a database. */
export interface LeadDocsDb {
  listLeadDocs(leadId: string): Promise<LeadDoc[]>;
  getLeadDoc(id: string): Promise<LeadDoc | null>;
  deleteLeadDoc(id: string): Promise<void>;
  /** Whether this form submission's PDF is already among a client's documents. */
  clientHasSubmissionDoc(submissionId: string): Promise<boolean>;
  insertClientDoc(input: { client_id: string; title: string; file_path: string; file_type: string; size_bytes: number | null; form_submission_id: string | null; uploaded_by: string | null; created_at: string }): Promise<void>;
}
export type LeadDocsDeps = { tenantId: string; db: LeadDocsDb; files: DocumentStore };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const leadDocPath = (tenantId: string, leadId: string, id: string, type: string) => `${tenantId}/leads/${leadId}/${id}.${type}`;

/**
 * Moves every document of a lead into a client's files: the file is copied to the client's own folder, the client's record is
 * made, and only then is the lead's record (and old file) removed. A document already on the client (a retry after a partly
 * finished move) is just dropped from the lead. Afterwards the documents are under the client only, never under both.
 */
export async function moveLeadDocsToClient(deps: LeadDocsDeps, leadId: string, clientId: string): Promise<number> {
  if (!UUID.test(leadId) || !UUID.test(clientId)) throw new ValidationError("Choose a lead and a client.");
  let moved = 0;
  for (const doc of await deps.db.listLeadDocs(leadId)) {
    if (!doc.file_path.startsWith(`${deps.tenantId}/leads/${leadId}/`)) throw new Error("Refused: that file is not in this lead's folder.");
    if (doc.form_submission_id && (await deps.db.clientHasSubmissionDoc(doc.form_submission_id))) {
      await deps.db.deleteLeadDoc(doc.id);
      await deps.files.discard([doc.file_path]).catch(() => undefined);
      continue;
    }
    const bytes = await deps.files.download(doc.file_path);
    if (!bytes) throw new Error(`A lead document's file is missing from storage (${doc.title}).`);
    const type = doc.file_type as DocumentFileType;
    const path = `${deps.tenantId}/clients/${clientId}/${randomUUID()}.${type}`;
    await deps.files.upload(path, bytes, CONTENT_TYPES[type]);
    try {
      await deps.db.insertClientDoc({ client_id: clientId, title: doc.title, file_path: path, file_type: doc.file_type, size_bytes: doc.size_bytes, form_submission_id: doc.form_submission_id, uploaded_by: doc.uploaded_by, created_at: doc.created_at });
    } catch (e) {
      await deps.files.remove([path]).catch(() => undefined);
      throw e;
    }
    await deps.db.deleteLeadDoc(doc.id);
    await deps.files.discard([doc.file_path]).catch(() => undefined);
    moved++;
  }
  return moved;
}

/** A one-minute download link for a lead's document. */
export async function leadDocLink(deps: LeadDocsDeps, id: string): Promise<string> {
  const doc = UUID.test(id) ? await deps.db.getLeadDoc(id) : null;
  if (!doc) throw new ValidationError("That document wasn't found.");
  if (!doc.file_path.startsWith(`${deps.tenantId}/leads/${doc.lead_id}/`)) throw new Error("Refused: that file is not in this lead's folder.");
  return deps.files.signedUrl(doc.file_path, 60, `${doc.title.replace(/[^\w .-]+/g, "").slice(0, 80) || "document"}.${doc.file_type}`);
}

/** For deleting a lead (spam or a test entry): its documents go with it. */
export async function deleteLeadDocs(deps: LeadDocsDeps, leadId: string): Promise<void> {
  const docs = await deps.db.listLeadDocs(leadId);
  for (const d of docs) await deps.db.deleteLeadDoc(d.id);
  await deps.files.discard(docs.map((d) => d.file_path)).catch(() => undefined);
}
