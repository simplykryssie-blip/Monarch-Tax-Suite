"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { archivePipeline, createFolder, createPipeline, DEFAULT_RETURN_STAGES, deleteFolder, deletePipeline, makeDefault, moveFolder, movePipeline, renameFolder, savePipeline, saveDetails, setPublished } from "@/lib/pipelines/service.ts";
import { pipelinesRepo } from "@/lib/pipelines/server";

// Every action re-checks administrator access on the server.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (form: FormData, name = "id") => {
  const v = String(form.get(name) ?? "");
  if (!UUID.test(v)) throw new ValidationError("That item could not be found.");
  return v;
};
const str = (form: FormData, name: string) => String(form.get(name) ?? "");
const withParam = (path: string, key: "notice" | "error", message: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;
/** The page to return to: the Pipelines list, inside the folder the person was looking at. */
const here = (form: FormData) => (UUID.test(str(form, "folder")) ? `/pipelines?folder=${str(form, "folder")}` : "/pipelines");

async function mutate(back: string, fn: (admin: { id: string; email: string }) => Promise<{ to?: string; notice: string }>) {
  const session = await requireAdmin();
  let target: string;
  try {
    const result = await fn({ id: session.userId, email: session.email });
    target = withParam(result.to ?? back, "notice", result.notice);
  } catch (e) {
    if (e instanceof ValidationError) target = withParam(back, "error", e.message);
    else {
      console.error(`pipelines action failed: ${sanitizeError(e, 200)}`);
      target = withParam(back, "error", e instanceof Error && /relation|schema cache|column/i.test(e.message) ? "Pipelines needs its latest database update. Apply it first." : "That did not work. Nothing was changed. Please try again.");
    }
  }
  revalidatePath("/pipelines", "layout");
  revalidatePath("/workspace", "layout");
  redirect(target);
}

export async function createPipelineAction(form: FormData) {
  await mutate(here(form), async (a) => {
    const quick = str(form, "quick") === "1";
    const kind = quick ? "returns" : "custom";
    const p = await createPipeline(pipelinesRepo(), {
      name: str(form, "name"), kind, quickStart: quick, type_label: str(form, "type_label"), color: str(form, "color"), folder_id: str(form, "folder"),
      stages: str(form, "stages") || (kind === "returns" ? DEFAULT_RETURN_STAGES : [{ name: "To do" }, { name: "Doing" }, { name: "Done", done: true }]),
    }, a.id);
    return { to: `/pipelines/${p.id}`, notice: "Pipeline created. Add, rename and reorder its stages, then publish it." };
  });
}

export async function savePipelineAction(form: FormData) {
  await mutate(`/pipelines/${str(form, "id")}`, async () => {
    await savePipeline(pipelinesRepo(), id(form), { name: str(form, "name"), stages: str(form, "stages") });
    return { notice: "Pipeline saved." };
  });
}

export async function savePipelineDetailsAction(form: FormData) {
  await mutate(`/pipelines/${str(form, "id")}`, async () => {
    await saveDetails(pipelinesRepo(), id(form), { type_label: str(form, "type_label"), color: str(form, "color") });
    return { notice: "Saved." };
  });
}

export async function defaultPipelineAction(form: FormData) {
  await mutate(`/pipelines/${str(form, "id")}`, async () => {
    await makeDefault(pipelinesRepo(), id(form));
    return { notice: "This pipeline now runs the tax-return board." };
  });
}

export async function publishPipelineAction(form: FormData) {
  await mutate(here(form), async () => {
    const publish = str(form, "publish") === "yes";
    await setPublished(pipelinesRepo(), id(form), publish);
    return { notice: publish ? "Published. It now appears on the Work board." : "Unpublished. It no longer appears on the Work board or in workflows." };
  });
}

export async function movePipelineAction(form: FormData) {
  await mutate(here(form), async () => {
    await movePipeline(pipelinesRepo(), id(form), str(form, "to"));
    return { notice: "Moved." };
  });
}

export async function archivePipelineAction(form: FormData) {
  await mutate(here(form), async () => {
    const archive = str(form, "archive") === "yes";
    await archivePipeline(pipelinesRepo(), id(form), archive);
    return { notice: archive ? "Pipeline archived. It's listed under Archived pipelines, where you can restore or delete it." : "Pipeline restored." };
  });
}

export async function deletePipelineAction(form: FormData) {
  await mutate(here(form), async () => {
    const p = await deletePipeline(pipelinesRepo(), id(form));
    return { notice: `Pipeline "${p.name}" deleted.` };
  });
}

export async function createFolderAction(form: FormData) {
  await mutate(here(form), async (a) => {
    await createFolder(pipelinesRepo(), { name: str(form, "name"), parent_id: str(form, "folder") }, a.id);
    return { notice: "Folder created." };
  });
}

export async function renameFolderAction(form: FormData) {
  await mutate(here(form), async () => {
    await renameFolder(pipelinesRepo(), id(form), str(form, "name"));
    return { notice: "Folder renamed." };
  });
}

export async function deleteFolderAction(form: FormData) {
  const parent = (await pipelinesRepo().listFolders().catch(() => [])).find((f) => f.id === str(form, "id"))?.parent_id;
  await mutate(parent ? `/pipelines?folder=${parent}` : "/pipelines", async () => {
    const f = await deleteFolder(pipelinesRepo(), id(form));
    return { notice: `Folder "${f.name}" deleted. Whatever was inside moved up a level.` };
  });
}

/** Drag and drop: a pipeline or folder dropped on a folder (or on "All pipelines", to = empty). */
export async function moveByDragAction(kind: "pipeline" | "folder", itemId: string, to: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireAdmin();
    if (!UUID.test(itemId) || (to !== null && !UUID.test(to))) throw new ValidationError("That item could not be found.");
    if (kind === "folder") await moveFolder(pipelinesRepo(), itemId, to);
    else await movePipeline(pipelinesRepo(), itemId, to);
    revalidatePath("/pipelines", "layout");
    return { ok: true };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    console.error(`pipelines move failed: ${sanitizeError(e, 200)}`);
    return { ok: false, error: "That did not work. Nothing was moved." };
  }
}
