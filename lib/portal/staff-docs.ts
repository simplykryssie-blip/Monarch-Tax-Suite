import { ValidationError } from "../commerce/validation.ts";
import type { PortalDocRequest } from "./documents.ts";

// Staff side of the document center: ask a client for a document, cancel the ask, and choose which documents the
// client sees. Nothing is shared by default.

export type StaffDoc = { id: string; client_id: string; title: string; file_type: string; status: "pending" | "stored"; source: "staff" | "client"; shared_with_client: boolean; created_at: string };

export interface PortalStaffRepo {
  insertRequest(input: { client_id: string; title: string; note: string | null; due_on: string | null; return_id: string | null; requested_by: string | null }): Promise<PortalDocRequest>;
  getRequest(id: string): Promise<(PortalDocRequest & { client_id: string }) | null>;
  setRequestStatus(id: string, status: "cancelled"): Promise<void>;
  listRequests(clientId: string): Promise<PortalDocRequest[]>;
  getDoc(id: string): Promise<StaffDoc | null>;
  setShared(id: string, shared: boolean): Promise<void>;
  listDocs(clientId: string): Promise<StaffDoc[]>;
  getReturnClient(returnId: string): Promise<string | null>;
  addAudit(input: { actor_id: string | null; action: string; subject_type: string; subject_id: string; detail?: Record<string, unknown> }): Promise<void>;
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function requestDocument(repo: PortalStaffRepo, clientId: string, raw: { title?: unknown; note?: unknown; due_on?: unknown; return_id?: unknown }, actorId: string | null): Promise<PortalDocRequest> {
  const title = clean(raw.title, 200);
  if (title.length < 2) throw new ValidationError("Say what you need, for example “2025 W-2”.");
  const due = clean(raw.due_on, 10);
  if (due && (!DATE.test(due) || Number.isNaN(Date.parse(due)))) throw new ValidationError("Enter the date as year-month-day.");
  let returnId: string | null = null;
  const r = clean(raw.return_id, 40);
  if (r) {
    if ((await repo.getReturnClient(r)) !== clientId) throw new ValidationError("That return isn't this client's.");
    returnId = r;
  }
  const req = await repo.insertRequest({ client_id: clientId, title, note: clean(raw.note, 1000) || null, due_on: due || null, return_id: returnId, requested_by: actorId });
  await repo.addAudit({ actor_id: actorId, action: "portal_doc_requested", subject_type: "portal_doc_request", subject_id: req.id, detail: { client_id: clientId } });
  return req;
}

export async function cancelRequest(repo: PortalStaffRepo, clientId: string, requestId: string, actorId: string | null): Promise<void> {
  const req = await repo.getRequest(requestId);
  if (!req || req.client_id !== clientId) throw new ValidationError("That request wasn't found.");
  if (req.status !== "open") throw new ValidationError("Only an open request can be cancelled.");
  await repo.setRequestStatus(requestId, "cancelled");
  await repo.addAudit({ actor_id: actorId, action: "portal_doc_request_cancelled", subject_type: "portal_doc_request", subject_id: requestId, detail: { client_id: clientId } });
}

/** Shows or hides one stored document in the client's portal. A client's own uploads are always theirs to see. */
export async function setDocShared(repo: PortalStaffRepo, clientId: string, docId: string, shared: boolean, actorId: string | null): Promise<void> {
  const doc = await repo.getDoc(docId);
  if (!doc || doc.client_id !== clientId || doc.status !== "stored") throw new ValidationError("That document wasn't found.");
  if (doc.source === "client") throw new ValidationError("This is the client's own upload; it always shows in their portal.");
  if (doc.shared_with_client === shared) return;
  await repo.setShared(docId, shared);
  await repo.addAudit({ actor_id: actorId, action: shared ? "portal_doc_shared" : "portal_doc_unshared", subject_type: "client_doc", subject_id: docId, detail: { client_id: clientId } });
}
