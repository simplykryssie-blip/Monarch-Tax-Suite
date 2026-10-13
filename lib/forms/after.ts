import { emitEvent, senderFor, type AutomationDeps } from "../automation/engine.ts";
import { sanitizeError } from "../automation/sanitize.ts";
import { formatInZone } from "../documents/signing.ts";
import { firmSubmissionEmail, respondentConfirmationEmail, resumeEmail } from "./emails.ts";
import { brandFor, linkCustomer, linkFirm, makePdfSafe, type FormDeps, type PublicForm } from "./service.ts";
import { readSettings, type FormSettings } from "./settings.ts";
import type { Submission } from "./types.ts";

// What follows a submission: the PDF, the customer and firm records, the firm's notice, the respondent's
// confirmation, and the `form.submitted` workflow event. Each step is logged and retried by the scheduled job where
// it can be; none of them undoes or blocks the submission itself. Spam and test submissions notify nobody.

const allowedTo = (auto: AutomationDeps, to: string) => auto.config.env === "production" || auto.config.testRecipients.map((r) => r.toLowerCase()).includes(to.toLowerCase());

/** Why an email was held back outside production, in words an administrator can act on. */
export const heldBack = (auto: AutomationDeps, to: string) =>
  `Not sent: this ${auto.config.env === "preview" ? "Preview" : auto.config.env} deployment only emails addresses listed in AUTOMATION_TEST_RECIPIENTS, and ${to} isn't one of them. Production emails everyone.`;

async function send(auto: AutomationDeps, senderId: string | null, to: string, mail: { subject: string; html: string; text: string }, key: string): Promise<string | null> {
  if (!allowedTo(auto, to)) return heldBack(auto, to);
  let sender;
  try {
    sender = await senderFor(auto, senderId);
  } catch (e) {
    return sanitizeError(e, 200);
  }
  const result = await auto.email.send({ ...sender, to, subject: mail.subject, html: mail.html, text: mail.text, idempotencyKey: key });
  return result.ok ? null : sanitizeError(result.message, 200);
}

/**
 * Who a form's emails come from, and the name they carry: the form's own sending address if one is chosen; otherwise
 * its firm/brand's default (or first) verified address. With several brands, a brand that has no verified address
 * sends nothing, so one brand's form never emails from another brand. With one brand (or none), the tenant default.
 */
export async function formSender(auto: AutomationDeps, deps: FormDeps, settings: FormSettings): Promise<{ senderId: string | null; name: string | null; blocked: string | null }> {
  const brand = await brandFor(deps, settings);
  const catalog = deps.brandCatalog ? await deps.brandCatalog().catch(() => null) : null;
  const name = brand?.name ?? null;
  if (settings.notify.sender_id) return { senderId: settings.notify.sender_id, name, blocked: null };
  if (!brand || !catalog) return { senderId: null, name, blocked: null };
  const onBrand = Object.entries(catalog.senderDomain).filter(([, domain]) => domain === brand.id).map(([id]) => id);
  const all = auto.senders ? await auto.senders.listSenders().catch(() => []) : [];
  const preferred = onBrand.find((id) => all.find((x) => x.id === id)?.is_default) ?? onBrand[0];
  if (preferred) return { senderId: preferred, name, blocked: null };
  if (catalog.brands.length > 1) return { senderId: null, name, blocked: `${brand.name} has no verified sending address yet (Settings → Email sending), so this email was not sent.` };
  return { senderId: null, name, blocked: null };
}

/** The firm's notice. Sends once (the provider de-duplicates retries by key) and records the outcome. */
export async function notifyFirm(auto: AutomationDeps, deps: FormDeps, sub: Submission): Promise<void> {
  if (sub.notified_at || sub.is_test || sub.status === "spam" || sub.status === "draft") return;
  const form = await deps.repo.getForm(sub.form_id);
  if (!form) return;
  const settings = readSettings(form.settings);
  const profile = await deps.profile();
  const from = await formSender(auto, deps, settings);
  if (from.blocked) {
    await deps.repo.updateSubmission(sub.id, { notify_error: from.blocked.slice(0, 480) });
    return;
  }
  const recipients = settings.notify.recipients.length ? settings.notify.recipients : [profile?.email ?? auto.config.supportRecipient].filter(Boolean);
  const origin = (await auto.config.origin()).replace(/\/$/, "");
  const mail = firmSubmissionEmail({
    firmName: from.name ?? profile?.display_name ?? "Your tax office", formName: form.name, number: sub.number ?? 0,
    submittedAt: formatInZone(new Date(sub.submitted_at ?? sub.created_at), profile?.time_zone ?? "America/New_York"),
    respondent: [sub.respondent_name, sub.respondent_email].filter(Boolean).join(", ") || null,
    adminUrl: `${origin}/forms/${form.id}/submissions/${sub.id}`,
  });
  const problems: string[] = [];
  for (const to of recipients) {
    const p = await send(auto, from.senderId, to, mail, `form-notify:${sub.id}:${to}`);
    if (p) problems.push(p.startsWith("Not sent") ? p : `${to}: ${p}`);
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
  const notSent = async (reason: string) => {
    await deps.repo.addEvent({ form_id: sub.form_id, submission_id: sub.id, type: "confirmation_not_sent", actor_id: null, detail: { reason: reason.slice(0, 300) } });
    console.error(`forms: confirmation for ${sub.id} not sent: ${reason.slice(0, 200)}`);
  };
  const from = await formSender(auto, deps, settings);
  if (from.blocked) return notSent(from.blocked);
  const mail = respondentConfirmationEmail({
    firmName: from.name ?? profile?.display_name ?? "Your tax office", formName: form.name, number: sub.number ?? 0, name: sub.respondent_name,
    submittedAt: formatInZone(new Date(sub.submitted_at ?? sub.created_at), profile?.time_zone ?? "America/New_York"), message: settings.confirmation_email_text,
  });
  const problem = await send(auto, from.senderId, sub.respondent_email, mail, `form-confirm:${sub.id}`);
  if (!problem) {
    await deps.repo.updateSubmission(sub.id, { confirmation_sent_at: new Date().toISOString() });
    await deps.repo.addEvent({ form_id: sub.form_id, submission_id: sub.id, type: "confirmation_sent", actor_id: null, detail: {} });
  } else await notSent(problem);
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
export async function sendResumeLink(auto: AutomationDeps, deps: FormDeps, input: { pf: PublicForm; email: string; token: string; expiresAt: string; formUrl: string }): Promise<string | null> {
  const profile = await deps.profile();
  const from = await formSender(auto, deps, input.pf.settings);
  if (from.blocked) return from.blocked;
  const mail = resumeEmail({
    firmName: from.name ?? profile?.display_name ?? "Your tax office", formName: input.pf.form.name,
    url: `${input.formUrl}?resume=${input.token}`,
    expiresAt: new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: profile?.time_zone ?? "America/New_York" }).format(new Date(input.expiresAt)),
  });
  return send(auto, from.senderId, input.email, mail, `form-resume:${input.token.slice(0, 16)}:${new Date().toISOString().slice(0, 13)}`);
}

/** Scheduled retries: firm notices that failed, within two days of the submission. */
export async function retryNotifications(auto: AutomationDeps, deps: FormDeps, subs: Submission[]) {
  for (const s of subs) await notifyFirm(auto, deps, s).catch((e) => console.error(`forms: notify retry failed: ${sanitizeError(e, 120)}`));
}
