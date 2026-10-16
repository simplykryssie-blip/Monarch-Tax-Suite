import { sanitizeError } from "./sanitize.ts";
import type { SendResult } from "./email.ts";

// Text messages, sent through Twilio (https://www.twilio.com/docs/messaging/api/message-resource#create-a-message-resource).
// The credentials are server-side environment variables; they never appear in a response, log or error message.

export type SmsConfig = { accountSid: string | null; authToken: string | null; from: string | null; messagingServiceSid: string | null };
export interface SmsSender {
  send(to: string, body: string): Promise<SendResult>;
}

type Env = Record<string, string | undefined>;

export function smsConfig(env: Env): SmsConfig {
  return {
    accountSid: env.TWILIO_ACCOUNT_SID?.trim() || null,
    authToken: env.TWILIO_AUTH_TOKEN?.trim() || null,
    from: env.TWILIO_FROM_NUMBER?.trim() || null,
    messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID?.trim() || null,
  };
}

/** What is missing before texts can be sent. Empty means ready to try. Names variables, never their values. */
export function smsConfigProblems(c: SmsConfig): string[] {
  const problems: string[] = [];
  if (!c.accountSid) problems.push("Set TWILIO_ACCOUNT_SID in Vercel (server-side).");
  else if (!/^AC[0-9a-f]{32}$/i.test(c.accountSid)) problems.push("TWILIO_ACCOUNT_SID doesn't look like a Twilio Account SID (it starts with AC).");
  if (!c.authToken) problems.push("Set TWILIO_AUTH_TOKEN in Vercel (server-side).");
  if (!c.from && !c.messagingServiceSid) problems.push("Set TWILIO_FROM_NUMBER (your Twilio number, like +15551234567) or TWILIO_MESSAGING_SERVICE_SID.");
  else if (c.from && !isE164(c.from)) problems.push("TWILIO_FROM_NUMBER must be in +15551234567 form.");
  return problems;
}

export const isE164 = (v: string) => /^\+[1-9]\d{7,14}$/.test(v);

/** A phone number as typed by staff, in +15551234567 form. US numbers may be written without +1. Null when unusable. */
export function toE164(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const digits = v.replace(/[^\d]/g, "");
  if (v.startsWith("+")) return isE164(`+${digits}`) ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export class TwilioSmsSender implements SmsSender {
  private config: SmsConfig;
  private fetchImpl: typeof fetch;
  constructor(config: SmsConfig, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async send(to: string, body: string): Promise<SendResult> {
    const problems = smsConfigProblems(this.config);
    if (problems.length) return { ok: false, kind: "config", message: `Text messaging is not connected. ${problems[0]}` };
    if (!isE164(to)) return { ok: false, kind: "permanent", message: "The phone number is not valid." };
    const { accountSid, authToken, from, messagingServiceSid } = this.config;
    const form = new URLSearchParams({ To: to, Body: body });
    if (messagingServiceSid) form.set("MessagingServiceSid", messagingServiceSid);
    else form.set("From", from!);
    let res: Response;
    try {
      res = await this.fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: "POST",
        headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      return { ok: false, kind: "transient", message: `Could not reach the text provider: ${sanitizeError(e, 160)}` };
    }
    let data: { sid?: string; message?: string; code?: number } = {};
    try {
      data = (await res.json()) as typeof data;
    } catch {
      data = {};
    }
    if (res.ok && typeof data.sid === "string") return { ok: true, id: data.sid };
    const detail = sanitizeError(data.message ?? `HTTP ${res.status}`, 240);
    if (res.status === 401 || res.status === 403) return { ok: false, kind: "config", message: `The text provider refused the request (${res.status}). Check the Twilio credentials. ${detail}` };
    if (res.status === 429 || res.status >= 500) return { ok: false, kind: "transient", message: `The text provider is busy or unavailable (${res.status}). ${detail}` };
    return { ok: false, kind: "permanent", message: `The text provider rejected the message (${res.status}). ${detail}` };
  }
}
