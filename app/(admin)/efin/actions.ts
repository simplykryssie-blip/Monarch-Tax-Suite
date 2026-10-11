"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { EfinRuleError } from "@/lib/efin/rules.ts";
import { addMember, archiveEfin, archiveOrganization, bulkApply, changeAssignment, completeRenewal, createEfin, deleteEfin, deleteOrganization, onboardEro, requestAssignment, restoreEfin, restoreOrganization, saveFiling, saveLocation, updateEfin, updateLocation, updateOrganization, updatePerson, type Actor } from "@/lib/efin/service";

// Every action re-checks administrator access on the server, validates input, and writes an audit event inside the service.
// Browser roles have no write access to these tables at all (row level security), so this is the only write path.

const withParam = (path: string, key: "notice" | "error", message: string) => {
  const [base, hash] = path.split("#");
  return `${base}${base.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}${hash ? `#${hash}` : ""}`;
};

export type FormResult = { error: string; field?: string } | undefined;

/** On success: redirect with a notice. On a problem: RETURN the message (and the field) so the form keeps everything the user typed. */
async function mutate(back: string, fn: (actor: Actor) => Promise<{ to?: string; notice: string }>): Promise<FormResult> {
  const session = await requireAdmin();
  let target: string;
  try {
    const r = await fn({ id: session.userId, email: session.email });
    target = withParam(r.to ?? back, "notice", r.notice);
  } catch (e) {
    if (e instanceof EfinRuleError) return { error: e.message, field: e.field };
    console.error(`efin action failed: ${sanitizeError(e, 200)}`);
    return { error: e instanceof Error && /relation|schema cache|does not exist/i.test(e.message) ? "The EFIN Management database tables are not installed yet. Apply the EFIN migration first." : "That did not work. Nothing was changed. Please try again." };
  }
  revalidatePath("/efin", "layout");
  redirect(target);
}

const back = (form: FormData, fallback: string) => {
  const b = String(form.get("back") ?? "");
  return b.startsWith("/efin") ? b : fallback;
};

export const onboardEroAction = async (form: FormData) =>
  mutate("/efin/new", async (a) => {
    const id = await onboardEro(a, form);
    return { to: `/efin/${id}`, notice: "ERO added. Everything was saved together; the EFIN stays pending until you verify it." };
  });

export const addMemberAction = async (form: FormData) =>
  mutate(back(form, "/efin"), async (a) => {
    await addMember(a, form);
    return { notice: "Team member added. Recording a PTIN does not authorize e-file." };
  });

export const createEfinAction = async (form: FormData) =>
  mutate("/efin/new", async (a) => {
    const id = await createEfin(a, form);
    return { to: `/efin/${id}`, notice: "EFIN recorded. It stays pending until you verify it." };
  });

export const updateEfinAction = async (form: FormData) =>
  mutate(back(form, "/efin"), async (a) => {
    await updateEfin(a, form);
    return { notice: "EFIN updated." };
  });

export const archiveEfinAction = async (form: FormData) =>
  mutate(back(form, "/efin/list"), async (a) => {
    await archiveEfin(a, form);
    return { to: "/efin/list", notice: "EFIN archived. Its history is kept." };
  });

export const saveLocationAction = async (form: FormData) =>
  mutate(back(form, "/efin"), async (a) => {
    await saveLocation(a, form);
    return { notice: "Office location added." };
  });

export const requestAssignmentAction = async (form: FormData) =>
  mutate(back(form, "/efin"), async (a) => {
    const efinId = await requestAssignment(a, form);
    return { to: `/efin/${efinId}?tab=assignments`, notice: "Draft assignment created. Submit it for review when it is ready." };
  });

export const changeAssignmentAction = async (form: FormData) =>
  mutate(back(form, "/efin"), async (a) => {
    const r = await changeAssignment(a, form);
    return { notice: r.message };
  });

export const saveFilingAction = async (form: FormData) =>
  mutate(back(form, "/efin"), async (a) => {
    await saveFiling(a, form);
    return { notice: "Filing relationship recorded. It is shown with exactly the verification you entered." };
  });

