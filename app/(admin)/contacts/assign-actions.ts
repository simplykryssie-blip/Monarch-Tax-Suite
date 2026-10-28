"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { leadsDeps } from "@/lib/leads/server";
import { assignLead } from "@/lib/leads/service.ts";
import { checkAssignee } from "@/lib/staff/assign.ts";
import { listStaff } from "@/lib/staff/server";
import { workspaceRepo } from "@/lib/workspace/server";
import { assignClient } from "@/lib/workspace/service.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (form: FormData, k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
/** Where to come back to: a path on this site only. */
const backTo = (raw: string) => (/^\/(?!\/)[A-Za-z0-9\-._~/?#=&%]*$/.test(raw) ? raw : "/contacts");
const to = (path: string, key: "notice" | "error", message: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;

/** Assigns one contact (a client or a lead) to a teammate, or to no one. Only someone on the team can be chosen. */
export async function assignContactAction(form: FormData) {
  const admin = await requireAdmin();
  const kind = str(form, "kind");
  const id = str(form, "id");
  const back = backTo(str(form, "back"));
  let target: string;
  try {
    if (!UUID.test(id) || (kind !== "client" && kind !== "lead")) throw new ValidationError("That contact wasn't found.");
    const who = checkAssignee(await listStaff(), form.get("assignee"));
    if (kind === "client") await assignClient(workspaceRepo(), id, who, { id: admin.userId, email: admin.email });
    else await assignLead(leadsDeps(), id, who, admin.userId);
    target = to(back, "notice", who ? `Assigned to ${who.label}.` : "Now assigned to no one.");
  } catch (e) {
    unstable_rethrow(e);
    target = to(back, "error", e instanceof ValidationError ? e.message : "That did not work. Nothing was changed. Please try again.");
  }
  revalidatePath("/contacts");
  redirect(target);
}
