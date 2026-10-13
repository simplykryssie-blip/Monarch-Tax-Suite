"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { automationDeps, workflowCatalog } from "@/lib/automation/server";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { formDeps } from "@/lib/forms/server";
import { linkFirm, makePdf, createForm, duplicateForm, emptySpam, publishForm, removeForm, revealAnswer, saveDraft, saveFormDetails, saveSettings, setFormStatus, setSubmissionStatus, submitForm, SubmissionInvalid } from "@/lib/forms/service.ts";
import { readSettings } from "@/lib/forms/settings.ts";
import { REVIEW_STATUSES, type SubmissionStatus } from "@/lib/forms/types.ts";
import { signatureFrom, type SignaturePayload } from "@/lib/forms/signature-input.ts";
import type { RawAnswers } from "@/lib/forms/logic.ts";
import type { SubmitResult } from "@/app/f/[id]/actions";
import { afterSubmit } from "@/lib/forms/after.ts";

// Form Builder actions. Every action re-checks administrator access and acts only on the current tenant's rows
// (the tenant-scoped database client), so ids from another tenant are simply not found.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const str = (form: FormData, k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
const withParam = (path: string, key: "notice" | "error", message: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;
const idOf = (form: FormData, k = "id") => {
  const v = str(form, k);
  if (!UUID.test(v)) throw new ValidationError("Not found.");
  return v;
};

const failure = (e: unknown) => {
  if (e instanceof ValidationError) return e.message;
  console.error(`forms action failed: ${sanitizeError(e, 200)}`);
  const m = e instanceof Error ? e.message : "";
  if (/relation|schema cache|does not exist/i.test(m)) return "The Form Builder is not installed yet. Apply the forms migration first.";
  if (/SUBMISSION_KEPT/.test(m)) return "Submitted forms are kept and can't be deleted.";
  if (/SUBMISSION_LOCKED/.test(m)) return "Answers can't be changed after submission.";
  return "That did not work. Nothing was changed. Please try again.";
};

async function act(back: string, fn: (adminId: string) => Promise<{ to?: string; notice: string }>) {
  const admin = await requireAdmin();
  let target: string;
  try {
    const r = await fn(admin.userId);
    target = withParam(r.to ?? back, "notice", r.notice);
  } catch (e) {
    target = withParam(back, "error", failure(e));
  }
  revalidatePath("/forms", "layout");
  redirect(target);
}

export async function createFormAction(form: FormData) {
  await act("/forms", async (adminId) => {
    const f = await createForm(formDeps(), { name: str(form, "name"), description: str(form, "description"), adminId });
    return { to: `/forms/${f.id}`, notice: "Form created. Drag questions onto the page to build it." };
  });
}

/** Builder autosave. Returns what still needs fixing before publishing, if anything. */
export async function saveDraftAction(formId: string, definition: unknown): Promise<{ ok: true; savedAt: string; problem: { message: string; target?: string } | null } | { ok: false; error: string }> {
  const admin = await requireAdmin();
  try {
    if (!UUID.test(formId)) throw new ValidationError("Not found.");
    const r = await saveDraft(formDeps(), formId, definition, admin.userId);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: failure(e) };
  }
}

export async function publishFormAction(form: FormData) {
  const id = str(form, "id");
  await act(`/forms/${id}`, async (adminId) => {
    const v = await publishForm(formDeps(), idOf(form), adminId);
    return { notice: v.version === 1 ? "Published. The public link is live." : `Published version ${v.version}. New submissions use it; earlier ones keep their version.` };
  });
}

export async function formStatusAction(form: FormData) {
  const id = str(form, "id");
  const to = str(form, "to");
  await act(`/forms/${id}/settings`, async (adminId) => {
    if (to !== "closed" && to !== "published" && to !== "archived" && to !== "restore") throw new ValidationError("Choose an action.");
    await setFormStatus(formDeps(), idOf(form), to, adminId);
    return { notice: to === "closed" ? "Form closed. The link now shows your closed message." : to === "published" ? "Form reopened." : to === "archived" ? "Form archived." : "Form restored." };
  });
}

export async function duplicateFormAction(form: FormData) {
  await act(`/forms/${str(form, "id")}/settings`, async (adminId) => {
    const copy = await duplicateForm(formDeps(), idOf(form), adminId);
    return { to: `/forms/${copy.id}`, notice: "Copy made. It's a draft with its own link." };
  });
}

export async function removeFormAction(form: FormData) {
  await act(`/forms/${str(form, "id")}/settings`, async (adminId) => {
    const deps = formDeps();
    const f = await deps.repo.getForm(idOf(form));
    if (!f || str(form, "confirm_name").trim() !== f.name) throw new ValidationError("Type the form's exact name to confirm.");
    const r = await removeForm(deps, f.id, adminId);
    return r === "deleted" ? { to: "/forms", notice: "Form deleted." } : { notice: "This form has submissions, so it was archived instead. Its submissions are kept." };
  });
}

export async function saveFormDetailsAction(form: FormData) {
  await act(`/forms/${str(form, "id")}/settings`, async (adminId) => {
    await saveFormDetails(formDeps(), idOf(form), { name: str(form, "name"), description: str(form, "description"), consent: str(form, "consent") }, adminId);
    return { notice: "Saved." };
  });
}

