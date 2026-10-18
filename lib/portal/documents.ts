import { randomUUID } from "node:crypto";
import { ValidationError } from "../commerce/validation.ts";
import type { DocumentStore } from "../documents/types.ts";
import { checkPortalFile, cleanPortalName, MAX_PORTAL_UPLOAD_BYTES, PORTAL_CONTENT_TYPES } from "./files.ts";

// The portal document center for ONE client of ONE office: documents staff chose to share, requests for documents, and
// uploads. Every function acts on the client the deps name; a document, request or path of any other client is refused.

export type PortalDoc = {
  id: string; client_id: string; return_id: string | null; title: string; file_path: string; file_type: string; size_bytes: number | null;
  status: "pending" | "stored"; source: "staff" | "client"; shared_with_client: boolean; request_id: string | null; created_at: string;
};
export type PortalDocRequest = {
  id: string; client_id: string; return_id: string | null; title: string; note: string | null; due_on: string | null;
  status: "open" | "received" | "cancelled"; received_at: string | null; created_at: string;
};

/** Rows of one client. Every method is limited to `clientId` by the implementation. */
export interface PortalDocsRepo {
  clientId: string;
  /** Stored documents staff shared, and the client's own uploads. */
  listVisibleDocs(): Promise<PortalDoc[]>;
  getDoc(id: string): Promise<PortalDoc | null>;
  insertUpload(input: { id: string; title: string; file_path: string; file_type: string; size_bytes: number; request_id: string | null; return_id: string | null; uploaded_by: string }): Promise<PortalDoc>;
  markStored(id: string): Promise<PortalDoc>;
  deleteDoc(id: string): Promise<void>;
  countUploadsSince(sinceIso: string): Promise<number>;
  listRequests(status?: PortalDocRequest["status"]): Promise<PortalDocRequest[]>;
  getRequest(id: string): Promise<PortalDocRequest | null>;
  markRequestReceived(id: string, atIso: string): Promise<void>;
  /** A to-do for staff: "Review upload". */
  addReviewTask(title: string): Promise<void>;
}
export type PortalDocDeps = { tenantId: string; repo: PortalDocsRepo; store: DocumentStore; now?: () => Date };
const nowOf = (d: PortalDocDeps) => (d.now ? d.now() : new Date());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MAX_UPLOADS_PER_DAY = 40;
const ownFolder = (d: PortalDocDeps) => `${d.tenantId}/clients/${d.repo.clientId}/`;
const ownPath = (d: PortalDocDeps, path: string) => {
  if (!UUID.test(d.tenantId) || !path.startsWith(ownFolder(d)) || path.includes("..")) throw new Error("Refused: that file is not in this client's folder.");
  return path;
};

/** Starts a client upload: a pending record and a one-time upload link into the client's own folder. */
export async function startPortalUpload(d: PortalDocDeps, raw: { fileName: unknown; sizeBytes: unknown; title?: unknown; requestId?: unknown }, userId: string) {
  const size = Number(raw.sizeBytes);
  if (!Number.isFinite(size) || size <= 0) throw new ValidationError("Choose a file.");
  if (size > MAX_PORTAL_UPLOAD_BYTES) throw new ValidationError("Files can be at most 15 MB.");
  const { fileName, fileType } = cleanPortalName(String(raw.fileName ?? ""));
  if ((await d.repo.countUploadsSince(new Date(nowOf(d).getTime() - 86_400_000).toISOString())) >= MAX_UPLOADS_PER_DAY) throw new ValidationError("That's a lot of files for one day. Please try again tomorrow, or contact your tax office.");
  let requestId: string | null = null;
  let returnId: string | null = null;
  let requestTitle: string | null = null;
  if (typeof raw.requestId === "string" && raw.requestId) {
    const req = UUID.test(raw.requestId) ? await d.repo.getRequest(raw.requestId) : null;
    if (!req || req.status !== "open") throw new ValidationError("That request is no longer open.");
    requestId = req.id;
    returnId = req.return_id;
    requestTitle = req.title;
  }
  const title = (typeof raw.title === "string" ? raw.title.replace(/\s+/g, " ").trim().slice(0, 200) : "") || requestTitle || fileName.replace(/\.(pdf|jpe?g|png)$/i, "");
  const id = randomUUID();
  const file_path = `${ownFolder(d)}${id}.${fileType}`;
  const doc = await d.repo.insertUpload({ id, title, file_path, file_type: fileType, size_bytes: size, request_id: requestId, return_id: returnId, uploaded_by: userId });
  const { url } = await d.store.createUploadUrl(ownPath(d, file_path));
  return { doc, uploadUrl: url, contentType: PORTAL_CONTENT_TYPES[fileType] };
}

/** Checks what arrived, makes it count, closes the request it answers, and leaves staff a to-do. */
export async function finishPortalUpload(d: PortalDocDeps, id: string): Promise<PortalDoc> {
  const doc = UUID.test(id) ? await d.repo.getDoc(id) : null;
  if (!doc || doc.source !== "client") throw new ValidationError("That upload wasn't found.");
  if (doc.status === "stored") return doc;
  const bytes = await d.store.download(ownPath(d, doc.file_path));
  if (!bytes) throw new ValidationError("The upload didn't arrive. Try again.");
  if (bytes.byteLength !== doc.size_bytes) {
    await d.store.remove([ownPath(d, doc.file_path)]).catch(() => undefined);
    await d.repo.deleteDoc(doc.id);
    throw new ValidationError("The uploaded file's size doesn't match, so it was rejected. Try again.");
  }
  try {
    await checkPortalFile(bytes, doc.file_type as "pdf" | "jpg" | "png");
  } catch (e) {
    await d.store.remove([ownPath(d, doc.file_path)]).catch(() => undefined);
    await d.repo.deleteDoc(doc.id);
    throw e;
  }
  const stored = await d.repo.markStored(doc.id);
  if (doc.request_id) await d.repo.markRequestReceived(doc.request_id, nowOf(d).toISOString());
  await d.repo.addReviewTask(`Review upload from client: ${doc.title}`.slice(0, 200));
  return stored;
}

/** A one-minute link to a document the client may see (shared by staff, or uploaded by them). */
export async function portalDocLink(d: PortalDocDeps, id: string): Promise<string> {
  const doc = UUID.test(id) ? await d.repo.getDoc(id) : null;
  if (!doc || doc.status !== "stored" || !(doc.shared_with_client || doc.source === "client")) throw new ValidationError("That document wasn't found.");
  return d.store.signedUrl(ownPath(d, doc.file_path), 60, `${doc.title.replace(/[^\w .-]+/g, "").slice(0, 80) || "document"}.${doc.file_type}`);
}
