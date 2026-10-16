import { createHash, createHmac, randomUUID } from "node:crypto";
import { ValidationError } from "../commerce/validation.ts";
import { checkDocumentFile, cleanDocumentName, CONTENT_TYPES, DOCUMENT_URL_SECONDS, MAX_DOCUMENT_BYTES, sha256Hex, type DocumentFileType } from "./files.ts";
import { fillTemplate, missingValues, scanTemplate } from "./merge.ts";
import { applySignature, isSignaturePng, type SignatureMark } from "./signing.ts";
import { formatDate } from "./values.ts";
import type { Delivery, DeliveryKind, DocumentStore, DocumentsRepo, DocumentVersion, LibraryDocument, SignatureRequest } from "./types.ts";

// Document management for one tenant. Every storage path starts with the tenant id and is built here from rows the
// tenant can see; signed links are only ever created for paths inside the tenant's own folder.

export type DocumentDeps = {
  tenantId: string;
  repo: DocumentsRepo;
  store: DocumentStore;
  /** Secret for secure links (derived from MONARCH_ENCRYPTION_KEY). Links are HMACs of the delivery id. */
  linkKey: Buffer;
  now?: () => Date;
};

export const LINK_DAYS_DEFAULT = 14;
export const SIGNED_COPY_DAYS = 30;
const nowOf = (d: DocumentDeps) => (d.now ? d.now() : new Date());
const iso = (d: DocumentDeps) => nowOf(d).toISOString();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class MissingValuesError extends ValidationError {
  fields: string[];
  constructor(fields: string[]) {
    super(`These merge fields have no value for this client: ${fields.join(", ")}. Fill them in (for example in your firm profile), then retry.`);
    this.fields = fields;
  }
}

// ------------------------------------------------------------------ paths

function ownPath(deps: DocumentDeps, path: string): string {
  if (!UUID.test(deps.tenantId) || !path.startsWith(`${deps.tenantId}/`) || path.includes("..")) throw new Error("Refused: that file is not in this tenant's document folder.");
  return path;
}
const versionPath = (deps: DocumentDeps, documentId: string) => `${deps.tenantId}/versions/${documentId}/${randomUUID()}`;
const deliveryPath = (deps: DocumentDeps, id: string, type: DocumentFileType) => `${deps.tenantId}/deliveries/${id}.${type}`;
const signedPath = (deps: DocumentDeps, id: string) => `${deps.tenantId}/signed/${id}.pdf`;

/** A short-lived link to one of this tenant's files. */
export async function fileLink(deps: DocumentDeps, path: string, downloadName: string | null) {
  return deps.store.signedUrl(ownPath(deps, path), DOCUMENT_URL_SECONDS, downloadName);
}

// ------------------------------------------------------------------ links

export function linkToken(key: Buffer, deliveryId: string) {
  return createHmac("sha256", key).update(`document-link:v1:${deliveryId}`).digest("base64url");
}
export const hashLinkToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const deliveryPathFor = (kind: DeliveryKind, token: string) => (kind === "signature" ? `/sign/${token}` : `/d/${token}`);

// ---------------------------------------------------------------- library

/** Starts an upload: a new document, or a new version of an existing one. The file is pending until finished. */
export async function startVersionUpload(
  deps: DocumentDeps,
  input: { documentId?: string | null; name?: string; description?: string | null; fileName: string; sizeBytes: number; adminId: string },
): Promise<{ document: LibraryDocument; version: DocumentVersion; uploadUrl: string; contentType: string }> {
  const { fileName, fileType } = cleanDocumentName(input.fileName);
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) throw new ValidationError("The file is empty.");
  if (input.sizeBytes > MAX_DOCUMENT_BYTES) throw new ValidationError("Files can be at most 25 MB.");
  let document: LibraryDocument | null;
  if (input.documentId) {
    document = await deps.repo.getDocument(input.documentId);
    if (!document) throw new ValidationError("Document not found.");
    if (document.status === "archived") throw new ValidationError("This document is archived. Restore it before uploading a new version.");
    if (document.file_type !== fileType) throw new ValidationError(`This document is a ${document.file_type.toUpperCase()}. Upload a .${document.file_type} file as its new version, or add a new document.`);
  } else {
    const name = (input.name ?? "").trim().slice(0, 120) || fileName.replace(/\.(pdf|docx)$/i, "");
    if (name.length < 2) throw new ValidationError("Give the document a name.");
    document = await deps.repo.insertDocument({ name, description: input.description?.trim().slice(0, 1000) || null, file_type: fileType, created_by: input.adminId });
  }
  const versions = await deps.repo.listVersions(document.id);
  const next = versions.reduce((n, v) => Math.max(n, v.version), 0) + 1;
  const version = await deps.repo.insertVersion({ document_id: document.id, version: next, storage_path: versionPath(deps, document.id), file_name: fileName, size_bytes: input.sizeBytes, created_by: input.adminId });
  const { url } = await deps.store.createUploadUrl(ownPath(deps, version.storage_path));
  return { document, version, uploadUrl: url, contentType: CONTENT_TYPES[fileType] };
}

