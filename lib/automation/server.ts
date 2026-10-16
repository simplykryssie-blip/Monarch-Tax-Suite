import "server-only";
import { appOrigin } from "../admin";
import { SupabaseCommerceRepo } from "../commerce/supabase-repo.ts";
import { SupabaseServiceOrdersRepo } from "../commerce/supabase-services.ts";
import { tenantClient } from "../supabase/service";
import { currentTenantId, MONARCH_TENANT_ID } from "../tenants.ts";
import { documentDeps } from "../documents/server";
import { formDeps } from "../forms/server";
import { answerStrings } from "../forms/service.ts";
import { inputFields } from "../forms/definition.ts";
import { emailBrandOf } from "../branding/brand.ts";
import { loadBrand } from "../branding/server";
import { SupabaseSendersRepo } from "./supabase-senders.ts";
import type { ResolvedSender } from "./senders.ts";
import type { WorkflowCatalog } from "./validate.ts";
import { CrmSecrets } from "../crm/crypto.ts";
import { SupabaseCrmRepo } from "../crm/supabase-repo.ts";
import type { AutomationConfig, AutomationDeps, EmitInput } from "./engine.ts";
import { emitEvent, runDue } from "./engine.ts";
import { emailConfig, emailConfigProblems, ResendEmailSender } from "./email.ts";
import { platformProblems, platformSendProblems, platformTwilio } from "./twilio.ts";
import { sanitizeError } from "./sanitize.ts";
import { SupabaseAutomationRepo } from "./supabase-repo.ts";

// Server wiring for the Automation Center. Secrets (Resend key, service role, encryption key) are read here
// from the environment and never returned to callers or the browser.

const env = () => process.env;

export function automationConfig(): AutomationConfig {
  const e = env();
  const support = e.MONARCH_SUPPORT_EMAIL?.trim() || "support@monarchtaxsuite.com";
  const vercel = e.VERCEL_ENV;
  return {
    origin: () => appOrigin(),
    supportEmail: support,
    supportRecipient: e.AUTOMATION_ADMIN_EMAIL?.trim() || support,
    env: vercel === "production" ? "production" : vercel === "preview" ? "preview" : "development",
    testRecipients: (e.AUTOMATION_TEST_RECIPIENTS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}

/** The platform's configured sender (MONARCH_EMAIL_FROM). Only Monarch, tenant #1, may fall back to it. */
function platformSender(tenantId: string): ResolvedSender | null {
  const from = emailConfig(env()).from;
  return tenantId === MONARCH_TENANT_ID && from ? { from, replyTo: emailConfig(env()).replyTo, label: from } : null;
}

export function automationDeps(tenantId: string = currentTenantId()): AutomationDeps {
  const db = tenantClient(tenantId);
  let documents = null;
  let forms = null;
  try {
    documents = documentDeps(tenantId);
    forms = formDeps(tenantId);
  } catch {
    // Without MONARCH_ENCRYPTION_KEY document steps fail with a clear configuration error; everything else works.
  }
  return {
    repo: new SupabaseAutomationRepo(db),
    commerce: new SupabaseCommerceRepo(db),
    crm: new SupabaseCrmRepo(db),
    services: new SupabaseServiceOrdersRepo(db),
    email: new ResendEmailSender(emailConfig(env())),
    config: automationConfig(),
    brand: async () => emailBrandOf(await loadBrand(tenantId)),
    documents,
    senders: new SupabaseSendersRepo(db),
    fallbackSender: platformSender(tenantId),
    formAnswers: forms ? (id: string) => answerStrings(forms, id) : null,
  };
}

/** The tenant's own documents, verified senders and package attributes, for building and checking workflows. */
export async function workflowCatalog(deps: AutomationDeps = automationDeps()): Promise<WorkflowCatalog> {
  const docsRepo = deps.documents?.repo;
  const [documents, senders, domains, attributes, forms] = await Promise.all([
    docsRepo
      ? docsRepo.listDocuments().then((list) => Promise.all(list.map(async (d) => ({ ...d, merge_fields: d.current_version_id ? (await docsRepo.getVersion(d.current_version_id).catch(() => null))?.merge_fields ?? [] : [] })))).catch(() => [])
      : [],
    deps.senders ? deps.senders.listSenders().catch(() => []) : [],
    deps.senders ? deps.senders.listDomains().catch(() => []) : [],
    deps.senders ? deps.senders.listPackageAttributes().catch(() => []) : [],
    publishedForms(),
  ]);
  const verified = new Map(domains.filter((d) => d.status === "verified").map((d) => [d.id, d]));
  return {
    forms,
    documents,
    senders: senders.filter((s) => !s.archived_at && verified.has(s.domain_id)).map((s) => ({ ...s, address: `${s.local_part}@${verified.get(s.domain_id)!.domain}` })),
    attributes,
  };
}

/** The tenant's published forms and their questions, for form workflows. */
async function publishedForms(): Promise<NonNullable<WorkflowCatalog["forms"]>> {
  try {
    const f = formDeps();
    const list = (await f.repo.listForms()).filter((x) => x.current_version_id && x.status !== "archived");
    return await Promise.all(list.map(async (x) => {
      const v = await f.repo.getVersion(x.current_version_id!);
      return { id: x.id, name: x.name, questions: v ? inputFields(v.definition).map((q) => ({ key: q.key, label: q.label, type: q.type, options: q.options ?? [] })) : [] };
    }));
  } catch {
    return [];
  }
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
  /** The owner's Twilio account: tenant #1 texts from it, and it is the parent of every office's subaccount. */
  twilio: { canSend: boolean; canManage: boolean; problems: string[] };
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
    twilio: { canSend: platformSendProblems(platformTwilio(e)).length === 0, canManage: platformProblems(platformTwilio(e)).length === 0, problems: platformSendProblems(platformTwilio(e)) },
    highlevel: { appConfigured: Boolean(e.HIGHLEVEL_CLIENT_ID && e.HIGHLEVEL_CLIENT_SECRET) },
    stripe: { secretKey: Boolean(sk), webhookSecret: Boolean(e.STRIPE_WEBHOOK_SECRET), mode: /^(sk|rk)_test_/.test(sk) ? "test" : /^(sk|rk)_live_/.test(sk) ? "live" : "unknown" },
    app: { encryptionKey: CrmSecrets.fromBase64(e.MONARCH_ENCRYPTION_KEY) !== null, appUrl: e.NEXT_PUBLIC_APP_URL ?? null, schedulerSecret: Boolean(e.CRON_SECRET), environment: automationConfig().env, testRecipients: automationConfig().testRecipients.length },
  };
}
