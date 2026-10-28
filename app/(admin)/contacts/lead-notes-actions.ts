"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { emitTagChanges } from "@/lib/automation/emit";
import { leadsDeps } from "@/lib/leads/server";
import { LeadInputError, saveLeadNotesAndTags, UUID } from "@/lib/leads/service.ts";

const str = (form: FormData, k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
const backTo = (raw: string) => (/^\/(?!\/)[A-Za-z0-9\-._~/?#=&%]*$/.test(raw) ? raw : "/contacts");
const to = (back: string, key: "notice" | "error", message: string) => `${back}${back.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;

/** Saves the notes and tags of a lead from a contact's page. */
export async function saveLeadNotesAction(form: FormData) {
  const admin = await requireAdmin();
  const id = str(form, "id");
  const back = backTo(str(form, "back"));
  let target: string;
  try {
    if (!UUID.test(id)) throw new ValidationError("That lead wasn't found.");
    const deps = leadsDeps();
    const before = (await deps.repo.getLead(id))?.tags ?? [];
    const lead = await saveLeadNotesAndTags(deps, id, { notes: form.get("notes"), tags: form.get("tags") }, admin.userId);
    await emitTagChanges({ type: "lead", id: lead.id }, before, lead.tags);
    target = to(back, "notice", "Notes and tags saved.");
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ValidationError || e instanceof LeadInputError) target = to(back, "error", e.message);
    else {
      console.error(`lead notes failed: ${sanitizeError(e, 200)}`);
      target = to(back, "error", "That did not work. Nothing was changed. Please try again.");
    }
  }
  revalidatePath("/contacts", "layout");
  revalidatePath("/leads", "layout");
  redirect(target);
}
