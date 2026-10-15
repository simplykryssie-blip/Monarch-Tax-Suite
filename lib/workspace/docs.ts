import { randomUUID } from "node:crypto";
import { checkDocumentFile, cleanDocumentName, CONTENT_TYPES, MAX_DOCUMENT_BYTES } from "../documents/files.ts";
import type { DocumentStore } from "../documents/types.ts";
import { ValidationError } from "../commerce/validation.ts";
import type { ClientDoc, WorkspaceRepo } from "./types.ts";

// A client's documents: uploaded straight to the private tenant-documents bucket under {tenant}/clients/{client}/ with
// a one-time link, then checked by content before they count. Downloads are one-minute links.

export type DocDeps = { tenantId: string; repo: WorkspaceRepo; store: DocumentStore };
const path = (d: DocDeps, clientId: string, id: string, type: string) => `${d.tenantId}/clients/${clientId}/${id}.${type}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function startClientDoc(d: DocDeps, raw: { clientId: unknown; title: unknown; fileName: unknown; sizeBytes: unknown; returnId?: unknown }, actorId: string) {
  const clientId = typeof raw.clientId === "string" && UUID.test(raw.clientId) ? raw.clientId : "";
  if (!clientId || !(await d.repo.getClient(clientId))) throw new ValidationError("That client wasn't found.");
  const size = Number(raw.sizeBytes);
  if (!Number.isFinite(size) || size <= 0) throw new ValidationError("Choose a file.");
  if (size > MAX_DOCUMENT_BYTES) throw new ValidationError("That file is larger than 25 MB.");
  const { fileName, fileType } = cleanDocumentName(String(raw.fileName ?? ""));
  const title = (typeof raw.title === "string" ? raw.title.replace(/\s+/g, " ").trim().slice(0, 200) : "") || fileName.replace(/\.(pdf|docx)$/i, "");
  let returnId: string | null = null;
  if (typeof raw.returnId === "string" && raw.returnId) {
    const r = UUID.test(raw.returnId) ? await d.repo.getReturn(raw.returnId) : null;
    if (!r || r.client_id !== clientId) throw new ValidationError("That return isn't this client's.");
    returnId = r.id;
  }
  const id = randomUUID();
  const file_path = path(d, clientId, id, fileType);
  const doc = await d.repo.insertDoc({ client_id: clientId, return_id: returnId, title, file_path, file_type: fileType, size_bytes: size, status: "pending", uploaded_by: actorId });
  const { url } = await d.store.createUploadUrl(file_path);
  return { doc, uploadUrl: url, contentType: CONTENT_TYPES[fileType] };
}

export async function finishClientDoc(d: DocDeps, id: string): Promise<ClientDoc> {
  const doc = UUID.test(id) ? await d.repo.getDoc(id) : null;
  if (!doc) throw new ValidationError("That upload wasn't found.");
  if (doc.status === "stored") return doc;
  if (!doc.file_path.startsWith(`${d.tenantId}/clients/`)) throw new ValidationError("Refused: that file is not in this account's folder.");
  const bytes = await d.store.download(doc.file_path);
  if (!bytes) throw new ValidationError("The upload didn't arrive. Try again.");
  try {
    await checkDocumentFile(bytes, doc.file_type as "pdf" | "docx");
  } catch (e) {
    await d.store.remove([doc.file_path]).catch(() => undefined);
    await d.repo.deleteDoc(doc.id);
    throw e;
  }
  return d.repo.updateDoc(doc.id, { status: "stored" });
}

export async function clientDocLink(d: DocDeps, id: string): Promise<string> {
  const doc = UUID.test(id) ? await d.repo.getDoc(id) : null;
  if (!doc || doc.status !== "stored") throw new ValidationError("That document wasn't found.");
  if (!doc.file_path.startsWith(`${d.tenantId}/clients/${doc.client_id}/`)) throw new ValidationError("Refused: that file is not in this client's folder.");
  return d.store.signedUrl(doc.file_path, 60, `${doc.title.replace(/[^\w .-]+/g, "").slice(0, 80) || "document"}.${doc.file_type}`);
}

export async function deleteClientDoc(d: DocDeps, id: string): Promise<void> {
  const doc = UUID.test(id) ? await d.repo.getDoc(id) : null;
  if (!doc) throw new ValidationError("That document wasn't found.");
  if (doc.file_path.startsWith(`${d.tenantId}/clients/${doc.client_id}/`)) await d.store.remove([doc.file_path]).catch(() => undefined);
  await d.repo.deleteDoc(doc.id);
}
