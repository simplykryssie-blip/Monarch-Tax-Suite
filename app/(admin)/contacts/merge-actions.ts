"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { leadsDeps } from "@/lib/leads/server";
import { mergeLeads } from "@/lib/leads/service.ts";
import { copySsn, hasStoredSsn } from "@/lib/ssn/service.ts";
import { ssnDeps } from "@/lib/ssn/server";
import { workspaceRepo } from "@/lib/workspace/server";
import { mergeClients } from "@/lib/workspace/service.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (form: FormData, k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
const to = (key: "notice" | "error", message: string) => `/contacts?${key}=${encodeURIComponent(message)}`;

/** Merges one pair from the Possible duplicates list: two clients, two leads, or a lead into a client. The one to keep is chosen by the person. */
export async function mergeContactsAction(form: FormData) {
  const admin = await requireAdmin();
  const kind = str(form, "kind");
  const keep = str(form, "keep");
  const drop = str(form, "drop");
  let target: string;
  try {
    if (!UUID.test(keep) || !UUID.test(drop) || keep === drop) throw new ValidationError("Choose two different contacts to merge.");
    const actor = { id: admin.userId, email: admin.email };
    if (kind === "clients") {
      const ssn = ssnDeps();
      if (!(await hasStoredSsn(ssn, keep)) && (await hasStoredSsn(ssn, drop))) await copySsn(ssn, { from: drop, to: keep, actorId: admin.userId });
      const moved = await mergeClients(workspaceRepo(), keep, drop, actor);
      const parts = Object.entries(moved).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`);
      target = to("notice", `Merged. ${parts.length ? `Moved ${parts.join(", ")}.` : "Nothing needed moving."} The other record is archived.`);
    } else if (kind === "leads") {
      await mergeLeads(leadsDeps(), keep, drop, admin.userId);
      target = to("notice", "Merged. The other lead's details are in the notes, and it is marked Lost.");
    } else if (kind === "lead_into_client") {
      const leads = leadsDeps().repo;
      const lead = await leads.getLead(drop);
      if (!lead) throw new ValidationError("That lead wasn't found.");
      const repo = workspaceRepo();
      if (!(await repo.getClient(keep))) throw new ValidationError("That client wasn't found.");
      const detail = [`Merged from lead ${lead.full_name}`, lead.email, lead.phone, lead.source ? `Source: ${lead.source}` : "", lead.notes ?? ""].filter(Boolean).join("\n");
      await repo.insertNote({ client_id: keep, body: detail.slice(0, 4000), created_by: admin.userId });
      await leads.updateLead(drop, { status: "converted" });
      target = to("notice", `Lead ${lead.full_name} merged into the client and marked converted.`);
    } else throw new ValidationError("That pair can't be merged here.");
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ValidationError) target = to("error", e.message);
    else {
      console.error(`merge contacts failed: ${sanitizeError(e, 200)}`);
      target = to("error", "That did not work. Nothing was merged. Please try again.");
    }
  }
  revalidatePath("/contacts", "layout");
  revalidatePath("/workspace", "layout");
  redirect(target);
}