export const completeRenewalAction = async (form: FormData) =>
  mutate("/efin/renewals", async (a) => {
    await completeRenewal(a, form);
    return { notice: "Renewal recorded with its evidence." };
  });

/** Returns the full EFIN to the signed-in administrator after recording the read in the audit log. */
export async function revealEfinAction(efinId: string): Promise<{ value?: string; error?: string }> {
  const session = await requireAdmin();
  try {
    const { revealEfin } = await import("@/lib/efin/service");
    return { value: await revealEfin({ id: session.userId, email: session.email }, efinId) };
  } catch (e) {
    if (e instanceof EfinRuleError) return { error: e.message };
    console.error(`efin reveal failed: ${sanitizeError(e, 200)}`);
    return { error: "Could not reveal the EFIN. Nothing was shown." };
  }
}

const confirmed = (form: FormData, what: string) => {
  if (form.get("confirm") !== "on") throw new EfinRuleError(`Tick the box to confirm ${what}.`, "confirm");
};

export const updateOrganizationAction = async (form: FormData) =>
  mutate(back(form, "/efin/list"), async (a) => {
    await updateOrganization(a, form);
    return { notice: "ERO updated." };
  });

export const updatePersonAction = async (form: FormData) =>
  mutate(back(form, "/efin/list"), async (a) => {
    await updatePerson(a, form);
    return { notice: "Contact updated." };
  });

export const updateLocationAction = async (form: FormData) =>
  mutate(back(form, "/efin/list"), async (a) => {
    await updateLocation(a, form);
    return { notice: form.get("remove") === "on" ? "Location removed. It is kept in the history." : "Location updated." };
  });

export const restoreEfinAction = async (form: FormData) =>
  mutate(back(form, "/efin/list"), async (a) => {
    await restoreEfin(a, String(form.get("id") ?? ""));
    return { notice: "EFIN restored. It is pending verification again." };
  });

export const deleteEfinAction = async (form: FormData) =>
  mutate(back(form, "/efin/list"), async (a) => {
    confirmed(form, "permanently deleting this EFIN");
    await deleteEfin(a, String(form.get("id") ?? ""));
    return { to: "/efin/list", notice: "EFIN deleted permanently." };
  });

export const archiveOrganizationAction = async (form: FormData) =>
  mutate(back(form, "/efin/list"), async (a) => {
    confirmed(form, "archiving this ERO");
    const reason = String(form.get("reason") ?? "").trim();
    if (reason.length < 5) throw new EfinRuleError("Add a reason (a few words).", "reason");
    await archiveOrganization(a, String(form.get("organization_id") ?? ""), reason);
    return { to: "/efin/list", notice: "ERO and its EFINs archived. Nothing was deleted." };
  });

export const restoreOrganizationAction = async (form: FormData) =>
  mutate(back(form, "/efin/list"), async (a) => {
    await restoreOrganization(a, String(form.get("organization_id") ?? ""));
    return { notice: "ERO restored. Its EFINs are pending verification." };
  });

export const deleteOrganizationAction = async (form: FormData) =>
  mutate(back(form, "/efin/list"), async (a) => {
    confirmed(form, "permanently deleting this ERO and everything under it");
    await deleteOrganization(a, String(form.get("organization_id") ?? ""));
    return { to: "/efin/list", notice: "ERO deleted permanently, with its EFINs, locations and team." };
  });

export const bulkAction = async (form: FormData) =>
  mutate(back(form, "/efin/list"), async (a) => {
    const r = await bulkApply(a, form);
    const skipped = r.skipped.length ? ` Skipped ${r.skipped.length}: ${r.skipped.slice(0, 3).map((x) => `${x.label} (${x.why})`).join("; ")}${r.skipped.length > 3 ? "…" : ""}` : "";
    if (r.done === 0 && r.skipped.length) throw new EfinRuleError(`Nothing was changed.${skipped}`);
    return { notice: `Done for ${r.done} row${r.done === 1 ? "" : "s"}.${skipped}`.slice(0, 600) };
  });
