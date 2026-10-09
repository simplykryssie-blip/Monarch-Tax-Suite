import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ValidationError } from "../commerce/validation.ts";

// Signed webhook delivery to a buyer's own endpoint (their CRM's inbound
// webhook, Zapier/Make/n8n, or their own server).
//
// Request: POST <buyer URL>, Content-Type: application/json
//   Idempotency-Key: <submission id>          same value on a visitor's retry
//   X-Monarch-Timestamp: <unix seconds>
//   X-Monarch-Signature: v1=<hex HMAC-SHA256 of "<timestamp>.<raw body>" with the buyer's signing secret>
// Redirects are not followed; only HTTPS to public addresses is allowed.

export type WebhookTarget = { url: string; secret: string };
export type WebhookResult = { ok: true; status: number } | { ok: false; status: number | null; reason: string };
export type WebhookSender = (target: WebhookTarget, body: object, idempotencyKey: string) => Promise<WebhookResult>;

const BLOCKED_HOSTS = /(^localhost$|\.localhost$|\.local$|\.internal$|^metadata\.google\.internal$)/i;

/** Validates and normalizes a buyer-supplied webhook URL. */
export function parseWebhookUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ValidationError("Enter the full webhook URL, starting with https://");
  }
  if (url.protocol !== "https:") throw new ValidationError("The webhook URL must use https://");
  if (url.username || url.password) throw new ValidationError("The webhook URL must not contain a username or password.");
  if (url.port && url.port !== "443") throw new ValidationError("The webhook URL must use the standard HTTPS port.");
  if (isIP(url.hostname.replace(/^\[|\]$/g, "")) || BLOCKED_HOSTS.test(url.hostname) || !url.hostname.includes(".")) {
    throw new ValidationError("Use a public webhook hostname (not an IP address or internal name).");
  }
  if (url.toString().length > 2000) throw new ValidationError("The webhook URL is too long.");
  url.hash = "";
  return url;
}

/** True for loopback, private, link-local, CGNAT, multicast and other non-public addresses. */
export function isPrivateAddress(address: string): boolean {
  const v4 = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v6 = address.toLowerCase();
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb") || v6.startsWith("ff");
}

export function signWebhook(secret: string, timestamp: number, rawBody: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

/** Default sender: resolves the host, refuses non-public addresses, posts once with a 10 s timeout. */
export const sendWebhook: WebhookSender = async (target, body, idempotencyKey) => {
  const url = parseWebhookUrl(target.url);
  try {
    const addresses = await lookup(url.hostname, { all: true });
    if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) return { ok: false, status: null, reason: "destination_not_public" };
  } catch {
    return { ok: false, status: null, reason: "dns_failed" };
  }
  const raw = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  try {
    const res = await fetch(url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "MonarchTaxSuite-Webhook/1",
        "Idempotency-Key": idempotencyKey,
        "X-Monarch-Timestamp": String(timestamp),
        "X-Monarch-Signature": signWebhook(target.secret, timestamp, raw),
      },
      body: raw,
    });
    await res.body?.cancel().catch(() => undefined);
    return res.status >= 200 && res.status < 300 ? { ok: true, status: res.status } : { ok: false, status: res.status, reason: res.status >= 300 && res.status < 400 ? "redirect_not_followed" : "http_error" };
  } catch (e) {
    return { ok: false, status: null, reason: e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network_error" };
  }
};