/** Checks the uploaded file by content, finds its merge fields, and makes it the current version. */
export async function finishVersionUpload(deps: DocumentDeps, versionId: string, actorId: string | null): Promise<{ document: LibraryDocument; version: DocumentVersion }> {
  const version = await deps.repo.getVersion(versionId);
  if (!version || version.status === "rejected") throw new ValidationError("Upload not found. Start it again.");
  const document = await deps.repo.getDocument(version.document_id);
  if (!document) throw new ValidationError("Document not found.");
  if (version.status === "ready") return { document, version };
  const reject = async (message: string) => {
    await deps.store.remove([ownPath(deps, version.storage_path)]).catch(() => undefined);
    await deps.repo.updateVersion(version.id, { status: "rejected" });
    if (!document.current_version_id) await deps.repo.deleteDocument(document.id).catch(() => undefined);
    throw new ValidationError(message);
  };
  const bytes = await deps.store.download(ownPath(deps, version.storage_path));
  if (!bytes) throw new ValidationError("The file did not arrive. Try the upload again.");
  if (bytes.byteLength !== version.size_bytes) return reject("The uploaded file's size does not match, so it was rejected. Try again.");
  let scan;
  try {
    await checkDocumentFile(bytes, document.file_type);
    scan = await scanTemplate(bytes, document.file_type);
  } catch (e) {
    return reject(e instanceof ValidationError ? e.message : "This file could not be read, so it was rejected.");
  }
  const ready = await deps.repo.updateVersion(version.id, { status: "ready", sha256: sha256Hex(bytes), merge_fields: scan.fields, has_signature_field: scan.hasSignatureField, ready_at: iso(deps) });
  const updated = await deps.repo.updateDocument(document.id, { current_version_id: ready.id });
  await deps.repo.addEvent({ document_id: document.id, delivery_id: null, signature_request_id: null, type: "version_uploaded", actor_id: actorId, detail: { version: ready.version, fields: scan.fields.length } });
  return { document: updated, version: ready };
}

export async function setConsentText(deps: DocumentDeps, documentId: string, text: string, actorId: string) {
  const clean = text.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, 5000);
  if (clean && clean.length < 20) throw new ValidationError("Write the full consent statement the signer agrees to (at least 20 characters).");
  const doc = await deps.repo.updateDocument(documentId, { signature_consent: clean || null });
  await deps.repo.addEvent({ document_id: documentId, delivery_id: null, signature_request_id: null, type: "consent_updated", actor_id: actorId, detail: {} });
  return doc;
}

/** Never-sent documents are deleted with their files; sent ones are archived so their records stay. */
export async function removeDocument(deps: DocumentDeps, documentId: string, actorId: string): Promise<"deleted" | "archived"> {
  const document = await deps.repo.getDocument(documentId);
  if (!document) throw new ValidationError("Document not found.");
  if ((await deps.repo.countDeliveries(documentId)) > 0) {
    await deps.repo.updateDocument(documentId, { status: "archived" });
    await deps.repo.addEvent({ document_id: documentId, delivery_id: null, signature_request_id: null, type: "archived", actor_id: actorId, detail: {} });
    return "archived";
  }
  const versions = await deps.repo.listVersions(documentId);
  await deps.repo.updateDocument(documentId, { current_version_id: null });
  await deps.repo.deleteDocument(documentId);
  // Its files are kept for the 24-hour window, then the scheduler deletes them.
  await deps.store.discard(versions.map((v) => ownPath(deps, v.storage_path)));
  return "deleted";
}

export async function restoreDocument(deps: DocumentDeps, documentId: string, actorId: string) {
  await deps.repo.updateDocument(documentId, { status: "active" });
  await deps.repo.addEvent({ document_id: documentId, delivery_id: null, signature_request_id: null, type: "restored", actor_id: actorId, detail: {} });
}

