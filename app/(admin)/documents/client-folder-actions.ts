"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { documentDeps } from "@/lib/documents/server";
import { createFolder, deleteFolder, moveFile, moveFolder, renameFolder } from "@/lib/documents/folders.ts";
import { clientScope, driveBack } from "@/lib/workspace/doc-folders.ts";
import { workspaceRepo } from "@/lib/workspace/server";

// A client's folders and files, on the Documents area and on the client's own Documents tab. Both show the same folders.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (form: FormData, k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
const withParam = (path: string, key: "notice" | "error", message: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;

const scopeFor = async (clientId: string) => {
  if (!UUID.test(clientId) || !(await workspaceRepo().getClient(clientId))) throw new ValidationError("That client wasn't found.");
  return clientScope(documentDeps().repo, workspaceRepo(), clientId);
};

async function act(form: FormData, fn: (adminId: string) => Promise<string>) {
  const admin = await requireAdmin();
  const back = driveBack(str(form, "back"), "/documents");
  let target: string;
  try {
    target = withParam(back, "notice", await fn(admin.userId));
  } catch (e) {
    if (e instanceof ValidationError) target = withParam(back, "error", e.message);
    else {
      console.error(`client folder action failed: ${sanitizeError(e, 200)}`);
      target = withParam(back, "error", "That did not work. Nothing was changed. Please try again.");
    }
  }
  revalidatePath("/documents", "layout");
  revalidatePath("/workspace", "layout");
  redirect(target);
}

export async function createClientFolderAction(form: FormData) {
  await act(form, async (adminId) => {
    await createFolder(await scopeFor(str(form, "client_id")), { name: str(form, "name"), parent_id: str(form, "folder") }, adminId);
    return "Folder created.";
  });
}

export async function renameClientFolderAction(form: FormData) {
  await act(form, async () => {
    await renameFolder(await scopeFor(str(form, "client_id")), str(form, "id"), str(form, "name"));
    return "Folder renamed.";
  });
}

export async function deleteClientFolderAction(form: FormData) {
  await act(form, async () => {
    const f = await deleteFolder(await scopeFor(str(form, "client_id")), str(form, "id"));
    return `Folder "${f.name}" deleted. What was inside moved up.`;
  });
}

export async function moveClientFileAction(form: FormData) {
  await act(form, async () => {
    await moveFile(await scopeFor(str(form, "client_id")), str(form, "id"), str(form, "to"));
    return "Moved.";
  });
}

/** Drag and drop inside one client's folders. Bound to the client where the page is drawn. */
export async function moveClientByDragAction(clientId: string, kind: "item" | "folder", itemId: string, to: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireAdmin();
    if (!UUID.test(itemId) || (to !== null && !UUID.test(to))) throw new ValidationError("That item could not be found.");
    const scope = await scopeFor(clientId);
    if (kind === "folder") await moveFolder(scope, itemId, to);
    else await moveFile(scope, itemId, to);
    revalidatePath("/documents", "layout");
    revalidatePath("/workspace", "layout");
    return { ok: true };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    console.error(`client folder move failed: ${sanitizeError(e, 200)}`);
    return { ok: false, error: "That did not work. Nothing was moved." };
  }
}
