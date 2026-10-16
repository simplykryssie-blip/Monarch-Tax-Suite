import "server-only";
import { tenantClient } from "../supabase/service";
import { currentTenantId } from "../tenants.ts";
import { CrmSecrets } from "../crm/crypto.ts";
import { platformLogin, platformTwilio, TwilioAccounts, TwilioSmsSender, type SmsSender } from "../automation/twilio.ts";
import { resolveSmsRoute, type SmsRoute } from "./route.ts";
import { SupabaseSmsAccountsRepo } from "./supabase-repo.ts";
import type { SetupDeps } from "./service.ts";
import type { SmsAccount, SmsAccountsRepo } from "./types.ts";

// Server wiring for per-tenant texting. The owner's Twilio credentials (Vercel) are tenant #1's account and the parent
// of every tenant subaccount; nothing here ever returns a credential.

export const smsRepo = (tenantId: string = currentTenantId()) => new SupabaseSmsAccountsRepo(tenantClient(tenantId));
const secrets = () => CrmSecrets.fromBase64(process.env.MONARCH_ENCRYPTION_KEY);

/** The tenant's texting account row, or null (also null before the migration is applied). */
export async function smsAccount(repo: SmsAccountsRepo): Promise<SmsAccount | null> {
  return repo.get().catch(() => null);
}

export type TenantSms = { route: SmsRoute; sender: SmsSender | null; repo: SmsAccountsRepo };

/** Where the current tenant's texts go out from, and a sender for it when it is ready. */
export async function tenantSms(tenantId: string = currentTenantId()): Promise<TenantSms> {
  const repo = smsRepo(tenantId);
  const route = resolveSmsRoute(tenantId, await smsAccount(repo), platformTwilio(process.env), secrets());
  return { route, repo, sender: route.ok ? new TwilioSmsSender(route.route) : null };
}

export function smsSetupDeps(tenantId: string = currentTenantId()): SetupDeps {
  const login = platformLogin(platformTwilio(process.env));
  return { tenantId, repo: smsRepo(tenantId), twilio: login ? new TwilioAccounts(login) : null, secrets: secrets() };
}
