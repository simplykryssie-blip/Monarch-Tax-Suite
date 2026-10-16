import { sanitizeError } from "./sanitize.ts";
import type { SendResult } from "./email.ts";

// Text messages, sent through Twilio (https://www.twilio.com/docs/messaging/api/message-resource#create-a-message-resource).
// Every tenant sends from its own Twilio account (lib/sms/route.ts decides which): tenant #1 from the owner's account in
// the Vercel settings, every other tenant from its own subaccount. Credentials are server-side only; they never appear
// in a response, log or error message.

/** One Twilio account to send from: the account, how to sign in to it, and the sender. */
export type TwilioRoute = {
  accountSid: string;
  /** An API key SID (SK…) with its secret, or the account SID with its auth token. */
  username: string;
  password: string;
  from: string | null;
  messagingServiceSid: string | null;
};

export interface SmsSender {
  send(to: string, body: string): Promise<SendResult>;
}

type Env = Record<string, string | undefined>;

/** The owner's own Twilio account, from the Vercel settings. It is tenant #1's account and the parent of every subaccount. */
export type PlatformTwilio = {
  accountSid: string | null;
  authToken: string | null;
  apiKeySid: string | null;
  apiKeySecret: string | null;
  from: string | null;
  messagingServiceSid: string | null;
};

export function platformTwilio(env: Env): PlatformTwilio {
  const v = (k: string) => env[k]?.trim() || null;
  return {
    accountSid: v("TWILIO_ACCOUNT_SID"),
    authToken: v("TWILIO_AUTH_TOKEN"),
    apiKeySid: v("TWILIO_API_KEY") ?? v("TWILIO_API_KEY_SID"),
    apiKeySecret: v("TWILIO_API_SECRET") ?? v("TWILIO_API_KEY_SECRET"),
    from: v("TWILIO_FROM_NUMBER"),
    messagingServiceSid: v("TWILIO_MESSAGING_SERVICE_SID"),
  };
}

export const isAccountSid = (v: string | null) => !!v && /^AC[0-9a-f]{32}$/i.test(v);
const isKeySid = (v: string | null) => !!v && /^SK[0-9a-f]{32}$/i.test(v);

/** How to sign in to the owner's account: its API key when the key and secret are both set, else the auth token. */
export function platformLogin(p: PlatformTwilio): { username: string; password: string } | null {
  if (!isAccountSid(p.accountSid)) return null;
  if (isKeySid(p.apiKeySid) && p.apiKeySecret) return { username: p.apiKeySid!, password: p.apiKeySecret };
  if (p.authToken) return { username: p.accountSid!, password: p.authToken };
  return null;
}

/** What is missing before the owner's account can sign in to Twilio. Names variables, never their values. */
export function platformProblems(p: PlatformTwilio): string[] {
  const problems: string[] = [];
  if (!p.accountSid) problems.push("Set TWILIO_ACCOUNT_SID in Vercel (server-side).");
  else if (!isAccountSid(p.accountSid)) problems.push("TWILIO_ACCOUNT_SID doesn't look like a Twilio Account SID (it starts with AC).");
  if (p.apiKeySid && !p.apiKeySecret && !p.authToken) problems.push("TWILIO_API_KEY is set without its secret: set TWILIO_API_SECRET (or TWILIO_AUTH_TOKEN).");
  else if (!p.authToken && !(p.apiKeySid && p.apiKeySecret)) problems.push("Set TWILIO_AUTH_TOKEN (or TWILIO_API_KEY and TWILIO_API_SECRET) in Vercel (server-side).");
  else if (p.apiKeySid && !isKeySid(p.apiKeySid)) problems.push("TWILIO_API_KEY doesn't look like a Twilio API key SID (it starts with SK).");
  return problems;
}

