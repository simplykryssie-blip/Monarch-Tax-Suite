import { createHmac, timingSafeEqual } from "node:crypto";

// What Resend and Twilio tell us about a campaign message. Resend signs its webhooks the Svix way: an id, a timestamp and
// one or more "v1,<signature>" values over `${id}.${timestamp}.${body}`, keyed by the base64 part of the secret.

export const TOLERANCE_SECONDS = 5 * 60;

export function verifySvix(input: { secret: string; id: string | null; timestamp: string | null; signature: string | null; body: string; nowMs?: number }): boolean {
  const { secret, id, timestamp, signature, body } = input;
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs((input.nowMs ?? Date.now()) / 1000 - ts) > TOLERANCE_SECONDS) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export type MailEvent = { kind: "delivered" | "hard_bounce" | "complaint"; emailId: string };

/** The part of a Resend event we act on, or null for anything else (soft bounces, opens, clicks counted by our own links). */
export function interpretResendEvent(raw: unknown): MailEvent | null {
  const e = (raw && typeof raw === "object" ? raw : {}) as { type?: unknown; data?: { email_id?: unknown; bounce?: { type?: unknown } } };
  const emailId = typeof e.data?.email_id === "string" ? e.data.email_id : null;
  if (!emailId) return null;
  if (e.type === "email.delivered") return { kind: "delivered", emailId };
  if (e.type === "email.complained") return { kind: "complaint", emailId };
  if (e.type === "email.bounced") return String(e.data?.bounce?.type ?? "").toLowerCase() === "permanent" ? { kind: "hard_bounce", emailId } : null;
  return null;
}
