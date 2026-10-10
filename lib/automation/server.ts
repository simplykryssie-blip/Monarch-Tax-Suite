import "server-only";
import { appOrigin, commerceRepo, serviceClient } from "../admin";
import { CrmSecrets } from "../crm/crypto.ts";
import { SupabaseCrmRepo } from "../crm/supabase-repo.ts";
import type { AutomationConfig, AutomationDeps, EmitInput } from "./engine.ts";
import { emitEvent, runDue } from "./engine.ts";
import { emailConfig, emailConfigProblems, ResendEmailSender } from "./email.ts";
import { sanitizeError } from "./sanitize.ts";
import { SupabaseAutomationRepo } from "./supabase-repo.ts";

// Server wiring for the Automation Center. Secrets (Resend key, service role, encryption key) are read here
// from the environment and never returned to callers or the browser.

const env = () => process.env;

export function automationConfig(): AutomationConfig {
  const e = env();
  const support = e.MONARCH_SUPPORT_EMAIL?.trim() || "info@monarchtaxsuite.com";
  const vercel = e.VERCEL_ENV;
  return {
    origin: () => appOrigin(),
    supportEmail: support,
    supportRecipient: e.AUTOMATION_ADMIN_EMAIL?.trim() || support,
    env: vercel === "production" ? "production" : vercel === "preview" ? "preview" : "development",
    testRecipients: (e.AUTOMATION_TEST_RECIPIENTS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}

export function automationDeps(): AutomationDeps {
  const db = serviceClient();
  return {
    repo: new SupabaseAutomationRepo(db),
    commerce: commerceRepo(),
    crm: new SupabaseCrmRepo(db),
    email: new ResendEmailSender(emailConfig(env())),
    config: automationConfig(),
  };
}

export function setupSecrets(): CrmSecrets | null {
  return CrmSecrets.fromBase64(env().MONARCH_ENCRYPTION_KEY);
}

/**
 * Raises an event without ever failing the caller. A payment, license change or lead must go through
 * even if the Automation Center tables are not installed yet or the email provider is down.
 */
export async function safeEmit(input: EmitInput): Promise<void> {
  try {
    await emitEvent(automationDeps(), input);
  } catch (e) {
    console.error(`automation: could not process ${input.type}: ${sanitizeError(e, 160)}`);
  }
}

/** Runs due retries (used by the scheduler endpoint and opportunistically). Never throws. */
export async function runDueSafe(limit = 10): Promise<number> {
  try {
    return (await runDue(automationDeps(), limit)).processed;
  } catch (e) {
    console.error(`automation: retry sweep failed: ${sanitizeError(e, 160)}`);
    return 0;
  }
}

export type IntegrationStatus = {
  resend: { configured: boolean; keySource: string | null; sender: string | null; replyTo: string | null; problems: string[] };
  highlevel: { appConfigured: boolean };
  stripe: { secretKey: boolean; webhookSecret: boolean; mode: "test" | "live" | "unknown" };
  app: { encryptionKey: boolean; appUrl: string | null; schedulerSecret: boolean; environment: string; testRecipients: number };
};

/** Presence and shape only. Values of keys and secrets are never included. */
export function integrationStatus(): IntegrationStatus {
  const e = env();
  const cfg = emailConfig(e);
  const sk = e.STRIPE_SECRET_KEY ?? "";
  return {
    resend: { configured: emailConfigProblems(cfg).length === 0, keySource: cfg.keySource, sender: cfg.from, replyTo: cfg.replyTo, problems: emailConfigProblems(cfg) },
    highlevel: { appConfigured: Boolean(e.HIGHLEVEL_CLIENT_ID && e.HIGHLEVEL_CLIENT_SECRET) },
    stripe: { secretKey: Boolean(sk), webhookSecret: Boolean(e.STRIPE_WEBHOOK_SECRET), mode: /^(sk|rk)_test_/.test(sk) ? "test" : /^(sk|rk)_live_/.test(sk) ? "live" : "unknown" },
    app: { encryptionKey: CrmSecrets.fromBase64(e.MONARCH_ENCRYPTION_KEY) !== null, appUrl: e.NEXT_PUBLIC_APP_URL ?? null, schedulerSecret: Boolean(e.CRON_SECRET), environment: automationConfig().env, testRecipients: automationConfig().testRecipients.length },
  };
}
