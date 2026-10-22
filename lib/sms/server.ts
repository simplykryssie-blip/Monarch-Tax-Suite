import "server-only";
import { platformClient, tenantClient } from "../supabase/service";
import { currentTenantId, MONARCH_TENANT_ID, PLATFORM_TENANT_ID } from "../tenants.ts";
import { CrmSecrets } from "../crm/crypto.ts";
import { platformLogin, platformTwilio, TwilioAccounts, TwilioSmsSender, type SmsSender } from "../automation/twilio.ts";
import { resolveSmsRoute, type SmsRoute } from "./route.ts";
import { SupabaseSmsAccountsRepo } from "./supabase-repo.ts";
import { inboundUrlForNumbers } from "./inbound";
import { advanceRegistration, ensureInbound, fulfilSmsCheckout, provision, runRenewal, type Notify, type PaidSession, type Payments, type SetupDeps } from "./service.ts";
import { SupabaseDocumentsRepo } from "../documents/supabase-repo.ts";
import { SupabaseBrandRepo } from "../branding/supabase-repo.ts";
import { emailConfig, emailConfigProblems, ResendEmailSender } from "../automation/email.ts";
import { PLATFORM } from "../platform-brand.ts";
import { stripeClient } from "../admin";
import { ValidationError } from "../commerce/validation.ts";
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

/** The platform's primary Twilio business profile (BU…), which every office's local-number registration links to. */
const primaryProfileSid = () => {
  const v = process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID?.trim() ?? "";
  return /^BU[0-9a-f]{32}$/i.test(v) ? v : null;
};

async function officeProfile(tenantId: string) {
  const [profile, brand] = await Promise.all([
    new SupabaseDocumentsRepo(tenantClient(tenantId)).getProfile().catch(() => null),
    new SupabaseBrandRepo(tenantClient(tenantId), tenantId).get().catch(() => null),
  ]);
  return { name: brand?.name || profile?.display_name || profile?.legal_name || "Your office", email: profile?.email || brand?.support_email || null };
}

/** Texting notices go to the office's own email (its firm profile), from the platform's sending address. */
function emailNotify(tenantId: string, to: string | null): Notify {
  return async (subject, text) => {
    try {
      const cfg = emailConfig(process.env);
      if (!to || emailConfigProblems(cfg).length) {
        console.warn(`sms-notice: not emailed (${!to ? "no office email" : "email not configured"}): ${subject}`);
        return;
      }
      const day = new Date().toISOString().slice(0, 10);
      const html = `<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`;
      const r = await new ResendEmailSender(cfg).send({ to, subject: `${PLATFORM.name}: ${subject}`, html, text, idempotencyKey: `sms-notice:${tenantId}:${subject}:${day}` });
      if (!r.ok) console.warn(`sms-notice: ${r.kind}: ${r.message.slice(0, 160)}`);
    } catch (e) {
      console.warn(`sms-notice failed: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
    }
  };
}

export async function smsSetupDeps(tenantId: string = currentTenantId()): Promise<SetupDeps & { officeEmail: string | null }> {
  const platform = platformTwilio(process.env);
  const login = platformLogin(platform);
  const office = await officeProfile(tenantId);
  return {
    tenantId,
    repo: smsRepo(tenantId),
    twilio: login ? new TwilioAccounts(login) : null,
    parentSid: login ? platform.accountSid : null,
    secrets: secrets(),
    primaryProfileSid: primaryProfileSid(),
    officeName: office.name,
    inboundUrl: await inboundUrlForNumbers(),
    officeEmail: office.email,
    notify: emailNotify(tenantId, office.email),
  };
}

/** Card checkouts for texting, on the platform's own Stripe account. */
export function smsPayments(): Payments {
  return {
    async createCheckout(input) {
      const stripe = stripeClient();
      if (!stripe) throw new ValidationError("Card payments aren't set up yet. Try again later.");
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{ quantity: input.quantity, price_data: { currency: "usd", unit_amount: input.unitCents, product_data: { name: input.item } } }],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        ...(input.email ? { customer_email: input.email } : {}),
        client_reference_id: input.metadata.tenant_id,
        metadata: input.metadata,
        payment_intent_data: { metadata: input.metadata, description: input.item },
      });
      if (!session.url) throw new Error("Stripe didn't return a checkout page.");
      return { id: session.id, url: session.url };
    },
  };
}

/** Honours a paid texting checkout from Stripe (webhook, or the office returning from Checkout). */
export async function fulfilSmsSession(session: PaidSession): Promise<string> {
  const tenantId = session.metadata?.tenant_id ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(tenantId)) throw new Error("Texting checkout has no account.");
  return fulfilSmsCheckout(await smsSetupDeps(tenantId), session);
}

/**
 * The daily texting sweep, for every office with a texting account: finish setups that stopped, read carrier
 * registration statuses, and run monthly renewals (charge, retry, release, forfeit). Each office is handled with its
 * own tenant-scoped client; the platform read lists tenant ids only. One office's failure never stops the others.
 */
export async function runSmsSweep(limit = 200): Promise<{ offices: number; renewals: Record<string, number>; errors: number }> {
  const { data, error } = await platformClient("sms_sweep").from("tenants").select("id").neq("id", MONARCH_TENANT_ID).neq("id", PLATFORM_TENANT_ID).limit(limit);
  if (error) throw new Error(error.message);
  const renewals: Record<string, number> = {};
  let offices = 0;
  let errors = 0;
  for (const { id } of (data ?? []) as { id: string }[]) {
    try {
      const repo = smsRepo(id);
      const account = await repo.get().catch(() => null);
      if (!account) continue;
      offices++;
      const d = await smsSetupDeps(id);
      if (account.setup_paid_at && account.provision_status !== "done") await provision(d);
      else if (account.registration_status === "submitted" || (account.provision_status === "done" && account.registration_status === "not_started")) await advanceRegistration(d);
      await ensureInbound(d).catch((e) => console.warn(`sms-sweep: incoming-text address not set for ${id.slice(0, 8)}: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`));
      const did = await runRenewal(d);
      renewals[did] = (renewals[did] ?? 0) + 1;
    } catch (e) {
      errors++;
      console.error(`sms-sweep: tenant ${id.slice(0, 8)}: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
    }
  }
  await ensurePlatformInbound().catch((e) => console.warn(`sms-sweep: owner number incoming-text address not set: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`));
  return { offices, renewals, errors };
}

/** The owner's own number (Monarch texts from it) also sends incoming texts to the platform, so STOP replies are honoured there too. */
async function ensurePlatformInbound(): Promise<void> {
  const platform = platformTwilio(process.env);
  const login = platformLogin(platform);
  const url = await inboundUrlForNumbers();
  if (!url || !login || !platform.accountSid || !platform.from) return;
  const twilio = new TwilioAccounts(login);
  const found = await twilio.findNumberSid(platform.accountSid, platform.from);
  if (found && found.smsUrl !== url) await twilio.setNumberInbound(platform.accountSid, found.sid, url);
}