/** What is missing before tenant #1 can send texts from the owner's account. */
export function platformSendProblems(p: PlatformTwilio): string[] {
  const problems = platformProblems(p);
  if (!p.from && !p.messagingServiceSid) problems.push("Set TWILIO_FROM_NUMBER (your Twilio number, like +15551234567) or TWILIO_MESSAGING_SERVICE_SID.");
  else if (p.from && !isE164(p.from)) problems.push("TWILIO_FROM_NUMBER must be in +15551234567 form.");
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

/** Characters a carrier can send in the 7-bit GSM alphabet; anything else makes the whole text UCS-2. */
const GSM = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/;

/** How many message segments a text uses: what a carrier bills, and what it costs in credits. */
export function segmentCount(body: string): number {
  if (!body) return 0;
  const gsm = GSM.test(body);
  const units = gsm ? [...body].reduce((n, c) => n + ("^{}\\[~]|€".includes(c) ? 2 : 1), 0) : [...body].length;
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  return units <= single ? 1 : Math.ceil(units / multi);
}

const basic = (username: string, password: string) => `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

export class TwilioSmsSender implements SmsSender {
  private route: TwilioRoute;
  private fetchImpl: typeof fetch;
  constructor(route: TwilioRoute, fetchImpl: typeof fetch = fetch) {
    this.route = route;
    this.fetchImpl = fetchImpl;
  }

  async send(to: string, body: string): Promise<SendResult> {
    if (!isE164(to)) return { ok: false, kind: "permanent", message: "The phone number is not valid." };
    const { accountSid, username, password, from, messagingServiceSid } = this.route;
    if (!from && !messagingServiceSid) return { ok: false, kind: "config", message: "Text messaging has no sending number yet." };
    const form = new URLSearchParams({ To: to, Body: body });
    if (messagingServiceSid) form.set("MessagingServiceSid", messagingServiceSid);
    else form.set("From", from!);
    let res: Response;
    try {
      res = await this.fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: "POST",
        headers: { Authorization: basic(username, password), "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      return { ok: false, kind: "transient", message: `Could not reach the text provider: ${sanitizeError(e, 160)}` };
    }
    const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (res.ok && typeof data.sid === "string") return { ok: true, id: data.sid };
    const detail = sanitizeError(data.message ?? `HTTP ${res.status}`, 240);
    if (res.status === 401 || res.status === 403) return { ok: false, kind: "config", message: `The text provider refused the request (${res.status}). Check the Twilio credentials. ${detail}` };
    if (res.status === 429 || res.status >= 500) return { ok: false, kind: "transient", message: `The text provider is busy or unavailable (${res.status}). ${detail}` };
    return { ok: false, kind: "permanent", message: `The text provider rejected the message (${res.status}). ${detail}` };
  }
}

// ---------------------------------------------------------------- the owner's account managing subaccounts

export type AvailableNumber = { phoneNumber: string; friendlyName: string; locality: string | null; region: string | null };

/**
 * Twilio calls the owner's account makes for tenants: create a tenant's subaccount and its API key, find and buy a
 * number in it, suspend it. Uses the owner's login (an auth token or a Main API key: a standard key can't manage
 * subaccounts). A parent account may act on its subaccounts' resources.
 */
export class TwilioAccounts {
  private login: { username: string; password: string };
  private fetchImpl: typeof fetch;
  constructor(login: { username: string; password: string }, fetchImpl: typeof fetch = fetch) {
    this.login = login;
    this.fetchImpl = fetchImpl;
  }

  private async call<T>(method: "GET" | "POST", path: string, form?: Record<string, string>): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`https://api.twilio.com/2010-04-01${path}`, {
        method,
        headers: { Authorization: basic(this.login.username, this.login.password), ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
        body: form ? new URLSearchParams(form).toString() : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new Error(`Could not reach Twilio: ${sanitizeError(e, 160)}`);
    }
    const data = (await res.json().catch(() => ({}))) as T & { message?: string };
    if (!res.ok) throw new Error(`Twilio refused the request (${res.status}): ${sanitizeError(data.message ?? "", 200)}`);
    return data;
  }

  async createSubaccount(friendlyName: string): Promise<{ sid: string }> {
    const r = await this.call<{ sid: string }>("POST", "/Accounts.json", { FriendlyName: friendlyName.slice(0, 64) });
    return { sid: r.sid };
  }
  /** A standard API key inside the subaccount: the tenant sends with it, never with the owner's credentials. */
  async createApiKey(subaccountSid: string, friendlyName: string): Promise<{ sid: string; secret: string }> {
    const r = await this.call<{ sid: string; secret: string }>("POST", `/Accounts/${subaccountSid}/Keys.json`, { FriendlyName: friendlyName.slice(0, 64) });
    return { sid: r.sid, secret: r.secret };
  }
  async searchNumbers(subaccountSid: string, areaCode: string): Promise<AvailableNumber[]> {
    const q = new URLSearchParams({ AreaCode: areaCode, SmsEnabled: "true", PageSize: "10" });
    const r = await this.call<{ available_phone_numbers?: { phone_number: string; friendly_name: string; locality?: string | null; region?: string | null }[] }>("GET", `/Accounts/${subaccountSid}/AvailablePhoneNumbers/US/Local.json?${q}`);
    return (r.available_phone_numbers ?? []).map((n) => ({ phoneNumber: n.phone_number, friendlyName: n.friendly_name, locality: n.locality ?? null, region: n.region ?? null }));
  }
  async buyNumber(subaccountSid: string, phoneNumber: string): Promise<{ sid: string; phoneNumber: string }> {
    const r = await this.call<{ sid: string; phone_number: string }>("POST", `/Accounts/${subaccountSid}/IncomingPhoneNumbers.json`, { PhoneNumber: phoneNumber });
    return { sid: r.sid, phoneNumber: r.phone_number };
  }
  async setStatus(subaccountSid: string, status: "active" | "suspended"): Promise<void> {
    await this.call("POST", `/Accounts/${subaccountSid}.json`, { Status: status });
  }
}
