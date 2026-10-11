"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { EfinRuleError } from "@/lib/efin/rules.ts";
import { addCredential, addRole, archiveEfin, changeAssignment, completeRenewal, createEfin, requestAssignment, saveFiling, saveLocation, saveOrganization, savePerson, updateEfin, type Actor } from "@/lib/efin/service";

// Every action re-checks administrator access on the server, validates input, and writes an audit event inside the service.
// Browser roles have no write access to these tables at all (row level security), so this is the only write path.

const withParam = (path: string, key: "notice" | "error", message: string) => {
  const [base, hash] = path.split("#");
  return `${base}${base.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}${hash ? `#${hash}` : ""}`;
};

async function mutate(back: string, fn: (actor: Actor) => Promise<{ to?: string; notice: string }>) {
  const session = await requireAdmin();
  let target: string;
  try {
    const r = await fn({ id: session.userId, email: session.email });
    target = withParam(r.to ?? back, "notice", r.notice);
  } catch (e) {
    if (e instanceof EfinRuleError) target = withParam(back, "error", e.message);
    else {
      console.error(`efin action failed: ${sanitizeError(e, 200)}`);
      target = withParam(back, "error", e instanceof Error && /relation|schema cache|does not exist/i.test(e.message) ? "The EFIN Management database tables are not installed yet. Apply the EFIN migration first." : "That did not work. Nothing was changed. Please try again.");
    }
  }
  revalidatePath("/efin", "layout");
  redirect(target);
}

const back = (form: FormData, fallback: string) => {
  const b = String(form.get("back") ?? "");
  return b.startsWith("/efin") ? b : fallback;
};

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
  mutate(back(form, "/efin"), async (a) => {
    await archiveEfin(a, form);
    return { to: "/efin", notice: "EFIN archived. Its history is kept." };
  });

export const saveOrganizationAction = async (form: FormData) =>
  mutate("/efin/offices", async (a) => {
    await saveOrganization(a, form);
    return { notice: "Organization saved." };
  });

export const saveLocationAction = async (form: FormData) =>
  mutate("/efin/offices", async (a) => {
    await saveLocation(a, form);
    return { notice: "Office location added." };
  });

export const savePersonAction = async (form: FormData) =>
  mutate("/efin/people", async (a) => {
    await savePerson(a, form);
    return { notice: "Person added." };
  });

export const addCredentialAction = async (form: FormData) =>
  mutate("/efin/people", async (a) => {
    await addCredential(a, form);
    return { notice: "PTIN recorded as a separate protected credential. Recording it does not authorize e-file." };
  });

export const addRoleAction = async (form: FormData) =>
  mutate("/efin/people", async (a) => {
    await addRole(a, form);
    return { notice: "Role recorded." };
  });

export const requestAssignmentAction = async (form: FormData) =>
  mutate(back(form, "/efin/assignments"), async (a) => {
    const efinId = await requestAssignment(a, form);
    return { to: `/efin/${efinId}?tab=assignments`, notice: "Draft assignment created. Submit it for review when it is ready." };
  });

export const changeAssignmentAction = async (form: FormData) =>
  mutate(back(form, "/efin/assignments"), async (a) => {
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
