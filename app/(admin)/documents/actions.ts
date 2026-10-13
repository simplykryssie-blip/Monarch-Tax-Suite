"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { automationDeps } from "@/lib/automation/server";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { documentDeps } from "@/lib/documents/server";
import { finishVersionUpload, removeDocument, restoreDocument, revokeDelivery, setConsentText, startVersionUpload } from "@/lib/documents/service.ts";
import { sendDocumentManually } from "@/lib/documents/manual.ts";

// Document library actions. Every action re-checks administrator access and acts only on the current tenant's rows
// (the tenant-scoped database client), so ids from another tenant simply are not found.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const str = (form: FormData, k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
const withParam = (path: string, key: "notice" | "error", message: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;

async function act(back: string, fn: (adminId: string) => Promise<{ to?: string; notice: string }>) {
  const admin = await requireAdmin();
  let target: string;
  try {
    const r = await fn(admin.userId);
    target = withParam(r.to ?? back, "notice", r.notice);
  } catch (e) {
    if (e instanceof ValidationError) target = withParam(back, "error", e.message);
    else {
      console.error(`documents action failed: ${sanitizeError(e, 200)}`);
      target = withParam(back, "error", /relation|schema cache|does not exist/i.test(e instanceof Error ? e.message : "") ? "Document management is not installed yet. Apply the documents migration first." : "That did not work. Nothing was changed. Please try again.");
    }
  }
  revalidatePath("/documents", "layout");
  redirect(target);
}

export type DocUploadTicket = { ok: true; versionId: string; documentId: string; uploadUrl: string; contentType: string } | { ok: false; error: string };
export type DocUploadResult = { ok: true; documentId: string; fields: string[] } | { ok: false; error: string };

export async function startDocumentUploadAction(input: { documentId: string | null; name: string; fileName: string; sizeBytes: number }): Promise<DocUploadTicket> {
  const admin = await requireAdmin();
  if (input.documentId && !UUID.test(input.documentId)) return { ok: false, error: "Invalid document." };
  try {
    const t = await startVersionUpload(documentDeps(), { documentId: input.documentId, name: String(input.name ?? "").slice(0, 120), fileName: String(input.fileName).slice(0, 300), sizeBytes: Number(input.sizeBytes), adminId: admin.userId });
    return { ok: true, versionId: t.version.id, documentId: t.document.id, uploadUrl: t.uploadUrl, contentType: t.contentType };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    console.error(`document upload could not start: ${sanitizeError(e, 160)}`);
    return { ok: false, error: "Uploads are not available. Check that the documents migration is applied." };
  }
}

export async function finishDocumentUploadAction(versionId: string): Promise<DocUploadResult> {
  const admin = await requireAdmin();
  if (!UUID.test(versionId)) return { ok: false, error: "Invalid upload." };
  try {
    const { document, version } = await finishVersionUpload(documentDeps(), versionId, admin.userId);
    revalidatePath("/documents", "layout");
    return { ok: true, documentId: document.id, fields: version.merge_fields };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    console.error(`document upload could not finish: ${sanitizeError(e, 160)}`);
    return { ok: false, error: "The upload could not be checked. Try again." };
  }
}

export async function saveDocumentDetailsAction(form: FormData) {
  const id = str(form, "id");
  await act(`/documents/${id}`, async () => {
    if (!UUID.test(id)) throw new ValidationError("Document not found.");
    const name = str(form, "name").replace(/\s+/g, " ").trim().slice(0, 120);
    if (name.length < 2) throw new ValidationError("Give the document a name.");
    await documentDeps().repo.updateDocument(id, { name, description: str(form, "description").trim().slice(0, 1000) || null });
    return { notice: "Saved." };
  });
}

export async function saveConsentAction(form: FormData) {
  const id = str(form, "id");
  await act(`/documents/${id}`, async (adminId) => {
    if (!UUID.test(id)) throw new ValidationError("Document not found.");
    await setConsentText(documentDeps(), id, str(form, "consent"), adminId);
    return { notice: "Signing consent statement saved. New signature requests show this text; earlier ones keep the text their signer saw." };
  });
}

export async function removeDocumentAction(form: FormData) {
  const id = str(form, "id");
  await act(`/documents/${id}`, async (adminId) => {
    if (!UUID.test(id)) throw new ValidationError("Document not found.");
    const r = await removeDocument(documentDeps(), id, adminId);
    return r === "deleted" ? { to: "/documents", notice: "Document deleted." } : { notice: "Archived. It was sent before, so its history is kept. Workflows can no longer send it." };
  });
}

export async function restoreDocumentAction(form: FormData) {
  const id = str(form, "id");
  await act(`/documents/${id}`, async (adminId) => {
    if (!UUID.test(id)) throw new ValidationError("Document not found.");
    await restoreDocument(documentDeps(), id, adminId);
    return { notice: "Restored." };
  });
}

export async function revokeDeliveryAction(form: FormData) {
  const id = str(form, "document_id");
  await act(`/documents/${id}`, async (adminId) => {
    const deliveryId = str(form, "delivery_id");
    if (!UUID.test(deliveryId)) throw new ValidationError("Not found.");
    await revokeDelivery(documentDeps(), deliveryId, adminId);
    return { notice: "The link no longer works. An open signature request was voided." };
  });
}

export async function sendManualAction(form: FormData) {
  const id = str(form, "id");
  await act(`/documents/${id}`, async (adminId) => {
    const customerId = str(form, "customer_id");
    if (!UUID.test(id) || !UUID.test(customerId)) throw new ValidationError("Choose a customer.");
    const orderId = str(form, "order_id");
    const kind = str(form, "kind") === "signature" ? "signature" : "send";
    const senderId = str(form, "sender_id");
    const reminder = str(form, "reminder_days");
    await sendDocumentManually(automationDeps(), documentDeps(), {
      documentId: id, customerId, orderId: UUID.test(orderId) ? orderId : null, kind, senderId: UUID.test(senderId) ? senderId : null,
      message: str(form, "message").slice(0, 1000), linkDays: Number(str(form, "link_days")) || 14, reminderDays: reminder ? Number(reminder) || null : null, actorId: adminId,
    });
    return { notice: kind === "signature" ? "Signature request sent." : "Document sent." };
  });
}
