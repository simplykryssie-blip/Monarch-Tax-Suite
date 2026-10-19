import type { ArchiveFields } from "../archive.ts";
import type { DocumentFileType } from "./files.ts";

// Document management rows. Every row belongs to one tenant; repositories are built on the tenant-scoped database
// client, so a tenant only ever sees and writes its own rows (migration 20261015090000_documents.sql).

export type TenantProfile = {
  tenant_id: string;
  legal_name: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  /** Preparer tax identification number ("P" and eight digits) and CAF number, for IRS forms. */
  ptin?: string | null;
  caf_number?: string | null;
  time_zone: string;
  updated_by: string | null;
  updated_at: string;
};
export type ProfilePatch = Partial<Pick<TenantProfile, "legal_name" | "display_name" | "email" | "phone" | "address" | "ptin" | "caf_number" | "time_zone" | "updated_by">>;

export type DocumentStatus = "active" | "archived";
export type LibraryDocument = {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  file_type: DocumentFileType;
  status: DocumentStatus;
  current_version_id: string | null;
  signature_consent: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
} & ArchiveFields;

export type DocumentVersion = {
  id: string;
  tenant_id: string;
  document_id: string;
  version: number;
  storage_path: string;
  file_name: string;
  size_bytes: number;
  sha256: string | null;
  merge_fields: string[];
  has_signature_field: boolean;
  status: "pending" | "ready" | "rejected";
  created_by: string | null;
  created_at: string;
  ready_at: string | null;
};

export type DeliveryKind = "send" | "signature";
export type Delivery = {
  id: string;
  tenant_id: string;
  document_id: string;
  version_id: string;
  kind: DeliveryKind;
  customer_id: string | null;
  order_id: string | null;
  /** The client (a person the office prepares returns for) this was made for, when it is a portal document. */
  client_id?: string | null;
  recipient_email: string;
  recipient_name: string | null;
  execution_id: string | null;
  action_index: number | null;
  is_test: boolean;
  storage_path: string;
  file_name: string;
  sha256: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  first_opened_at: string | null;
  last_downloaded_at: string | null;
  download_count: number;
  created_by: string | null;
  created_at: string;
};
export type NewDelivery = Omit<Delivery, "tenant_id" | "revoked_at" | "first_opened_at" | "last_downloaded_at" | "download_count" | "created_at">;

export type SignatureStatus = "sent" | "viewed" | "signed" | "declined" | "expired" | "voided";
export type SignatureRequest = {
  id: string;
  tenant_id: string;
  delivery_id: string;
  document_id: string;
  signer_email: string;
  signer_name: string | null;
  consent_text: string;
  status: SignatureStatus;
  reminder_days: number | null;
  last_reminded_at: string | null;
  expires_at: string;
  viewed_at: string | null;
  consented_at: string | null;
  signed_at: string | null;
  signed_name: string | null;
  signature_method: "typed" | "drawn" | null;
  signer_ip_hash: string | null;
  signer_user_agent: string | null;
  original_sha256: string;
  signed_storage_path: string | null;
  signed_sha256: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
};
export type NewSignatureRequest = Pick<SignatureRequest, "delivery_id" | "document_id" | "signer_email" | "signer_name" | "consent_text" | "reminder_days" | "expires_at" | "original_sha256">;

export type DocumentEvent = { id: string; document_id: string | null; delivery_id: string | null; signature_request_id: string | null; type: string; actor_id: string | null; detail: Record<string, unknown>; created_at: string };

export interface DocumentsRepo {
  getProfile(): Promise<TenantProfile | null>;
  saveProfile(tenantId: string, patch: ProfilePatch): Promise<TenantProfile>;

  listDocuments(): Promise<LibraryDocument[]>;
  getDocument(id: string): Promise<LibraryDocument | null>;
  insertDocument(input: Pick<LibraryDocument, "name" | "description" | "file_type" | "created_by">): Promise<LibraryDocument>;
  updateDocument(id: string, patch: Partial<Pick<LibraryDocument, "name" | "description" | "status" | "current_version_id" | "signature_consent">>): Promise<LibraryDocument>;
  deleteDocument(id: string): Promise<void>;

  listVersions(documentId: string): Promise<DocumentVersion[]>;
  getVersion(id: string): Promise<DocumentVersion | null>;
  insertVersion(input: Pick<DocumentVersion, "document_id" | "version" | "storage_path" | "file_name" | "size_bytes" | "created_by">): Promise<DocumentVersion>;
  updateVersion(id: string, patch: Partial<Pick<DocumentVersion, "status" | "sha256" | "merge_fields" | "has_signature_field" | "ready_at">>): Promise<DocumentVersion>;

  insertDelivery(input: NewDelivery): Promise<Delivery>;
  getDelivery(id: string): Promise<Delivery | null>;
  findDeliveryByTokenHash(hash: string): Promise<Delivery | null>;
  findDeliveryForStep(executionId: string, actionIndex: number): Promise<Delivery | null>;
  updateDelivery(id: string, patch: Partial<Pick<Delivery, "revoked_at" | "first_opened_at" | "last_downloaded_at" | "download_count">>): Promise<Delivery>;
  listDeliveries(documentId: string, limit: number): Promise<Delivery[]>;
  countDeliveries(documentId: string): Promise<number>;

  insertSignature(input: NewSignatureRequest): Promise<SignatureRequest>;
  getSignature(id: string): Promise<SignatureRequest | null>;
  getSignatureByDelivery(deliveryId: string): Promise<SignatureRequest | null>;
  /** Updates only while the request is in one of `from`; returns null when it was not (someone else got there first). */
  transitionSignature(id: string, from: SignatureStatus[], patch: Partial<SignatureRequest>): Promise<SignatureRequest | null>;
  updateSignature(id: string, patch: Partial<Pick<SignatureRequest, "last_reminded_at">>): Promise<SignatureRequest>;
  listSignatures(documentId: string, limit: number): Promise<SignatureRequest[]>;
  listOpenSignatures(limit: number): Promise<SignatureRequest[]>;

  addEvent(input: Omit<DocumentEvent, "id" | "created_at">): Promise<void>;
  listEvents(documentId: string, limit: number): Promise<DocumentEvent[]>;
}

/** The private tenant-documents bucket. Paths always start with the tenant id. */
export interface DocumentStore {
  createUploadUrl(path: string): Promise<{ url: string }>;
  download(path: string): Promise<Uint8Array | null>;
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** A signed URL valid for `seconds`. With `downloadName` the browser saves the file; without it, shows it. */
  signedUrl(path: string, seconds: number, downloadName: string | null): Promise<string>;
  /** Deletes now (system clean-up: failed checks, abandoned uploads, rolled-back saves). */
  remove(paths: string[]): Promise<void>;
  /** Deleted by a person: kept out of view for the 24-hour window, then deleted by the scheduler. */
  discard(paths: string[]): Promise<void>;
}
