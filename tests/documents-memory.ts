import { randomUUID } from "node:crypto";
import type { Delivery, DocumentEvent, DocumentStore, DocumentsRepo, DocumentVersion, LibraryDocument, NewDelivery, NewSignatureRequest, ProfilePatch, SignatureRequest, SignatureStatus, TenantProfile } from "../lib/documents/types.ts";

/** One tenant's document rows in memory (the database's tenant scoping is tested separately in SQL). */
export class MemoryDocumentsRepo implements DocumentsRepo {
  profile: TenantProfile | null = null;
  documents: LibraryDocument[] = [];
  versions: DocumentVersion[] = [];
  deliveries: Delivery[] = [];
  signatures: SignatureRequest[] = [];
  events: DocumentEvent[] = [];
  tenantId: string;
  constructor(tenantId: string) {
    this.tenantId = tenantId;
  }
  private now = () => new Date().toISOString();

  async getProfile() { return this.profile ? { ...this.profile } : null; }
  async saveProfile(tenantId: string, patch: ProfilePatch) {
    this.profile = { tenant_id: tenantId, legal_name: "", display_name: "", email: null, phone: null, address: null, time_zone: "America/New_York", updated_by: null, ...(this.profile ?? {}), ...patch, updated_at: this.now() } as TenantProfile;
    return { ...this.profile };
  }

  async listDocuments() { return this.documents.map((d) => ({ ...d })); }
  async getDocument(id: string) { const d = this.documents.find((x) => x.id === id); return d ? { ...d } : null; }
  async insertDocument(input: Pick<LibraryDocument, "name" | "description" | "file_type" | "created_by">) {
    const d: LibraryDocument = { ...input, id: randomUUID(), tenant_id: this.tenantId, status: "active", current_version_id: null, signature_consent: null, created_at: this.now(), updated_at: this.now() };
    this.documents.push(d);
    return { ...d };
  }
  async updateDocument(id: string, patch: Partial<LibraryDocument>) { const d = this.documents.find((x) => x.id === id)!; Object.assign(d, patch, { updated_at: this.now() }); return { ...d }; }
  async deleteDocument(id: string) {
    this.documents = this.documents.filter((d) => d.id !== id);
    this.versions = this.versions.filter((v) => v.document_id !== id);
  }

  async listVersions(documentId: string) { return this.versions.filter((v) => v.document_id === documentId).sort((a, b) => b.version - a.version).map((v) => ({ ...v })); }
  async getVersion(id: string) { const v = this.versions.find((x) => x.id === id); return v ? { ...v } : null; }
  async insertVersion(input: Pick<DocumentVersion, "document_id" | "version" | "storage_path" | "file_name" | "size_bytes" | "created_by">) {
    const v: DocumentVersion = { ...input, id: randomUUID(), tenant_id: this.tenantId, sha256: null, merge_fields: [], has_signature_field: false, status: "pending", created_at: this.now(), ready_at: null };
    this.versions.push(v);
    return { ...v };
  }
  async updateVersion(id: string, patch: Partial<DocumentVersion>) { const v = this.versions.find((x) => x.id === id)!; Object.assign(v, patch); return { ...v }; }

  async insertDelivery(input: NewDelivery) {
    if (input.execution_id && this.deliveries.some((d) => d.execution_id === input.execution_id && d.action_index === input.action_index)) throw new Error("duplicate key value violates unique constraint");
    const d: Delivery = { ...input, tenant_id: this.tenantId, revoked_at: null, first_opened_at: null, last_downloaded_at: null, download_count: 0, created_at: this.now() };
    this.deliveries.push(d);
    return { ...d };
  }
  async getDelivery(id: string) { const d = this.deliveries.find((x) => x.id === id); return d ? { ...d } : null; }
  async findDeliveryByTokenHash(hash: string) { const d = this.deliveries.find((x) => x.token_hash === hash); return d ? { ...d } : null; }
  async findDeliveryForStep(executionId: string, actionIndex: number) { const d = this.deliveries.find((x) => x.execution_id === executionId && x.action_index === actionIndex); return d ? { ...d } : null; }
  async updateDelivery(id: string, patch: Partial<Delivery>) { const d = this.deliveries.find((x) => x.id === id)!; Object.assign(d, patch); return { ...d }; }
  async listDeliveries(documentId: string) { return this.deliveries.filter((d) => d.document_id === documentId).map((d) => ({ ...d })); }
  async countDeliveries(documentId: string) { return this.deliveries.filter((d) => d.document_id === documentId).length; }

  async insertSignature(input: NewSignatureRequest) {
    const s: SignatureRequest = { ...input, id: randomUUID(), tenant_id: this.tenantId, status: "sent", last_reminded_at: null, viewed_at: null, consented_at: null, signed_at: null, signed_name: null, signature_method: null, signer_ip_hash: null, signer_user_agent: null, signed_storage_path: null, signed_sha256: null, declined_at: null, decline_reason: null, voided_at: null, created_at: this.now(), updated_at: this.now() };
    this.signatures.push(s);
    return { ...s };
  }
  async getSignature(id: string) { const s = this.signatures.find((x) => x.id === id); return s ? { ...s } : null; }
  async getSignatureByDelivery(deliveryId: string) { const s = this.signatures.find((x) => x.delivery_id === deliveryId); return s ? { ...s } : null; }
  async transitionSignature(id: string, from: SignatureStatus[], patch: Partial<SignatureRequest>) {
    const s = this.signatures.find((x) => x.id === id);
    if (!s || !from.includes(s.status)) return null;
    Object.assign(s, patch, { updated_at: this.now() });
    return { ...s };
  }
  async updateSignature(id: string, patch: Partial<SignatureRequest>) { const s = this.signatures.find((x) => x.id === id)!; Object.assign(s, patch); return { ...s }; }
  async listSignatures(documentId: string) { return this.signatures.filter((s) => s.document_id === documentId).map((s) => ({ ...s })); }
  async listOpenSignatures() { return this.signatures.filter((s) => s.status === "sent" || s.status === "viewed").map((s) => ({ ...s })); }

  async addEvent(input: Omit<DocumentEvent, "id" | "created_at">) { this.events.push({ ...input, id: randomUUID(), created_at: this.now() }); }
  async listEvents(documentId: string) { return this.events.filter((e) => e.document_id === documentId); }
}

export class MemoryDocumentStore implements DocumentStore {
  objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  uploadUrls: string[] = [];
  signed: { path: string; seconds: number; downloadName: string | null }[] = [];
  async createUploadUrl(path: string) { this.uploadUrls.push(path); return { url: `https://storage.test/upload/${path}` }; }
  /** Test helper: what the browser would PUT to the upload URL. */
  put(path: string, bytes: Uint8Array, contentType = "application/pdf") { this.objects.set(path, { bytes, contentType }); }
  async download(path: string) { return this.objects.get(path)?.bytes ?? null; }
  async upload(path: string, bytes: Uint8Array, contentType: string) {
    if (this.objects.has(path)) throw new Error("The resource already exists");
    this.objects.set(path, { bytes, contentType });
  }
  async signedUrl(path: string, seconds: number, downloadName: string | null) { this.signed.push({ path, seconds, downloadName }); return `https://storage.test/signed/${path}?t=${seconds}`; }
  async remove(paths: string[]) { for (const p of paths) this.objects.delete(p); }
}