/** The usable current version of an active document, for sending. */
export async function sendableVersion(deps: DocumentDeps, documentId: string, kind: DeliveryKind): Promise<{ document: LibraryDocument; version: DocumentVersion }> {
  const document = await deps.repo.getDocument(documentId);
  if (!document) throw new ValidationError("The document for this step no longer exists. Choose another in the workflow.");
  if (document.status !== "active") throw new ValidationError(`The document "${document.name}" is archived. Restore it, then retry.`);
  const version = document.current_version_id ? await deps.repo.getVersion(document.current_version_id) : null;
  if (!version || version.status !== "ready") throw new ValidationError(`The document "${document.name}" has no uploaded file yet.`);
  if (kind === "signature") {
    if (document.file_type !== "pdf") throw new ValidationError(`"${document.name}" is a Word document. Only PDFs can be signed: export it to PDF and upload that.`);
    if (!document.signature_consent) throw new ValidationError(`"${document.name}" has no signing consent statement yet. Add one on the document's page, then retry.`);
  }
  return { document, version };
}

// --------------------------------------------------------------- delivery

export type DeliveryInput = {
  documentId: string;
  kind: DeliveryKind;
  recipientEmail: string;
  recipientName: string | null;
  customerId: string | null;
  orderId: string | null;
  executionId: string | null;
  actionIndex: number | null;
  isTest: boolean;
  values: Record<string, string>;
  linkDays: number;
  reminderDays?: number | null;
  createdBy: string | null;
};

/**
 * Fills the current version for one recipient, saves the fingerprinted copy, and returns its secure link token.
 * Once per workflow step: a retried run gets the copy it already made (and the same link) instead of a new one.
 */
export async function createDelivery(deps: DocumentDeps, input: DeliveryInput): Promise<{ delivery: Delivery; signature: SignatureRequest | null; token: string; document: LibraryDocument; reused: boolean }> {
  if (input.executionId !== null && input.actionIndex !== null) {
    const existing = await deps.repo.findDeliveryForStep(input.executionId, input.actionIndex);
    if (existing) {
      const document = (await deps.repo.getDocument(existing.document_id))!;
      const signature = existing.kind === "signature" ? await deps.repo.getSignatureByDelivery(existing.id) : null;
      return { delivery: existing, signature, token: linkToken(deps.linkKey, existing.id), document, reused: true };
    }
  }
  const { document, version } = await sendableVersion(deps, input.documentId, input.kind);
  const missing = missingValues(version.merge_fields, input.values);
  if (missing.length) throw new MissingValuesError(missing);
  const original = await deps.store.download(ownPath(deps, version.storage_path));
  if (!original) throw new Error("The document file is missing from storage.");
  const filled = await fillTemplate(original, document.file_type, input.values, { keepSigning: input.kind === "signature" });
  const id = randomUUID();
  const path = deliveryPath(deps, id, document.file_type);
  await deps.store.upload(ownPath(deps, path), filled, CONTENT_TYPES[document.file_type]);
  const days = Math.min(Math.max(Math.round(input.linkDays) || LINK_DAYS_DEFAULT, 1), 60);
  const expires = new Date(nowOf(deps).getTime() + days * 86_400_000).toISOString();
  const sha = sha256Hex(filled);
  const token = linkToken(deps.linkKey, id);
  const delivery = await deps.repo.insertDelivery({
    id, document_id: document.id, version_id: version.id, kind: input.kind,
    customer_id: input.customerId, order_id: input.orderId, recipient_email: input.recipientEmail, recipient_name: input.recipientName,
    execution_id: input.executionId, action_index: input.actionIndex, is_test: input.isTest,
    storage_path: path, file_name: `${document.name.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 100)}.${document.file_type}`,
    sha256: sha, token_hash: hashLinkToken(token), expires_at: expires, created_by: input.createdBy,
  });
  let signature: SignatureRequest | null = null;
  if (input.kind === "signature") {
    signature = await deps.repo.insertSignature({
      delivery_id: delivery.id, document_id: document.id, signer_email: input.recipientEmail, signer_name: input.recipientName,
      consent_text: document.signature_consent!, reminder_days: input.reminderDays ?? null, expires_at: expires, original_sha256: sha,
    });
  }
  await deps.repo.addEvent({ document_id: document.id, delivery_id: delivery.id, signature_request_id: signature?.id ?? null, type: input.kind === "signature" ? "signature_requested" : "sent", actor_id: input.createdBy, detail: { version: version.version, test: input.isTest } });
  return { delivery, signature, token, document, reused: false };
}

export type LinkState =
  | { ok: true; delivery: Delivery; document: LibraryDocument; signature: SignatureRequest | null }
  | { ok: false; reason: "not_found" | "expired" | "revoked" };

