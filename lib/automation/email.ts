import { sanitizeError } from "./sanitize.ts";

// The one place Monarch sends email. Provider: Resend (https://resend.com/docs/api-reference/emails/send-email).
// The API key stays on the server and never appears in a response, log or error message.

export type EmailMessage = { to: string; subject: string; html: string; text: string; idempotencyKey: string };
export type SendResult = { ok: true; id: string } | { ok: false; kind: "config" | "transient" | "permanent"; message: string };
export interface EmailSender {
  send(message: EmailMessage): Promise<SendResult>;
}

export type EmailConfig = { apiKey: string | null; keySource: "RESEND_API_KEY" | "RESEND_SECRET_KEY" | null; from: string | null; replyTo: string | null };

type Env = Record<string, string | undefined>;

/** RESEND_API_KEY is the documented variable; RESEND_SECRET_KEY (already present in Production) is accepted as a fallback. */
export function emailConfig(env: Env): EmailConfig {
  const primary = env.RESEND_API_KEY?.trim();
  const fallback = env.RESEND_SECRET_KEY?.trim();
  return {
    apiKey: primary || fallback || null,
    keySource: primary ? "RESEND_API_KEY" : fallback ? "RESEND_SECRET_KEY" : null,
    from: env.MONARCH_EMAIL_FROM?.trim() || null,
    replyTo: env.MONARCH_EMAIL_REPLY_TO?.trim() || null,
  };
}

const ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const FROM = /^(?:[^<>\r\n]{1,80}\s)?<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>$|^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export const isEmailAddress = (v: string) => v.length <= 254 && ADDRESS.test(v);

/** What is missing before email can be sent. Empty means ready to try. */
export function emailConfigProblems(c: EmailConfig): string[] {
  const problems: string[] = [];
  if (!c.apiKey) problems.push("Set RESEND_API_KEY in Vercel (server-side).");
  if (!c.from) problems.push("Set MONARCH_EMAIL_FROM to an address on a domain verified in Resend, for example Monarch Tax Suite <notifications@yourdomain.com>.");
  else if (!FROM.test(c.from)) problems.push("MONARCH_EMAIL_FROM is not a valid sender address.");
  if (c.replyTo && !isEmailAddress(c.replyTo)) problems.push("MONARCH_EMAIL_REPLY_TO is not a valid email address.");
  return problems;
}

export const senderDomain = (from: string | null) => from?.match(/@([A-Za-z0-9.-]+)>?$/)?.[1]?.toLowerCase() ?? null;

export class ResendEmailSender implements EmailSender {
  private config: EmailConfig;
  private fetchImpl: typeof fetch;
  constructor(config: EmailConfig, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async send(m: EmailMessage): Promise<SendResult> {
    const problems = emailConfigProblems(this.config);
    if (problems.length) return { ok: false, kind: "config", message: `Email is not configured. ${problems[0]}` };
    if (!isEmailAddress(m.to)) return { ok: false, kind: "permanent", message: "The recipient email address is not valid." };
    let res: Response;
    try {
      res = await this.fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": m.idempotencyKey.slice(0, 256) },
        body: JSON.stringify({ from: this.config.from, to: [m.to], subject: m.subject, html: m.html, text: m.text, ...(this.config.replyTo ? { reply_to: this.config.replyTo } : {}) }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      return { ok: false, kind: "transient", message: `Could not reach the email provider: ${sanitizeError(e, 160)}` };
    }
    const raw = await res.text().catch(() => "");
    let body: { id?: string; message?: string; name?: string } = {};
    try {
      body = raw ? (JSON.parse(raw) as typeof body) : {};
    } catch {
      body = {};
    }
    if (res.ok && typeof body.id === "string") return { ok: true, id: body.id };
    const detail = sanitizeError(body.message ?? `HTTP ${res.status}`, 240);
    if (res.status === 401 || res.status === 403) {
      return { ok: false, kind: "config", message: `The email provider refused the request (${res.status}). Check the API key and that the sending domain is verified in Resend. ${detail}` };
    }
    if (res.status === 429 || res.status >= 500) return { ok: false, kind: "transient", message: `The email provider is busy or unavailable (${res.status}). ${detail}` };
    return { ok: false, kind: "permanent", message: `The email provider rejected the message (${res.status}). ${detail}` };
  }
}

export type DomainStatus = "verified" | "not_verified" | "not_found" | "unknown";

/** Looks the sender's domain up in Resend. "unknown" when the key cannot list domains (restricted keys) or the call fails. */
export async function checkSenderDomain(config: EmailConfig, fetchImpl: typeof fetch = fetch): Promise<{ domain: string | null; status: DomainStatus }> {
  const domain = senderDomain(config.from);
  if (!config.apiKey || !domain) return { domain, status: "unknown" };
  try {
    const res = await fetchImpl("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${config.apiKey}` }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { domain, status: "unknown" };
    const body = (await res.json()) as { data?: { name?: string; status?: string }[] };
    const found = body.data?.find((d) => d.name?.toLowerCase() === domain);
    if (!found) return { domain, status: "not_found" };
    return { domain, status: found.status === "verified" ? "verified" : "not_verified" };
  } catch {
    return { domain, status: "unknown" };
  }
}
