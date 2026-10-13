import { emitEvent, senderFor, type AutomationDeps } from "../automation/engine.ts";
import { sanitizeError } from "../automation/sanitize.ts";
import { formatInZone } from "../documents/signing.ts";
import { firmSubmissionEmail, respondentConfirmationEmail, resumeEmail } from "./emails.ts";
import { linkCustomer, linkFirm, makePdfSafe, type FormDeps, type PublicForm } from "./service.ts";
import { readSettings } from "./settings.ts";
import type { Submission } from "./types.ts";

// What follows a submission: the PDF, the customer and firm records, the firm's notice, the respondent's
// confirmation, and the `form.submitted` workflow event. Each step is logged and retried by the scheduled job where
// it can be; none of them undoes or blocks the submission itself. Spam and test submissions notify nobody.

const allowedTo = (auto: AutomationDeps, to: string) => auto.config.env === "production" || auto.config.testRecipients.map((r) => r.toLowerCase()).includes(to.toLowerCase());

async function send(auto: AutomationDeps, senderId: string | null, to: string, mail: { subject: string; html: string; text: string }, key: string): Promise<string | null> {
  if (!allowedTo(auto, to)) return `not sent: ${auto.config.env} environment`;
  let sender;
  try {
    sender = await senderFor(auto, senderId);
  } catch (e) {
    return sanitizeError(e, 200);
  }
  const result = await auto.email.send({ ...sender, to, subject: mail.subject, html: mail.html, text: mail.text, idempotencyKey: key });
  return result.ok ? null : sanitizeError(result.message, 200);
}

/** The firm's notice. Sends once (the provider de-duplicates retries by key) and records the outcome. */
export async function notifyFirm(auto: AutomationDeps, deps: FormDeps, sub: Submission): Promise<void> {
  if (sub.notified_at || sub.is_test || sub.status === "spam" || sub.status === "draft") return;
  const form = await deps.repo.getForm(sub.form_id);
  if (!form) return;
  const settings = readSettings(form.settings);
  const profile = await deps.profile();
  const recipients = settings.notify.recipients.length ? settings.notify.recipients : [profile?.email ?? auto.config.supportRecipient].filter(Boolean);
  const origin = (await auto.config.origin()).replace(/\/$/, "");
  const mail = firmSubmissionEmail({
    firmName: profile?.display_name ?? "Your tax office", formName: form.name, number: sub.number ?? 0,
    submittedAt: formatInZone(new Date(sub.submitted_at ?? sub.created_at), profile?.time_zone ?? "America/New_York"),
    respondent: [sub.respondent_name, sub.respondent_email].filter(Boolean).join(", ") || null,
    adminUrl: `${origin}/forms/${form.id}/submissions/${sub.id}`,
  });
  const problems: string[] = [];
  for (const to of recipients) {
    const p = await send(auto, settings.notify.sender_id, to, mail, `form-notify:${sub.id}:${to}`);
    if (p && !p.startsWith("not sent")) problems.push(`${to}: ${p}`);
  }
  if (problems.length) {
    await deps.repo.updateSubmission(sub.id, { notify_error: problems.join("; ").slice(0, 480) });
    return;
  }
  await deps.repo.updateSubmission(sub.id, { notified_at: new Date().toISOString(), notify_error: recipients.length ? null : "No one to notify: add recipients in the form settings or an email in your firm profile." });
  await deps.repo.addEvent({ form_id: sub.form_id, submission_id: sub.id, type: "notified", actor_id: null, detail: { recipients: recipients.length } });
}

async function confirmRespondent(auto: AutomationDeps, deps: FormDeps, sub: Submission) {
  if (sub.confirmation_sent_at || sub.is_test || sub.status === "spam" || !sub.respondent_email) return;
  const form = await deps.repo.getForm(sub.form_id);
  if (!form) return;
  const settings = readSettings(form.settings);
  if (!settings.confirmation_email) return;
  const profile = await deps.profile();
  const mail = respondentConfirmationEmail({
    firmName: profile?.display_name ?? "Your tax office", formName: form.name, number: sub.number ?? 0, name: sub.respondent_name,
    submittedAt: formatInZone(new Date(sub.submitted_at ?? sub.created_at), profile?.time_zone ?? "America/New_York"), message: settings.confirmation_email_text,
  });
  const problem = await send(auto, settings.notify.sender_id, sub.respondent_email, mail, `form-confirm:${sub.id}`);
  if (!problem) {
    await deps.repo.updateSubmission(sub.id, { confirmation_sent_at: new Date().toISOString() });
    await deps.repo.addEvent({ form_id: sub.form_id, submission_id: sub.id, type: "confirmation_sent", actor_id: null, detail: {} });
  } else if (!problem.startsWith("not sent")) console.error(`forms: confirmation for ${sub.id} not sent: ${problem}`);
}

/** Runs every follow-up for a fresh submission. Never throws. */
export async function afterSubmit(auto: AutomationDeps, deps: FormDeps, submission: Submission, pf: PublicForm): Promise<void> {
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      console.error(`forms: ${name} failed for ${submission.id}: ${sanitizeError(e, 160)}`);
    }
  };
  if (submission.status === "spam") return;
  await step("pdf", () => makePdfSafe(deps, submission.id));
  if (submission.is_test) return;
  const settings = pf.settings;
  let customerId: string | null = null;
  await step("customer", async () => { customerId = await linkCustomer(deps, submission, settings); });
  await step("firm", () => linkFirm(deps, submission.id, settings));
  const fresh = (await deps.repo.getSubmission(submission.id).catch(() => null)) ?? submission;
  await step("notify", () => notifyFirm(auto, deps, fresh));
  await step("confirm", () => confirmRespondent(auto, deps, fresh));
  await step("event", async () => {
    const orderId = customerId ? await deps.repo.latestPaidOrderId(customerId) : null;
    await emitEvent(auto, { type: "form.submitted", key: `form-submission:${submission.id}`, customerId, orderId, data: { form_id: submission.form_id, submission_id: submission.id } });
  });
}

/** Emails the respondent their resume link. */
export async function sendResumeLink(auto: AutomationDeps, deps: FormDeps, input: { pf: PublicForm; email: string; token: string; expiresAt: string }): Promise<string | null> {
  const profile = await deps.profile();
  const origin = (await auto.config.origin()).replace(/\/$/, "");
  const mail = resumeEmail({
    firmName: profile?.display_name ?? "Your tax office", formName: input.pf.form.name,
    url: `${origin}/f/${input.pf.form.public_id}?resume=${input.token}`,
    expiresAt: new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: profile?.time_zone ?? "America/New_York" }).format(new Date(input.expiresAt)),
  });
  return send(auto, input.pf.settings.notify.sender_id, input.email, mail, `form-resume:${input.token.slice(0, 16)}:${new Date().toISOString().slice(0, 13)}`);
}

/** Scheduled retries: firm notices that failed, within two days of the submission. */
export async function retryNotifications(auto: AutomationDeps, deps: FormDeps, subs: Submission[]) {
  for (const s of subs) await notifyFirm(auto, deps, s).catch((e) => console.error(`forms: notify retry failed: ${sanitizeError(e, 120)}`));
}
