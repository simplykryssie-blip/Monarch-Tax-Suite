import type { CrmSecrets } from "../crm/crypto.ts";
import { MONARCH_TENANT_ID } from "../tenants.ts";
import { platformLogin, platformSendProblems, type PlatformTwilio, type TwilioRoute } from "../automation/twilio.ts";
import type { SmsAccount } from "./types.ts";

/** Where this tenant's texts go out from, or why they can't yet. */
export type SmsRoute =
  | { ok: true; route: TwilioRoute; billing: "direct" | "credits" }
  | { ok: false; problem: string; billing: "direct" | "credits" };

export const secretAad = (tenantId: string) => `sms-api-key:${tenantId}`;

/**
 * Tenant #1 sends from the owner's account (Vercel settings) and pays Twilio directly. Every other tenant sends only
 * from its own subaccount, with its own API key, once its number is bought and its registration approved; it never
 * falls back to the owner's account or number.
 */
export function resolveSmsRoute(tenantId: string, account: SmsAccount | null, platform: PlatformTwilio, secrets: CrmSecrets | null): SmsRoute {
  if (tenantId === MONARCH_TENANT_ID && !account) {
    const problems = platformSendProblems(platform);
    const login = platformLogin(platform);
    if (problems.length || !login) return { ok: false, billing: "direct", problem: `Text messaging is not connected. ${problems[0] ?? ""}`.trim() };
    return { ok: true, billing: "direct", route: { accountSid: platform.accountSid!, ...login, from: platform.from, messagingServiceSid: platform.messagingServiceSid } };
  }
  const billing = tenantId === MONARCH_TENANT_ID ? "direct" : "credits";
  if (!account || !account.subaccount_sid) return { ok: false, billing, problem: "Text messaging isn't set up for this office yet. Set it up in Settings → Text messaging." };
  if (account.status === "suspended") return { ok: false, billing, problem: "Text messaging is suspended for this office. Contact support." };
  if (account.status === "paused") return { ok: false, billing, problem: "Texting is paused: this month's number renewal couldn't be taken from your credits. Buy credits in Settings → Text messaging to resume." };
  if (account.status === "released") return { ok: false, billing, problem: "This office's texting number was released after renewals failed. Set up a number again in Settings → Text messaging." };
  if (!account.api_key_sid || !account.api_key_secret_encrypted) return { ok: false, billing, problem: "Text messaging setup didn't finish. Open Settings → Text messaging to finish it." };
  if (!account.from_number && !account.messaging_service_sid) return { ok: false, billing, problem: "This office has no texting number yet. Choose one in Settings → Text messaging." };
  if (account.registration_status !== "approved") return { ok: false, billing, problem: "Carriers haven't approved this office's texting registration yet. Texts can be sent once it's approved; see Settings → Text messaging." };
  if (account.status !== "active") return { ok: false, billing, problem: "Text messaging setup didn't finish. Open Settings → Text messaging to finish it." };
  if (!secrets) return { ok: false, billing, problem: "Text messaging can't be used: MONARCH_ENCRYPTION_KEY is not configured." };
  let password: string;
  try {
    password = secrets.decrypt(account.api_key_secret_encrypted, secretAad(tenantId));
  } catch {
    return { ok: false, billing, problem: "This office's texting key can't be read. Set up its key again in Settings → Text messaging." };
  }
  return { ok: true, billing, route: { accountSid: account.subaccount_sid, username: account.api_key_sid, password, from: account.from_number, messagingServiceSid: account.messaging_service_sid } };
}
