import "server-only";
import { appOrigin } from "../admin";
import { hashClient } from "../commerce/rate-limit.ts";
import { CrmSecrets } from "../crm/crypto.ts";
import { sendPlatformEmail } from "../platform-mail-server";
import { practicePlatform, practiceRepo, practiceInviteLink } from "../practice/server";
import { rateLimitStore } from "../rate-limit-server";
import { platformClient, tenantClient } from "../supabase/service";
import { PLATFORM_LEGAL_VERSION } from "../platform-legal.ts";
import { verifyCaptcha } from "./captcha.ts";
import { billingProblems } from "./plans.ts";
import type { BillingDeps } from "./service.ts";
import { billingStripe } from "./stripe-port";
import { SupabaseBillingRepo } from "./supabase-repo";

/** The key signup links are signed with, derived from MONARCH_ENCRYPTION_KEY. */
export function signupKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const s = CrmSecrets.fromBase64(env.MONARCH_ENCRYPTION_KEY);
  return s ? Buffer.from(s.hashIdentifier("signup-link-key", "v1"), "hex") : null;
}

/** Signup is open when billing is set up, and (in production) once the owner has approved the policies and the bot check is on. */
export function billingReady(env: NodeJS.ProcessEnv = process.env): { ok: true } | { ok: false; problems: string[] } {
  const problems = billingProblems(env);
  return problems.length ? { ok: false, problems } : { ok: true };
}

const hourWindow = () => new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString();

export function ipHashOf(forwardedFor: string | null): { ip: string | null; hash: string | null } {
  const ip = forwardedFor?.split(",")[0]?.trim() || null;
  if (!ip || ip.length > 64) return { ip: null, hash: null };
  return { ip, hash: hashClient(ip, process.env.MONARCH_ENCRYPTION_KEY) };
}

/** Everything the billing rules need, wired to the real database, Stripe and email. Null when billing isn't configured. */
export function billingDeps(): BillingDeps | null {
  const stripe = billingStripe();
  const key = signupKey();
  if (!stripe || !key) return null;
  const store = rateLimitStore();
  return {
    repo: new SupabaseBillingRepo(),
    stripe: stripe.port,
    key,
    origin: () => appOrigin(),
    provision: {
      createTenant: (i) => practicePlatform().createTenant(i),
      tenantBySlug: (slug) => practicePlatform().tenantBySlug(slug),
      practiceRepo,
      inviteLink: practiceInviteLink,
    },
    accountExists: async (email) => {
      const [holder, office] = await Promise.all([
        platformClient("signup").from("practice_members").select("id").eq("email", email).limit(1).maybeSingle(),
        platformClient("signup").from("office_members").select("id").eq("email", email).limit(1).maybeSingle(),
      ]);
      return Boolean(holder.data || office.data);
    },
    ownerEmail: async (tenantId) => {
      const { data } = await tenantClient(tenantId).from("practice_members").select("email, full_name").eq("role", "owner").limit(1).maybeSingle();
      return data ? { email: data.email as string, name: data.full_name as string } : null;
    },
    mail: (to, mail) => sendPlatformEmail(to, mail),
    hit: (bucket) => store.hit(bucket, hourWindow()),
    captcha: (token, ip) => verifyCaptcha(process.env, token, ip),
    termsVersion: PLATFORM_LEGAL_VERSION,
  };
}
