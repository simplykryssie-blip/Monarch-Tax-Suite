import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "../commerce/supabase-repo.ts";
import type { PortalDoc, PortalDocRequest, PortalDocsRepo } from "./documents.ts";
import type { PortalStaffRepo, StaffDoc } from "./staff-docs.ts";

const DOC_COLUMNS = "id, client_id, return_id, title, file_path, file_type, size_bytes, status, source, shared_with_client, request_id, created_at";
const REQUEST_COLUMNS = "id, client_id, return_id, title, note, due_on, status, received_at, created_at";

/** Document rows of one client of one office. Every query names the client. */
export class SupabasePortalDocsRepo implements PortalDocsRepo {
  clientId: string;
  private db: SupabaseClient;
  constructor(db: SupabaseClient, clientId: string) {
    this.db = db;
    this.clientId = clientId;
  }
  async listVisibleDocs() {
    return unwrap(await this.db.from("client_docs").select(DOC_COLUMNS).eq("client_id", this.clientId).eq("status", "stored").or("shared_with_client.eq.true,source.eq.client").order("created_at", { ascending: false }).limit(200)) as PortalDoc[];
  }
  async getDoc(id: string) {
    return unwrap(await this.db.from("client_docs").select(DOC_COLUMNS).eq("client_id", this.clientId).eq("id", id).maybeSingle()) as PortalDoc | null;
  }
  async insertUpload(input: Parameters<PortalDocsRepo["insertUpload"]>[0]) {
    return unwrap(await this.db.from("client_docs").insert({ ...input, client_id: this.clientId, status: "pending", source: "client", shared_with_client: true }).select(DOC_COLUMNS).single()) as PortalDoc;
  }
  async markStored(id: string) {
    return unwrap(await this.db.from("client_docs").update({ status: "stored" }).eq("client_id", this.clientId).eq("id", id).select(DOC_COLUMNS).single()) as PortalDoc;
  }
  async deleteDoc(id: string) {
    unwrap(await this.db.from("client_docs").delete().eq("client_id", this.clientId).eq("id", id).eq("source", "client").eq("status", "pending"));
  }
  async countUploadsSince(sinceIso: string) {
    const { count, error } = await this.db.from("client_docs").select("id", { count: "exact", head: true }).eq("client_id", this.clientId).eq("source", "client").gte("created_at", sinceIso);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }
  async listRequests(status?: PortalDocRequest["status"]) {
    let q = this.db.from("portal_doc_requests").select(REQUEST_COLUMNS).eq("client_id", this.clientId).neq("status", "cancelled").order("created_at", { ascending: false }).limit(100);
    if (status) q = q.eq("status", status);
    return unwrap(await q) as PortalDocRequest[];
  }
  async getRequest(id: string) {
    return unwrap(await this.db.from("portal_doc_requests").select(REQUEST_COLUMNS).eq("client_id", this.clientId).eq("id", id).maybeSingle()) as PortalDocRequest | null;
  }
  async markRequestReceived(id: string, atIso: string) {
    unwrap(await this.db.from("portal_doc_requests").update({ status: "received", received_at: atIso }).eq("client_id", this.clientId).eq("id", id).eq("status", "open"));
  }
  async addReviewTask(title: string) {
    unwrap(await this.db.from("client_tasks").insert({ client_id: this.clientId, title, created_by: null }));
  }
}


/** Staff-side document rows, on the office's tenant client. */
export class SupabasePortalStaffRepo implements PortalStaffRepo {
  private db: SupabaseClient;
  constructor(db: SupabaseClient) {
    this.db = db;
  }
  async insertRequest(input: Parameters<PortalStaffRepo["insertRequest"]>[0]) {
    return unwrap(await this.db.from("portal_doc_requests").insert(input).select(REQUEST_COLUMNS).single()) as PortalDocRequest;
  }
  async getRequest(id: string) {
    return unwrap(await this.db.from("portal_doc_requests").select(REQUEST_COLUMNS).eq("id", id).maybeSingle()) as (PortalDocRequest & { client_id: string }) | null;
  }
  async setRequestStatus(id: string, status: "cancelled") {
    unwrap(await this.db.from("portal_doc_requests").update({ status }).eq("id", id));
  }
  async listRequests(clientId: string) {
    return unwrap(await this.db.from("portal_doc_requests").select(REQUEST_COLUMNS).eq("client_id", clientId).neq("status", "cancelled").order("created_at", { ascending: false }).limit(100)) as PortalDocRequest[];
  }
  async getDoc(id: string) {
    return unwrap(await this.db.from("client_docs").select("id, client_id, title, file_type, status, source, shared_with_client, created_at").eq("id", id).maybeSingle()) as StaffDoc | null;
  }
  async setShared(id: string, shared: boolean) {
    unwrap(await this.db.from("client_docs").update({ shared_with_client: shared }).eq("id", id));
  }
  async listDocs(clientId: string) {
    return unwrap(await this.db.from("client_docs").select("id, client_id, title, file_type, status, source, shared_with_client, created_at").eq("client_id", clientId).eq("status", "stored").order("created_at", { ascending: false }).limit(200)) as StaffDoc[];
  }
  async getReturnClient(returnId: string) {
    const row = unwrap(await this.db.from("client_returns").select("client_id").eq("id", returnId).maybeSingle()) as { client_id: string } | null;
    return row?.client_id ?? null;
  }
  async addAudit(input: Parameters<PortalStaffRepo["addAudit"]>[0]) {
    unwrap(await this.db.from("workspace_audit_events").insert({ actor_id: input.actor_id, action: input.action, subject_type: input.subject_type, subject_id: input.subject_id, detail: input.detail ?? {} }));
  }
}
