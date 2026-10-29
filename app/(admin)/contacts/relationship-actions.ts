"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { addRelationship, removeRelationship, type PersonRef } from "@/lib/contacts/relationships.ts";
import { relationshipsDeps } from "@/lib/contacts/relationships-server";
import { UUID } from "@/lib/leads/service.ts";

const str = (form: FormData, k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
const backTo = (raw: string) => (/^\/(?!\/)[A-Za-z0-9\-._~/?#=&%]*$/.test(raw) ? raw : "/contacts");
const to = (back: string, key: "notice" | "error", message: string) => `${back}${back.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;
const person = (kind: string, id: string): PersonRef => {
  if ((kind !== "client" && kind !== "lead") || !UUID.test(id)) throw new ValidationError("That person wasn't found.");
  return { kind, id };
};

async function run(form: FormData, fn: (adminId: string) => Promise<string>) {
  const admin = await requireAdmin();
  const back = backTo(str(form, "back"));
  let target: string;
  try {
    target = to(back, "notice", await fn(admin.userId));
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ValidationError) target = to(back, "error", e.message);
    else {
      console.error(`relationships failed: ${sanitizeError(e, 200)}`);
      target = to(back, "error", /relation|schema cache|does not exist/i.test(e instanceof Error ? e.message : "") ? "Relationships aren't installed yet." : "That did not work. Nothing was changed. Please try again.");
    }
  }
  revalidatePath("/contacts", "layout");
  revalidatePath("/workspace", "layout");
  redirect(target);
}

export async function addRelationshipAction(form: FormData) {
  await run(form, async (adminId) => {
    await addRelationship(relationshipsDeps(), person(str(form, "owner_kind"), str(form, "owner_id")), person(str(form, "other_kind"), str(form, "other_id")), form.get("kind"), form.get("note"), adminId);
    return "Relationship added.";
  });
}

export async function removeRelationshipAction(form: FormData) {
  await run(form, async (adminId) => {
    await removeRelationship(relationshipsDeps(), person(str(form, "owner_kind"), str(form, "owner_id")), str(form, "id"), adminId);
    return "Relationship removed.";
  });
}
