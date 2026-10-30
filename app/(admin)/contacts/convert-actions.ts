"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { convertLeadToClient } from "@/lib/contacts/convert.ts";
import { moveLeadDocs } from "@/lib/leads/docs-server";
import { leadsDeps } from "@/lib/leads/server";
import { UUID } from "@/lib/leads/service.ts";
import { workspaceRepo } from "@/lib/workspace/server";

const str = (form: FormData, k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
const backTo = (raw: string) => (/^\/(?!\/)[A-Za-z0-9\-._~/?#=&%]*$/.test(raw) ? raw : "/contacts");
const to = (path: string, key: "notice" | "error", message: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;

/** The manual route from lead to client: makes the client record and opens it. */
export async function convertLeadAction(form: FormData) {
  const admin = await requireAdmin();
  const id = str(form, "id");
  const back = backTo(str(form, "back"));
  let target: string;
  try {
    if (!UUID.test(id)) throw new ValidationError("That lead wasn't found.");
    const { client, alreadyClient } = await convertLeadToClient(workspaceRepo(), leadsDeps(), id, { id: admin.userId, email: admin.email }, moveLeadDocs);
    target = to(`/workspace/clients/${client.id}`, "notice", alreadyClient ? `${client.full_name} was already a client. The lead is marked converted.` : `${client.full_name} is now a client. The lead is marked converted.`);
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ValidationError) target = to(back, "error", e.message);
    else {
      console.error(`convert lead failed: ${sanitizeError(e, 200)}`);
      target = to(back, "error", "That did not work. Nothing was changed. Please try again.");
    }
  }
  revalidatePath("/contacts", "layout");
  revalidatePath("/leads", "layout");
  revalidatePath("/workspace", "layout");
  redirect(target);
}
