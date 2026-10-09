// Optional "new lead" notification email to the license holder's own address.
// Off unless the server has an email provider configured. Plain text only; the
// visitor's text is stripped of control characters before it reaches a header.

export type MailMessage = { to: string; replyTo?: string | null; subject: string; text: string };
export type MailResult = { ok: true } | { ok: false; reason: string };
export type Mailer = (message: MailMessage) => Promise<MailResult>;

export const EMAIL_PATTERN = /^[^\s@<>",;:]+@[^\s@<>",;:]+\.[a-z]{2,}$/i;
const FROM_PATTERN = /^(?:[^<>\r\n"]{1,80} )?<?[^\s@<>",;:]+@[^\s@<>",;:]+\.[a-z]{2,}>?$/i;

/** Resend (https://resend.com) over HTTPS. The API key and sender stay on the server. */
export function resendMailer(apiKey: string, from: string): Mailer {
  return async (m) => {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        redirect: "error",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [m.to], reply_to: m.replyTo ?? undefined, subject: m.subject, text: m.text }),
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok ? { ok: true } : { ok: false, reason: `http_${res.status}` };
    } catch (e) {
      return { ok: false, reason: e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network" };
    }
  };
}

/** Mailer from server environment, or null when email notifications are not configured. */
export function mailerFromEnv(env: Record<string, string | undefined>): Mailer | null {
  const key = env.RESEND_API_KEY;
  const from = env.LEAD_NOTIFY_FROM;
  if (!key || !from || !FROM_PATTERN.test(from)) return null;
  return resendMailer(key, from);
}
