import "server-only";
import { automationConfig } from "./automation/server";
import { emailConfig, ResendEmailSender } from "./automation/email.ts";
import { sendSystemMail, type SystemMail } from "./platform-mail.ts";

/** Sends an email as the platform (support@verexahq.com). Returns null when sent, or why not. */
export function sendPlatformEmail(to: string, mail: SystemMail): Promise<string | null> {
  const config = automationConfig();
  const sender = new ResendEmailSender(emailConfig(process.env));
  return sendSystemMail(
    { env: config.env, testRecipients: config.testRecipients, send: (m) => sender.send(m), from: process.env.PLATFORM_MAIL_FROM?.trim() || null },
    to,
    mail,
  );
}
