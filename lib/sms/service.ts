import { ValidationError } from "../commerce/validation.ts";
import type { CrmSecrets } from "../crm/crypto.ts";
import { MONARCH_TENANT_ID } from "../tenants.ts";
import { isE164, type AvailableNumber, type TwilioAccounts } from "../automation/twilio.ts";
import { secretAad } from "./route.ts";
import type { SmsAccount, SmsAccountsRepo } from "./types.ts";

// Setting up a tenant's own texting account: a Twilio subaccount under the owner's account, an API key inside it (the
// tenant sends with that, never with the owner's credentials), then a number bought into it. Each step can be repeated:
// a setup that stopped half-way carries on from where it stopped.

export type SetupDeps = { tenantId: string; repo: SmsAccountsRepo; twilio: TwilioAccounts | null; secrets: CrmSecrets | null };

/** Credits a tenant must hold before buying a number, so the platform never carries a number nobody has paid for. */
export const MIN_CREDITS_FOR_NUMBER = 1;

function ready(d: SetupDeps): { twilio: TwilioAccounts; secrets: CrmSecrets } {
  if (d.tenantId === MONARCH_TENANT_ID) throw new ValidationError("This office texts from the owner's own Twilio account, set in Vercel.");
  if (!d.twilio) throw new ValidationError("Text messaging can't be set up yet: the platform's Twilio account isn't connected.");
  if (!d.secrets) throw new ValidationError("Text messaging can't be set up yet: MONARCH_ENCRYPTION_KEY is not configured.");
  return { twilio: d.twilio, secrets: d.secrets };
}

export async function setupSmsAccount(d: SetupDeps, officeName: string, actorId: string): Promise<SmsAccount> {
  const { twilio, secrets } = ready(d);
  let account = await d.repo.get();
  if (account?.status === "suspended") throw new ValidationError("Text messaging is paused for this office. Contact support.");
  const label = `Monarch tenant ${d.tenantId.slice(0, 8)} ${officeName}`.replace(/[^\w .&'-]/g, "").slice(0, 64);
  if (!account?.subaccount_sid) {
    const sub = await twilio.createSubaccount(label);
    // Recorded straight away, so a later failure resumes with this subaccount rather than making a second one.
    account = account ? await d.repo.update(account.id, { subaccount_sid: sub.sid }) : await d.repo.insert({ subaccount_sid: sub.sid, status: "setting_up", registration_status: "not_started", created_by: actorId });
  }
  if (!account.api_key_sid || !account.api_key_secret_encrypted) {
    const key = await twilio.createApiKey(account.subaccount_sid!, `${label} sending`);
    account = await d.repo.update(account.id, { api_key_sid: key.sid, api_key_secret_encrypted: secrets.encrypt(key.secret, secretAad(d.tenantId)) });
  }
  return account;
}

export async function findNumbers(d: SetupDeps, areaCode: unknown): Promise<AvailableNumber[]> {
  const { twilio } = ready(d);
  const code = typeof areaCode === "string" ? areaCode.trim() : "";
  if (!/^[2-9]\d{2}$/.test(code)) throw new ValidationError("Enter a 3-digit US area code, for example 337.");
  const account = await d.repo.get();
  if (!account?.subaccount_sid) throw new ValidationError("Set up text messaging first.");
  return twilio.searchNumbers(account.subaccount_sid, code);
}

export async function buyNumber(d: SetupDeps, phoneNumber: unknown): Promise<SmsAccount> {
  const { twilio } = ready(d);
  const number = typeof phoneNumber === "string" ? phoneNumber.trim() : "";
  if (!isE164(number)) throw new ValidationError("Choose one of the numbers listed.");
  const account = await d.repo.get();
  if (!account?.subaccount_sid || !account.api_key_sid) throw new ValidationError("Set up text messaging first.");
  if (account.from_number) throw new ValidationError(`This office already texts from ${account.from_number}.`);
  if ((await d.repo.balance()) < MIN_CREDITS_FOR_NUMBER) throw new ValidationError("Buy text credits before choosing a number.");
  const bought = await twilio.buyNumber(account.subaccount_sid, number);
  return d.repo.update(account.id, { from_number: bought.phoneNumber, phone_number_sid: bought.sid, status: "active" });
}

/** The office's texting status, in words, for its settings page. */
export function smsSetupStep(account: SmsAccount | null): "start" | "number" | "registration" | "ready" | "suspended" {
  if (!account?.subaccount_sid || !account.api_key_sid) return "start";
  if (account.status === "suspended") return "suspended";
  if (!account.from_number && !account.messaging_service_sid) return "number";
  if (account.registration_status !== "approved") return "registration";
  return "ready";
}
