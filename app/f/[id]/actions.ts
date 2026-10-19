"use server";

import { cookies } from "next/headers";
import { after } from "next/server";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { automationDeps } from "@/lib/automation/server";
import { afterSubmit, sendResumeLink } from "@/lib/forms/after.ts";
import { formContext, formVisitor, RECEIPT_COOKIE } from "@/lib/forms/public";
import { formLink } from "@/lib/forms/link";
import { isPublicId, removeUpload, saveForLater, startUpload, submitForm, SubmissionInvalid } from "@/lib/forms/service.ts";
import { signatureFrom, type SignaturePayload } from "@/lib/forms/signature-input.ts";
import type { RawAnswers } from "@/lib/forms/logic.ts";

// Public form actions. The public id names the form, and its tenant is the only tenant these act for. Every action
// is limited per visitor and per form; answers and files are checked again on the server.

export type UploadTicket = { ok: true; uploadId: string; uploadUrl: string; contentType: string; token: string; fileName: string } | { ok: false; error: string };
export type SubmitResult = { ok: true; redirect: string } | { ok: false; error: string; errors?: Record<string, string> };
export type SaveResult = { ok: true; token: string; email: string } | { ok: false; error: string };

const problem = (e: unknown, what: string) => {
  if (e instanceof ValidationError) return e.message;
  console.error(`public form ${what} failed: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
  return "Something went wrong on our side. Your answers are still on this page; please try again in a minute.";
};
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const tokenOf = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9_-]{40,60}$/.test(v) ? v : null);

async function context(publicId: string) {
  if (!isPublicId(publicId)) throw new ValidationError("This form link is not valid.");
  const ctx = await formContext(publicId);
  if (!ctx) throw new ValidationError("This form link is not valid.");
  return ctx;
}

export async function startFormUploadAction(publicId: string, input: { token: string | null; fieldKey: string; fileName: string; sizeBytes: number }): Promise<UploadTicket> {
  try {
    const who = await formVisitor(publicId, "upload");
    const ctx = await context(publicId);
    const t = await startUpload(ctx.deps, publicId, { token: tokenOf(input.token), fieldKey: str(input.fieldKey, 40), fileName: str(input.fileName, 300), sizeBytes: Number(input.sizeBytes) }, who);
    return { ok: true, ...t };
  } catch (e) {
    return { ok: false, error: problem(e, "upload") };
  }
}

export async function removeFormUploadAction(publicId: string, token: string, uploadId: string): Promise<void> {
  try {
    const ctx = await context(publicId);
    const t = tokenOf(token);
    if (t) await removeUpload(ctx.deps, publicId, t, str(uploadId, 40));
  } catch {
    // Nothing to tell the respondent: the file simply stays off the form.
  }
}

export async function saveFormForLaterAction(publicId: string, input: { token: string | null; answers: RawAnswers; email: string }): Promise<SaveResult> {
  try {
    const who = await formVisitor(publicId, "save");
    const ctx = await context(publicId);
    const { token, draft, pf } = await saveForLater(ctx.deps, publicId, { token: tokenOf(input.token), answers: input.answers ?? {}, email: str(input.email, 254) }, who);
    const formUrl = await formLink(ctx.deps, publicId, pf.settings);
    if (!formUrl) return { ok: false, error: "Your answers are saved, but this office has not finished setting up its web address, so we couldn't email your link. Please contact the office." };
    const failed = await sendResumeLink(automationDeps(ctx.tenantId), ctx.deps, { pf, email: draft.resume_email!, token, expiresAt: draft.draft_expires_at!, formUrl });
    if (failed && !failed.startsWith("Not sent")) return { ok: false, error: "Your answers are saved, but the email with your link could not be sent. Keep this page open and try again." };
    return { ok: true, token, email: draft.resume_email! };
  } catch (e) {
    return { ok: false, error: problem(e, "save") };
  }
}

export async function submitFormAction(publicId: string, input: { token: string | null; answers: RawAnswers; signature: SignaturePayload; honeypot: string; stamp: string }): Promise<SubmitResult> {
  try {
    const who = await formVisitor(publicId, "submit");
    const ctx = await context(publicId);
    const { submission, receiptToken, pf } = await submitForm(ctx.deps, publicId, {
      token: tokenOf(input.token), answers: input.answers ?? {}, signature: signatureFrom(input.signature), honeypot: str(input.honeypot, 200), stamp: str(input.stamp, 80),
    }, who);
    (await cookies()).set(RECEIPT_COOKIE, `${submission.id}.${receiptToken}`, { httpOnly: true, secure: true, sameSite: "lax", path: `/f/${publicId}`, maxAge: 3600 });
    // The PDF, records, notices and workflows run after the respondent sees the confirmation.
    after(() => afterSubmit(automationDeps(ctx.tenantId), ctx.deps, submission, pf));
    // The form's "after submission" choice: its own confirmation page, or the web address the administrator set.
    const away = pf.settings.after_submit === "redirect" ? pf.settings.redirect_url : null;
    return { ok: true, redirect: away ?? `/f/${publicId}/done` };
  } catch (e) {
    if (e instanceof SubmissionInvalid) return { ok: false, error: "Some answers need attention.", errors: e.errors };
    return { ok: false, error: problem(e, "submit") };
  }
}
