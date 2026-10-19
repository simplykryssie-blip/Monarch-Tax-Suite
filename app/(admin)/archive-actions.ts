"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ENTITY, isArchiveEntity, type ArchiveEntity } from "@/lib/archive.ts";
import { archiveRecord, hardDeleteRecord, restoreRecord } from "@/lib/archive-service.ts";
import { archiveStore } from "@/lib/archive-server";

// Archive, restore and permanent delete, for every archivable record. One set of actions so every page behaves the
// same way; the rules live in lib/archive.ts.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const str = (form: FormData, k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
const withParam = (path: string, key: "notice" | "error", message: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;
/** Only a page inside the admin, never another site. */
const safeBack = (raw: string, fallback: string) => (/^\/(?![/\\])[\w\-/?=&.%]*$/.test(raw) ? raw : fallback);

async function act(form: FormData, fn: (entity: ArchiveEntity, id: string, adminId: string) => Promise<{ notice: string; to?: string }>) {
  const admin = await requireAdmin();
  const entity = str(form, "entity");
  const id = str(form, "id");
  const back = safeBack(str(form, "back"), isArchiveEntity(entity) ? ENTITY[entity].list : "/");
  let target: string;
  try {
    if (!isArchiveEntity(entity) || !UUID.test(id)) throw new ValidationError("That record was not found.");
    const r = await fn(entity, id, admin.userId);
    target = withParam(r.to ?? back, "notice", r.notice);
  } catch (e) {
    if (e instanceof ValidationError) target = withParam(back, "error", e.message);
    else {
      console.error(`archive action failed: ${sanitizeError(e, 200)}`);
      target = withParam(back, "error", /archive_log|archived_at|schema cache|does not exist/i.test(e instanceof Error ? e.message : "") ? "Archiving is not installed yet. Apply the archive migration first." : "That did not work. Nothing was changed. Please try again.");
    }
  }
  revalidatePath("/", "layout");
  redirect(target);
}

export async function archiveRecordAction(form: FormData) {
  await act(form, async (entity, id, adminId) => {
    await archiveRecord(archiveStore(), entity, id, adminId, str(form, "reason"));
    const noun = ENTITY[entity].noun;
    return { notice: `Archived. The ${noun} is hidden from the list; find it under Archived to restore it.` };
  });
}

export async function restoreRecordAction(form: FormData) {
  await act(form, async (entity, id, adminId) => {
    await restoreRecord(archiveStore(), entity, id, adminId);
    const extra = entity === "product" ? " It's unpublished: publish it again when it's ready to sell." : entity === "workflow" ? " It's paused: turn it on when you're ready." : entity === "form" ? " It's closed: reopen it to take submissions." : "";
    return { notice: `Restored.${extra}` };
  });
}

export async function hardDeleteRecordAction(form: FormData) {
  await act(form, async (entity, id, adminId) => {
    await hardDeleteRecord(archiveStore(), entity, id, adminId, str(form, "confirm"));
    return { notice: `Permanently deleted. The archive history keeps a note of what it was. Any files it had are permanently deleted from storage in 24 hours and can't be recovered after that.`, to: `${ENTITY[entity].list}?view=archived` };
  });
}