export async function saveFormSettingsAction(form: FormData) {
  await act(`/forms/${str(form, "id")}/settings`, async (adminId) => {
    const people = [0, 1, 2, 3, 4, 5].map((i) => ({ role: str(form, `p_role_${i}`), name_key: str(form, `p_name_${i}`), email_key: str(form, `p_email_${i}`), phone_key: str(form, `p_phone_${i}`), ptin_key: str(form, `p_ptin_${i}`) }));
    const raw = {
      respondent: { email_key: str(form, "email_key"), name_key: str(form, "name_key") },
      create_customer: form.get("create_customer") === "on",
      firm: {
        enabled: form.get("firm_enabled") === "on", relationship: str(form, "firm_relationship"),
        legal_name_key: str(form, "firm_legal_name"), dba_name_key: str(form, "firm_dba"), ein_key: str(form, "firm_ein"), efin_key: str(form, "firm_efin"), address_key: str(form, "firm_address"),
        people,
      },
      notify: { recipients: str(form, "recipients"), sender_id: str(form, "sender_id") },
      confirmation_email: form.get("confirmation_email") === "on",
      confirmation_email_text: str(form, "confirmation_email_text"),
      confirmation_message: str(form, "confirmation_message"),
      closed_message: str(form, "closed_message"),
      close_at: str(form, "close_at"),
      max_submissions: str(form, "max_submissions"),
      allow_save_later: form.get("allow_save_later") === "on",
    };
    const senders = (await workflowCatalog()).senders.map((s) => s.id);
    await saveSettings(formDeps(), idOf(form), raw, senders, adminId);
    return { notice: "Settings saved." };
  });
}

export async function submissionStatusAction(form: FormData) {
  const back = `/forms/${str(form, "form_id")}/submissions/${str(form, "id")}`;
  await act(back, async (adminId) => {
    const status = str(form, "status") as SubmissionStatus;
    if (!REVIEW_STATUSES.includes(status)) throw new ValidationError("Choose a status.");
    await setSubmissionStatus(formDeps(), idOf(form), status, adminId);
    return { notice: "Status changed." };
  });
}

export async function retryFirmAction(form: FormData) {
  const back = `/forms/${str(form, "form_id")}/submissions/${str(form, "id")}`;
  await act(back, async () => {
    const deps = formDeps();
    const sub = await deps.repo.getSubmission(idOf(form));
    if (!sub || sub.status === "draft") throw new ValidationError("Not found.");
    const f = await deps.repo.getForm(sub.form_id);
    await deps.repo.updateSubmission(sub.id, { firm_status: "none", firm_error: null });
    const org = await linkFirm(deps, sub.id, readSettings(f?.settings));
    const after = await deps.repo.getSubmission(sub.id);
    if (!org) throw new ValidationError(after?.firm_error ?? "No firm record was made. Check the form's firm settings.");
    return { notice: after?.firm_status === "created" ? "Firm record created in My Service Bureau." : "Linked to the existing firm." };
  });
}

export async function remakePdfAction(form: FormData) {
  const back = `/forms/${str(form, "form_id")}/submissions/${str(form, "id")}`;
  await act(back, async () => {
    await makePdf(formDeps(), idOf(form));
    return { notice: "PDF made from the same answers. The earlier fingerprint is kept in the history." };
  });
}

export async function emptySpamAction(form: FormData) {
  await act(`/forms/${str(form, "id")}/submissions?status=spam`, async (adminId) => {
    const n = await emptySpam(formDeps(), idOf(form), adminId);
    return { notice: n ? `Removed ${n} spam submission${n > 1 ? "s" : ""}.` : "There was no spam to remove." };
  });
}

/** An administrator reveals one encrypted answer. Recorded in the submission's history. */
export async function revealAnswerAction(submissionId: string, key: string): Promise<{ ok: true; value: string } | { ok: false; error: string }> {
  const admin = await requireAdmin();
  try {
    if (!UUID.test(submissionId) || !/^[a-z][a-z0-9_]{0,39}$/.test(key)) throw new ValidationError("Not found.");
    return { ok: true, value: await revealAnswer(formDeps(), submissionId, key, admin.userId) };
  } catch (e) {
    return { ok: false, error: failure(e) };
  }
}

/** "Test this form": a submission of the published version, marked TEST (no notices, records or workflows). */
export async function testSubmitAction(formId: string, input: { token: string | null; answers: RawAnswers; signature: SignaturePayload; stamp: string }): Promise<SubmitResult> {
  await requireAdmin();
  try {
    if (!UUID.test(formId)) throw new ValidationError("Not found.");
    const deps = formDeps();
    const f = await deps.repo.getForm(formId);
    if (!f) throw new ValidationError("Not found.");
    const token = typeof input.token === "string" && /^[A-Za-z0-9_-]{40,60}$/.test(input.token) ? input.token : null;
    const { submission, pf } = await submitForm(deps, f.public_id, { token, answers: input.answers ?? {}, signature: signatureFrom(input.signature), honeypot: "", stamp: String(input.stamp ?? ""), isTest: true }, { ipHash: null, userAgent: "admin test" });
    await afterSubmit(automationDeps(), deps, submission, pf);
    return { ok: true, redirect: `/forms/${f.id}/submissions/${submission.id}?notice=${encodeURIComponent("Test submission saved.")}` };
  } catch (e) {
    if (e instanceof SubmissionInvalid) return { ok: false, error: "Some answers need attention.", errors: e.errors };
    return { ok: false, error: failure(e) };
  }
}
