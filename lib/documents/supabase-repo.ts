import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "../commerce/supabase-repo.ts";
import { discardObjects, removeObjects } from "../storage/objects.ts";
import type { Delivery, DocumentEvent, DocumentStore, DocumentsRepo, DocumentVersion, LibraryDocument, NewDelivery, NewSignatureRequest, ProfilePatch, SignatureRequest, SignatureStatus, TenantProfile } from "./types.ts";

export const DOCUMENT_BUCKET = "tenant-documents";

/** Document tables, on a tenant-scoped client: row-level security limits every call to that tenant's rows. */
export class SupabaseDocumentsRepo implements DocumentsRepo {
  constructor(private db: SupabaseClient) {}

  async getProfile() {
    return unwrap(await this.db.from("tenant_profiles").select("*").maybeSingle()) as TenantProfile | null;
  }
  async saveProfile(tenantId: string, patch: ProfilePatch) {
    return unwrap(await this.db.from("tenant_profiles").upsert({ tenant_id: tenantId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" }).select("*").single()) as TenantProfile;
  }

  async listDocuments() {
    return unwrap(await this.db.from("documents").select("*").order("name", { ascending: true })) as LibraryDocument[];
  }
  async getDocument(id: string) {
    return unwrap(await this.db.from("documents").select("*").eq("id", id).maybeSingle()) as LibraryDocument | null;
  }
  async insertDocument(input: Pick<LibraryDocument, "name" | "description" | "file_type" | "created_by">) {
    return unwrap(await this.db.from("documents").insert(input).select("*").single()) as LibraryDocument;
  }
  async updateDocument(id: string, patch: Partial<LibraryDocument>) {
    return unwrap(await this.db.from("documents").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select("*").single()) as LibraryDocument;
  }
  async deleteDocument(id: string) {
    unwrap(await this.db.from("documents").delete().eq("id", id));
  }

  async listVersions(documentId: string) {
    return unwrap(await this.db.from("document_versions").select("*").eq("document_id", documentId).order("version", { ascending: false })) as DocumentVersion[];
  }
  async getVersion(id: string) {
    return unwrap(await this.db.from("document_versions").select("*").eq("id", id).maybeSingle()) as DocumentVersion | null;
  }
  async insertVersion(input: Pick<DocumentVersion, "document_id" | "version" | "storage_path" | "file_name" | "size_bytes" | "created_by">) {
    return unwrap(await this.db.from("document_versions").insert(input).select("*").single()) as DocumentVersion;
  }
  async updateVersion(id: string, patch: Partial<DocumentVersion>) {
    return unwrap(await this.db.from("document_versions").update(patch).eq("id", id).select("*").single()) as DocumentVersion;
  }

  async insertDelivery(input: NewDelivery) {
    return unwrap(await this.db.from("document_deliveries").insert(input).select("*").single()) as Delivery;
  }
  async getDelivery(id: string) {
    return unwrap(await this.db.from("document_deliveries").select("*").eq("id", id).maybeSingle()) as Delivery | null;
  }
  async findDeliveryByTokenHash(hash: string) {
    return unwrap(await this.db.from("document_deliveries").select("*").eq("token_hash", hash).maybeSingle()) as Delivery | null;
  }
  async findDeliveryForStep(executionId: string, actionIndex: number) {
    return unwrap(await this.db.from("document_deliveries").select("*").eq("execution_id", executionId).eq("action_index", actionIndex).maybeSingle()) as Delivery | null;
  }
  async updateDelivery(id: string, patch: Partial<Delivery>) {
    return unwrap(await this.db.from("document_deliveries").update(patch).eq("id", id).select("*").single()) as Delivery;
  }
  async listDeliveries(documentId: string, limit: number) {
    return unwrap(await this.db.from("document_deliveries").select("*").eq("document_id", documentId).order("created_at", { ascending: false }).limit(limit)) as Delivery[];
  }
  async countDeliveries(documentId: string) {
    const { count, error } = await this.db.from("document_deliveries").select("id", { count: "exact", head: true }).eq("document_id", documentId);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async insertSignature(input: NewSignatureRequest) {
    return unwrap(await this.db.from("signature_requests").insert(input).select("*").single()) as SignatureRequest;
  }
  async getSignature(id: string) {
    return unwrap(await this.db.from("signature_requests").select("*").eq("id", id).maybeSingle()) as SignatureRequest | null;
  }
  async getSignatureByDelivery(deliveryId: string) {
    return unwrap(await this.db.from("signature_requests").select("*").eq("delivery_id", deliveryId).maybeSingle()) as SignatureRequest | null;
  }
  async transitionSignature(id: string, from: SignatureStatus[], patch: Partial<SignatureRequest>) {
    const rows = unwrap(await this.db.from("signature_requests").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).in("status", from).select("*")) as SignatureRequest[];
    return rows[0] ?? null;
  }
  async updateSignature(id: string, patch: Partial<SignatureRequest>) {
    return unwrap(await this.db.from("signature_requests").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select("*").single()) as SignatureRequest;
  }
  async listSignatures(documentId: string, limit: number) {
    return unwrap(await this.db.from("signature_requests").select("*").eq("document_id", documentId).order("created_at", { ascending: false }).limit(limit)) as SignatureRequest[];
  }
  async listOpenSignatures(limit: number) {
    return unwrap(await this.db.from("signature_requests").select("*").in("status", ["sent", "viewed"]).order("expires_at", { ascending: true }).limit(limit)) as SignatureRequest[];
  }

  async addEvent(input: Omit<DocumentEvent, "id" | "created_at">) {
    unwrap(await this.db.from("document_events").insert(input));
  }
  async listEvents(documentId: string, limit: number) {
    return unwrap(await this.db.from("document_events").select("*").eq("document_id", documentId).order("created_at", { ascending: false }).limit(limit)) as DocumentEvent[];
  }
}

/** A private storage bucket (tenant-documents by default). Nothing in it is ever public. */
export class SupabaseDocumentStore implements DocumentStore {
  constructor(private db: SupabaseClient, private bucketName: string = DOCUMENT_BUCKET) {}
  private bucket() { return this.db.storage.from(this.bucketName); }
  async createUploadUrl(path: string) {
    const { data, error } = await this.bucket().createSignedUploadUrl(path, { upsert: false });
    if (error || !data) throw new Error(`Could not prepare the upload: ${error?.message ?? "no URL"}`);
    return { url: data.signedUrl };
  }
  async download(path: string) {
    const { data, error } = await this.bucket().download(path);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  }
  async upload(path: string, bytes: Uint8Array, contentType: string) {
    const { error } = await this.bucket().upload(path, bytes, { contentType, upsert: false });
    if (error) throw new Error(`Could not store the document: ${error.message}`);
  }
  async signedUrl(path: string, seconds: number, downloadName: string | null) {
    const { data, error } = await this.bucket().createSignedUrl(path, seconds, downloadName ? { download: downloadName } : undefined);
    if (error || !data) throw new Error(`Could not sign the link: ${error?.message ?? "no URL"}`);
    return data.signedUrl;
  }
  /** Deletes the files; if storage can't be reached they are queued and the scheduler removes them later. */
  async remove(paths: string[]) {
    await removeObjects(this.db, this.bucketName, paths);
  }
  async discard(paths: string[]) {
    await discardObjects(this.db, this.bucketName, paths);
  }
}