/** Resolves a secure link. Expired or revoked links say so; anything else is "not found". */
export async function resolveLink(deps: DocumentDeps, token: string): Promise<LinkState> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return { ok: false, reason: "not_found" };
  const delivery = await deps.repo.findDeliveryByTokenHash(hashLinkToken(token));
  if (!delivery) return { ok: false, reason: "not_found" };
  if (delivery.revoked_at) return { ok: false, reason: "revoked" };
  const signature = delivery.kind === "signature" ? await deps.repo.getSignatureByDelivery(delivery.id) : null;
  const signedUntil = signature?.signed_at ? new Date(signature.signed_at).getTime() + SIGNED_COPY_DAYS * 86_400_000 : 0;
  if (new Date(delivery.expires_at).getTime() < nowOf(deps).getTime() && signedUntil < nowOf(deps).getTime()) return { ok: false, reason: "expired" };
  const document = await deps.repo.getDocument(delivery.document_id);
  if (!document) return { ok: false, reason: "not_found" };
  return { ok: true, delivery, document, signature };
}

export async function markOpened(deps: DocumentDeps, delivery: Delivery) {
  if (delivery.first_opened_at) return;
  await deps.repo.updateDelivery(delivery.id, { first_opened_at: iso(deps) });
  await deps.repo.addEvent({ document_id: delivery.document_id, delivery_id: delivery.id, signature_request_id: null, type: "opened", actor_id: null, detail: {} });
}

/** A 60-second download link for the copy behind a secure link (the signed copy once it is signed). */
export async function downloadFromLink(deps: DocumentDeps, token: string): Promise<string> {
  const state = await resolveLink(deps, token);
  if (!state.ok) throw new ValidationError(state.reason === "expired" ? "This link has expired. Ask the sender for a new one." : "This link is no longer available.");
  const { delivery, signature } = state;
  if (delivery.kind === "signature" && signature?.status !== "signed") throw new ValidationError("This document is waiting for your signature. Sign it first to download the signed copy.");
  const path = signature?.signed_storage_path ?? delivery.storage_path;
  const name = signature?.signed_storage_path ? delivery.file_name.replace(/\.pdf$/i, " (signed).pdf") : delivery.file_name;
  await deps.repo.updateDelivery(delivery.id, { last_downloaded_at: iso(deps), download_count: delivery.download_count + 1, first_opened_at: delivery.first_opened_at ?? iso(deps) });
  await deps.repo.addEvent({ document_id: delivery.document_id, delivery_id: delivery.id, signature_request_id: signature?.id ?? null, type: "downloaded", actor_id: null, detail: {} });
  return fileLink(deps, path, name);
}

export async function revokeDelivery(deps: DocumentDeps, deliveryId: string, actorId: string) {
  const delivery = await deps.repo.getDelivery(deliveryId);
  if (!delivery || delivery.revoked_at) return;
  await deps.repo.updateDelivery(delivery.id, { revoked_at: iso(deps) });
  const sig = delivery.kind === "signature" ? await deps.repo.getSignatureByDelivery(delivery.id) : null;
  if (sig) await deps.repo.transitionSignature(sig.id, ["sent", "viewed"], { status: "voided", voided_at: iso(deps) });
  await deps.repo.addEvent({ document_id: delivery.document_id, delivery_id: delivery.id, signature_request_id: sig?.id ?? null, type: sig ? "voided" : "revoked", actor_id: actorId, detail: {} });
}

// ---------------------------------------------------------------- signing

const OPEN: SignatureRequest["status"][] = ["sent", "viewed"];

async function openRequest(deps: DocumentDeps, token: string) {
  const state = await resolveLink(deps, token);
  if (!state.ok || !state.signature) throw new ValidationError(state.ok ? "This link is not a signature request." : state.reason === "expired" ? "This signature request has expired. Ask the sender for a new one." : "This signature request is no longer available.");
  if (!OPEN.includes(state.signature.status)) throw new ValidationError(`This document was already ${state.signature.status}.`);
  if (new Date(state.signature.expires_at).getTime() < nowOf(deps).getTime()) throw new ValidationError("This signature request has expired. Ask the sender for a new one.");
  return state as Extract<LinkState, { ok: true }> & { signature: SignatureRequest };
}

/** First view of a signature request. */
export async function recordView(deps: DocumentDeps, request: SignatureRequest) {
  if (request.status !== "sent") return;
  const viewed = await deps.repo.transitionSignature(request.id, ["sent"], { status: "viewed", viewed_at: iso(deps) });
  if (viewed) await deps.repo.addEvent({ document_id: request.document_id, delivery_id: request.delivery_id, signature_request_id: request.id, type: "signature_viewed", actor_id: null, detail: {} });
}

export type SignInput = { consent: boolean; signedName: string; mark: SignatureMark; ipHash: string | null; userAgent: string | null };

