import { randomUUID } from "node:crypto";
import type { EmailSender } from "../automation/email.ts";
import { isEmailAddress } from "../automation/email.ts";
import type { ResolvedSender } from "../automation/senders.ts";
import type { SmsSender } from "../automation/twilio.ts";
import { segmentCount, toE164 } from "../automation/twilio.ts";
import { SMS_MAX } from "../automation/sms.ts";
import { ValidationError } from "../commerce/validation.ts";
import type { ClientMessage, WorkspaceRepo } from "./types.ts";

// Sending an email or a text to a client from their profile. Every attempt that reaches the provider is written to the
// client's message history, sent or failed. Outside production, only addresses and numbers on the test allow-list
// (AUTOMATION_TEST_RECIPIENTS) are ever contacted, so previews can never reach a real client.
//
// Texts go out from the office's own Twilio account (lib/sms/route.ts). An office on prepaid credits spends one
// credit per message segment before the text is sent, and gets them back if the text is refused.

/** An office's prepaid text credits. Null for an office that pays Twilio directly (tenant #1). */
export type SmsCredits = {
  spend(segments: number, reference: string): Promise<boolean>;
  refund(segments: number, reference: string): Promise<void>;
  balance(): Promise<number>;
};

export type SendDeps = {
  repo: WorkspaceRepo;
  email: EmailSender;
  /** The office's own texting account, or why it can't text yet. */
  sms: { sender: SmsSender | null; problem: string | null; credits: SmsCredits | null };
  /** The account's sending address (its default verified sender). Throws a ValidationError when there is none. */
  sender: () => Promise<ResolvedSender>;
  env: "production" | "preview" | "development";
  testRecipients: string[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const line = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim() : "").slice(0, max + 1);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain text as a simple, safe HTML email: escaped, paragraphs and line breaks kept. */
export function plainEmailHtml(body: string): string {
  const paras = body.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111">${paras}</div>`;
}

function allowed(deps: SendDeps, to: string) {
  if (deps.env === "production") return true;
  const list = deps.testRecipients.map((r) => r.toLowerCase());
  return list.includes(to.toLowerCase()) || list.map((r) => toE164(r)).includes(to);
}

export async function sendClientMessage(deps: SendDeps, clientId: string, raw: Record<string, unknown>, actorId: string, now = new Date()): Promise<ClientMessage> {
  const id = UUID.test(clientId) ? clientId : "";
  const client = id ? await deps.repo.getClient(id) : null;
  if (!client) throw new ValidationError("That client wasn't found.");
  if (client.archived_at) throw new ValidationError("This client is archived. Restore them to send messages.");
  const channel = raw.channel === "sms" ? "sms" : raw.channel === "email" ? "email" : null;
  if (!channel) throw new ValidationError("Choose email or text.");

  let to: string;
  let subject: string | null = null;
  let body: string;
  if (channel === "email") {
    to = client.email ?? "";
    if (!to || !isEmailAddress(to)) throw new ValidationError("This client has no valid email address. Add one on the Overview tab.");
    subject = line(raw.subject, 200);
    if (!subject) throw new ValidationError("Write a subject.");
    body = text(raw.body, 4000);
    if (!body) throw new ValidationError("Write the message.");
    if (body.length > 4000) throw new ValidationError("An email from here can be up to 4,000 characters.");
  } else {
    to = toE164(client.phone) ?? "";
    if (!to) throw new ValidationError("This client has no valid mobile number. Add one on the Overview tab (for example 555-123-4567).");
    body = text(raw.body, SMS_MAX);
    if (!body) throw new ValidationError("Write the message.");
    if (body.length > SMS_MAX) throw new ValidationError(`A text can be up to ${SMS_MAX} characters.`);
  }
  if (!allowed(deps, to)) throw new ValidationError(`Not sent: this is a ${deps.env} copy of the app, which only contacts addresses on the test list (AUTOMATION_TEST_RECIPIENTS).`);

  let result;
  let segments: number | null = null;
  const reference = `client-message:${randomUUID()}`;
  if (channel === "email") {
    const from = await deps.sender();
    result = await deps.email.send({ to, subject: subject!, html: plainEmailHtml(body), text: body, idempotencyKey: reference, from: from.from, replyTo: from.replyTo });
  } else {
    const sender = deps.sms.sender;
    if (!sender) throw new ValidationError(deps.sms.problem ?? "Text messaging is not connected for this office.");
    segments = segmentCount(body);
    const credits = deps.sms.credits;
    if (credits && !(await credits.spend(segments, reference))) {
      const have = await credits.balance();
      throw new ValidationError(`Not enough text credits: this text needs ${segments} and this office has ${have}. Buy credits in Settings → Text messaging.`);
    }
    result = await sender.send(to, body);
    if (!result.ok && credits) await credits.refund(segments, reference);
  }
  // Nothing reached the provider (it isn't set up): say so without adding a failed message to the history.
  if (!result.ok && result.kind === "config") throw new ValidationError(result.message);
  const saved = await deps.repo.insertMessage({
    client_id: client.id, direction: "out", channel, subject, body, occurred_at: now.toISOString(), created_by: actorId,
    status: result.ok ? "sent" : "failed", sent_to: to, segments, provider_id: result.ok ? result.id : null, error: result.ok ? null : result.message.slice(0, 300),
  });
  if (!result.ok) throw new ValidationError(`Not sent. ${result.message}`);
  return saved;
}
