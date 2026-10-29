"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { addMethod, makePrimary, removeMethod, type MethodOwner } from "@/lib/contacts/methods.ts";
import { methodsDeps } from "@/lib/contacts/methods-server";
import { UUID } from "@/lib/leads/service.ts";

const str = (form: FormData, k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
const backTo = (raw: string) => (/^\/(?!\/)[A-Za-z0-9\-._~/?#=&%]*$/.test(raw) ? raw : "/contacts");
const to = (back: string, key: "notice" | "error", message: string) => `${back}${back.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;

async function run(form: FormData, fn: (owner: MethodOwner, adminId: string) => Promise<string>) {
  const admin = await requireAdmin();
  const back = backTo(str(form, "back"));
  let target: string;
  try {
    const kind = str(form, "owner_kind");
    const id = str(form, "owner_id");
    if ((kind !== "client" && kind !== "lead") || !UUID.test(id)) throw new ValidationError("That person wasn't found.");
    target = to(back, "notice", await fn({ kind, id }, admin.userId));
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ValidationError) target = to(back, "error", e.message);
    else {
      console.error(`contact methods failed: ${sanitizeError(e, 200)}`);
      target = to(back, "error", /relation|schema cache|does not exist/i.test(e instanceof Error ? e.message : "") ? "Extra emails and phones aren't installed yet." : "That did not work. Nothing was changed. Please try again.");
    }
  }
  revalidatePath("/contacts", "layout");
  revalidatePath("/workspace", "layout");
  redirect(target);
}

export async function addMethodAction(form: FormData) {
  await run(form, async (owner, adminId) => {
    const m = await addMethod(methodsDeps(), owner, { kind: form.get("kind"), label: form.get("label"), value: form.get("value") }, adminId);
    return `${m.kind === "email" ? "Email" : "Phone"} added.`;
  });
}

export async function removeMethodAction(form: FormData) {
  await run(form, async (owner, adminId) => { await removeMethod(methodsDeps(), owner, str(form, "id"), adminId); return "Removed."; });
}

export async function makePrimaryAction(form: FormData) {
  await run(form, async (owner, adminId) => { await makePrimary(methodsDeps(), owner, str(form, "id"), adminId); return "Now the main one. The old main one is kept in the list."; });
}
