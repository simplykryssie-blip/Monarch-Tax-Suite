"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { automationDeps } from "@/lib/automation/server";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { documentDeps } from "@/lib/documents/server";
import { finishVersionUpload, revokeDelivery, saveFieldMap, setConsentText, startVersionUpload } from "@/lib/documents/service.ts";
import { createFolder, deleteFolder, internalScope, moveFile, moveFolder, renameFolder } from "@/lib/documents/folders.ts";
import { sendDocumentToClient } from "@/lib/portal/send-document.ts";
import { ssnDeps } from "@/lib/ssn/server";
import { workspaceRepo } from "@/lib/workspace/server";

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

export async function startDocumentUploadAction(input: { documentId: string | null; name: string; fileName: string; sizeBytes: number; folderId?: string | null }): Promise<DocUploadTicket> {
  const admin = await requireAdmin();
  if (input.documentId && !UUID.test(input.documentId)) return { ok: false, error: "Invalid document." };
  try {
    const t = await startVersionUpload(documentDeps(), { documentId: input.documentId, name: String(input.name ?? "").slice(0, 120), fileName: String(input.fileName).slice(0, 300), sizeBytes: Number(input.sizeBytes), adminId: admin.userId });
    if (!input.documentId && input.folderId && UUID.test(input.folderId)) await moveFile(internal(), t.document.id, input.folderId).catch(() => null);
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
  await act(`/documents/${id}?tab=settings`, async () => {
    if (!UUID.test(id)) throw new ValidationError("Document not found.");
    const name = str(form, "name").replace(/\s+/g, " ").trim().slice(0, 120);
    if (name.length < 2) throw new ValidationError("Give the document a name.");
    await documentDeps().repo.updateDocument(id, { name, description: str(form, "description").trim().slice(0, 1000) || null });
    return { notice: "Saved." };
  });
}

export async function saveFieldMapAction(form: FormData) {
  const id = str(form, "id");
  await act(`/documents/${id}?tab=file`, async (adminId) => {
    if (!UUID.test(id)) throw new ValidationError("Document not found.");
    const raw: Record<string, unknown> = {};
    for (const [key, value] of form.entries()) if (key.startsWith("box:") && typeof value === "string") raw[key.slice(4)] = value;
    await saveFieldMap(documentDeps(), id, raw, adminId);
    return { notice: "Saved. The boxes are filled in this way every time it's sent." };
  });
}

export async function saveConsentAction(form: FormData) {
  const id = str(form, "id");
  await act(`/documents/${id}?tab=settings`, async (adminId) => {
    if (!UUID.test(id)) throw new ValidationError("Document not found.");
    await setConsentText(documentDeps(), id, str(form, "consent"), adminId);
    return { notice: "Signing consent statement saved. New signature requests show this text; earlier ones keep the text their signer saw." };
  });
}

export async function revokeDeliveryAction(form: FormData) {
  const id = str(form, "document_id");
  await act(`/documents/${id}?tab=sent`, async (adminId) => {
    const deliveryId = str(form, "delivery_id");
    if (!UUID.test(deliveryId)) throw new ValidationError("Not found.");
    await revokeDelivery(documentDeps(), deliveryId, adminId);
    return { notice: "The link no longer works. An open signature request was voided." };
  });
}

/** Where to come back to: the library, inside the folder the person was looking at. */
const here = (form: FormData) => (UUID.test(str(form, "folder")) ? `/documents?internal=1&folder=${str(form, "folder")}` : "/documents?internal=1");
const internal = () => internalScope(documentDeps().repo);

export async function createFolderAction(form: FormData) {
  await act(here(form), async (adminId) => {
    await createFolder(internal(), { name: str(form, "name"), parent_id: str(form, "folder") }, adminId);
    return { notice: "Folder created." };
  });
}

export async function renameFolderAction(form: FormData) {
  await act(here(form), async () => {
    await renameFolder(internal(), str(form, "id"), str(form, "name"));
    return { notice: "Folder renamed." };
  });
}

export async function deleteFolderAction(form: FormData) {
  await act(here(form), async () => {
    const f = await deleteFolder(internal(), str(form, "id"));
    return { notice: `Folder "${f.name}" deleted. What was inside moved up.` };
  });
}

export async function moveDocumentAction(form: FormData) {
  const back = str(form, "back");
  await act(/^\/documents\/[0-9a-f-]{36}\?tab=settings$/i.test(back) ? back : here(form), async () => {
    await moveFile(internal(), str(form, "id"), str(form, "to"));
    return { notice: "Moved." };
  });
}

/** Drag and drop: moves a document or a folder into a folder (or back to the top). */
export async function moveByDragAction(kind: "item" | "folder", itemId: string, to: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireAdmin();
    if (!UUID.test(itemId) || (to !== null && !UUID.test(to))) throw new ValidationError("That item could not be found.");
    if (kind === "folder") await moveFolder(internal(), itemId, to);
    else await moveFile(internal(), itemId, to);
    revalidatePath("/documents", "layout");
    return { ok: true };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    console.error(`documents move failed: ${sanitizeError(e, 200)}`);
    return { ok: false, error: "That did not work. Nothing was moved." };
  }
}

/** The client search behind "Send to a client". */
export async function searchClientsAction(q: string): Promise<{ id: string; name: string; email: string | null }[]> {
  await requireAdmin();
  const term = String(q ?? "").trim().slice(0, 80);
  if (term.length < 2) return [];
  return (await workspaceRepo().listClients({ q: term, includeArchived: false })).slice(0, 8).map((c) => ({ id: c.id, name: c.full_name, email: c.email }));
}

/** "Send to a client" on a document's page. */
export async function sendToClientAction(form: FormData) {
  const id = str(form, "id");
  await act(`/documents/${id}`, async (adminId) => {
    const clientId = str(form, "client_id");
    if (!UUID.test(id) || !UUID.test(clientId)) throw new ValidationError("Choose a client.");
    const client = await workspaceRepo().getClient(clientId);
    if (!client) throw new ValidationError("That client wasn't found.");
    const asks = Object.fromEntries([...form.entries()].filter(([k, v]) => k.startsWith("ask.") && typeof v === "string"));
    const notice = await sendDocumentToClient(automationDeps(), { docs: documentDeps(), ssn: ssnDeps() }, {
      documentId: id, kind: str(form, "kind") === "signature" ? "signature" : "send", client, asks, message: str(form, "message"), actorId: adminId,
    });
    return { notice, to: `/documents/${id}?tab=sent` };
  });
}
