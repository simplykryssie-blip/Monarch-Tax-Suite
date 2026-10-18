"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { emitTagChanges } from "@/lib/automation/emit";
import { createLead, deleteLead, importCsv, markContacted, updateLead, UUID, type ImportResult } from "@/lib/leads/service.ts";
import { leadsDeps } from "@/lib/leads/server";

// Leads actions. Every action re-checks administrator access and acts only on the current tenant's rows (the
// tenant-scoped database client), so ids from another tenant are simply not found.

const str = (form: FormData, k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
const to = (path: string, key: "notice" | "error", message: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;
const FIELDS = ["full_name", "email", "phone", "firm_name", "source", "status", "notes", "tags", "last_contacted_at"] as const;
const fieldsOf = (form: FormData) => Object.fromEntries(FIELDS.map((k) => [k, str(form, k)]));

const failure = (e: unknown) => {
  if (e instanceof ValidationError) return e.message;
  console.error(`leads action failed: ${sanitizeError(e, 200)}`);
  if (/relation|schema cache|does not exist/i.test(e instanceof Error ? e.message : "")) return "Leads isn't installed yet. Apply the leads migration first.";
  if (/leads_email_key|duplicate key/i.test(e instanceof Error ? e.message : "")) return "That email is already a lead.";
  return "That did not work. Nothing was changed. Please try again.";
};

async function act(back: string, fn: (adminId: string) => Promise<{ to?: string; notice: string }>) {
  const admin = await requireAdmin();
  let target: string;
  try {
    const r = await fn(admin.userId);
    target = to(r.to ?? back, "notice", r.notice);
  } catch (e) {
    target = to(back, "error", failure(e));
  }
  revalidatePath("/leads", "layout");
  redirect(target);
}

const idOf = (form: FormData) => {
  const id = str(form, "id");
  if (!UUID.test(id)) throw new ValidationError("That lead wasn't found.");
  return id;
};

export type LeadFormState = { error: string; values: Record<string, string> } | undefined;

/** The manual add form. A problem keeps what was typed. */
export async function createLeadAction(_prev: LeadFormState, form: FormData): Promise<LeadFormState> {
  const admin = await requireAdmin();
  const values = fieldsOf(form);
  let id: string;
  try {
    id = (await createLead(leadsDeps(), values, admin.userId)).id;
  } catch (e) {
    return { error: failure(e), values };
  }
  revalidatePath("/leads", "layout");
  redirect(to(`/leads/${id}`, "notice", "Lead added."));
}

export async function updateLeadAction(form: FormData) {
  const id = str(form, "id");
  await act(`/leads/${UUID.test(id) ? id : ""}`, async (adminId) => {
    const leads = leadsDeps();
    const before = (await leads.repo.getLead(idOf(form)))?.tags ?? [];
    const lead = await updateLead(leads, idOf(form), fieldsOf(form), adminId);
    await emitTagChanges({ type: "lead", id: lead.id }, before, lead.tags);
    return { notice: "Saved." };
  });
}

export async function markContactedAction(form: FormData) {
  const id = str(form, "id");
  const back = str(form, "back").startsWith("/leads") ? str(form, "back") : `/leads/${UUID.test(id) ? id : ""}`;
  await act(back, async (adminId) => {
    const lead = await markContacted(leadsDeps(), idOf(form), adminId);
    return { notice: `Marked ${lead.full_name} as contacted today.` };
  });
}

export async function deleteLeadAction(form: FormData) {
  await act("/leads", async () => {
    if (str(form, "confirm") !== "yes") throw new ValidationError("Tick the box to confirm, then delete.");
    await deleteLead(leadsDeps(), idOf(form));
    return { to: "/leads", notice: "Lead deleted." };
  });
}

export type ImportState = { ok: true; result: ImportResult } | { ok: false; error: string } | undefined;

export async function importLeadsAction(_prev: ImportState, form: FormData): Promise<ImportState> {
  const admin = await requireAdmin();
  try {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError("Choose a CSV file.");
    if (file.size > 2_000_000) throw new ValidationError("That file is larger than 2 MB. Split it and import each part.");
    if (!/\.csv$/i.test(file.name) && !/csv|text\/plain/i.test(file.type)) throw new ValidationError("Choose a .csv file (in Excel or Google Sheets: File → Download → CSV).");
    const result = await importCsv(leadsDeps(), await file.text(), str(form, "import_name"), admin.userId);
    revalidatePath("/leads", "layout");
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: failure(e) };
  }
}
