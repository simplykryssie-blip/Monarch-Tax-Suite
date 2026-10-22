import { createHash } from "node:crypto";
import { sanitizeError } from "./automation/sanitize.ts";
import { isFromHeader, type EmailMessage, type SendResult } from "./automation/email.ts";
import { renderEmailHtml, type EmailAction } from "./office/email-html.ts";
import { PLATFORM, PLATFORM_SUPPORT_EMAIL } from "./platform-brand.ts";

// Email the platform itself sends: welcome, payment failed, late-payment reminders, cancellation, and the invite to a new
// PTIN workspace. It goes out from the platform's own address (support@verexahq.com) through the platform's Resend
// account. It does not borrow any workspace's sending setup, Monarch's included.

export const PLATFORM_MAIL_FROM = `${PLATFORM.name} <${PLATFORM_SUPPORT_EMAIL}>`;

export type SystemMail = { subject: string; text: string; action?: EmailAction };
export type SystemMailDeps = {
  env: "production" | "preview" | "development";
  testRecipients: string[];
  send: (message: EmailMessage) => Promise<SendResult>;
  /** Optional override of the "from" header (PLATFORM_MAIL_FROM in the environment); ignored if it isn't a valid header. */
  from?: string | null;
};

/** Why an email was held back outside production, in words an administrator can act on. */
const heldBack = (env: SystemMailDeps["env"], to: string) =>
  `Not sent: this ${env === "preview" ? "Preview" : env} deployment only emails addresses listed in AUTOMATION_TEST_RECIPIENTS, and ${to} isn't one of them. Production emails everyone.`;

/** Sends one platform email. Returns null when sent, or why not (never throws, never includes a key). */
export async function sendSystemMail(deps: SystemMailDeps, to: string, mail: SystemMail): Promise<string | null> {
  if (deps.env !== "production" && !deps.testRecipients.map((r) => r.toLowerCase()).includes(to.toLowerCase())) return heldBack(deps.env, to);
  const from = deps.from && isFromHeader(deps.from) ? deps.from : PLATFORM_MAIL_FROM;
  const html = renderEmailHtml(mail.text, mail.action);
  const key = `platform-mail:${createHash("sha256").update(`${to}\n${mail.subject}\n${mail.text}`).digest("hex").slice(0, 32)}`;
  const result = await deps.send({ to, subject: mail.subject, text: mail.text, html, from, replyTo: PLATFORM_SUPPORT_EMAIL, idempotencyKey: key });
  return result.ok ? null : sanitizeError(result.message, 200);
}