/** Signs once: consent, the mark and the printed name, a signed copy with its certificate, and the evidence. */
export async function signDocument(deps: DocumentDeps, token: string, input: SignInput & { firmName: string; timeZone: string }): Promise<{ request: SignatureRequest; document: LibraryDocument; delivery: Delivery }> {
  const { delivery, document, signature } = await openRequest(deps, token);
  if (!input.consent) throw new ValidationError("Tick the consent box to sign electronically.");
  const signedName = input.signedName.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  if (signedName.length < 2) throw new ValidationError("Type your full name.");
  if (input.mark.method === "typed" && input.mark.text.trim().length < 2) throw new ValidationError("Type your signature.");
  if (input.mark.method === "drawn" && !isSignaturePng(input.mark.png)) throw new ValidationError("Draw your signature in the box, or type it instead.");
  const now = nowOf(deps);
  const copy = await deps.store.download(ownPath(deps, delivery.storage_path));
  if (!copy || sha256Hex(copy) !== signature.original_sha256) throw new Error("The document copy does not match what was sent.");
  const signed = await applySignature({
    pdf: copy,
    mark: input.mark.method === "typed" ? { method: "typed", text: input.mark.text.trim().slice(0, 120) } : input.mark,
    signedName,
    signedDate: formatDate(now, input.timeZone),
    certificate: {
      documentName: document.name, requestId: signature.id, firmName: input.firmName, signerName: signedName, signerEmail: signature.signer_email,
      consentText: signature.consent_text, originalSha256: signature.original_sha256, timeZone: input.timeZone, ipHash: input.ipHash, userAgent: input.userAgent,
      timeline: [
        { label: "Sent", at: new Date(signature.created_at) },
        ...(signature.viewed_at ? [{ label: "First viewed", at: new Date(signature.viewed_at) }] : []),
        { label: "Consented and signed", at: now },
      ],
    },
  });
  const path = signedPath(deps, signature.id);
  await deps.store.upload(ownPath(deps, path), signed, CONTENT_TYPES.pdf);
  const done = await deps.repo.transitionSignature(signature.id, OPEN, {
    status: "signed", consented_at: now.toISOString(), signed_at: now.toISOString(), signed_name: signedName, signature_method: input.mark.method,
    signer_ip_hash: input.ipHash, signer_user_agent: input.userAgent?.slice(0, 300) ?? null, signed_storage_path: path, signed_sha256: sha256Hex(signed),
    viewed_at: signature.viewed_at ?? now.toISOString(),
  });
  if (!done) throw new ValidationError("This document was already signed or closed.");
  await deps.repo.addEvent({ document_id: document.id, delivery_id: delivery.id, signature_request_id: done.id, type: "signed", actor_id: null, detail: { method: input.mark.method } });
  return { request: done, document, delivery };
}

export async function declineSignature(deps: DocumentDeps, token: string, reason: string): Promise<{ request: SignatureRequest; document: LibraryDocument; delivery: Delivery }> {
  const { delivery, document, signature } = await openRequest(deps, token);
  const done = await deps.repo.transitionSignature(signature.id, OPEN, { status: "declined", declined_at: iso(deps), decline_reason: reason.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, 1000) || null });
  if (!done) throw new ValidationError("This document was already signed or closed.");
  await deps.repo.addEvent({ document_id: document.id, delivery_id: delivery.id, signature_request_id: done.id, type: "declined", actor_id: null, detail: {} });
  return { request: done, document, delivery };
}

/** Expires overdue requests and lists those due a reminder. The caller sends the emails and raises the events. */
export async function sweepSignatures(deps: DocumentDeps, limit = 50): Promise<{ expired: SignatureRequest[]; remind: SignatureRequest[] }> {
  const now = nowOf(deps).getTime();
  const expired: SignatureRequest[] = [];
  const remind: SignatureRequest[] = [];
  for (const r of await deps.repo.listOpenSignatures(limit)) {
    if (new Date(r.expires_at).getTime() < now) {
      const done = await deps.repo.transitionSignature(r.id, OPEN, { status: "expired" });
      if (done) {
        expired.push(done);
        await deps.repo.addEvent({ document_id: r.document_id, delivery_id: r.delivery_id, signature_request_id: r.id, type: "expired", actor_id: null, detail: {} });
      }
      continue;
    }
    if (r.reminder_days) {
      const last = new Date(r.last_reminded_at ?? r.created_at).getTime();
      if (now - last >= r.reminder_days * 86_400_000) {
        await deps.repo.updateSignature(r.id, { last_reminded_at: nowOf(deps).toISOString() });
        remind.push(r);
      }
    }
  }
  return { expired, remind };
}
