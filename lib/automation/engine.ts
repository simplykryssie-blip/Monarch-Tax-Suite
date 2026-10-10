import { createHash, randomBytes } from "node:crypto";
import type { CommerceRepo } from "../commerce/types.ts";
import { embedSnippet } from "../commerce/platforms.ts";
import { isEventType, EVENTS } from "./events.ts";
import { isEmailAddress, type EmailSender } from "./email.ts";
import { sanitizeError } from "./sanitize.ts";
import { renderTemplate, SAMPLE_VALUES, VARIABLES, variablesIn } from "./template.ts";
import type { Action, ActionResult, AutomationEvent, AutomationRepo, Condition, ErrorKind, Execution, SendEmailAction, Workflow } from "./types.ts";

// The workflow engine. Rules:
//  - Emitting the same event key twice never runs workflows twice.
//  - A workflow runs at most once per event; retries resume after the last successful action, so an
//    email that was sent is never sent again.
//  - Paused or archived workflows never run (including queued retries).
//  - Failures are classified: config (needs an administrator), transient (retried with backoff),
//    permanent (not retried). Error text is sanitized before it is stored.
//  - Nothing here fails the business action that raised the event: callers use safeEmit.

export type AutomationConfig = {
  origin: () => string | Promise<string>;
  supportEmail: string;
  /** Where "send to support" actions go. */
  supportRecipient: string;
  env: "production" | "preview" | "development";
  /** Outside production, customer emails are sent only to these addresses. */
  testRecipients: string[];
};

export type AutomationDeps = {
  repo: AutomationRepo;
  commerce: CommerceRepo;
  crm: { getLiveConnection(licenseId: string): Promise<{ status: string; provider: string; location_name: string | null } | null>; getLeadSettings(licenseId: string): Promise<{ business_name: string | null } | null> } | null;
  email: EmailSender;
  config: AutomationConfig;
  now?: () => Date;
};

export const BACKOFF_SECONDS = [60, 300, 1800, 7200, 21600, 43200, 86400];
export const LINK_TTL_DAYS = 14;
const STALE_RUNNING_MS = 10 * 60_000;
const nowOf = (d: AutomationDeps) => (d.now ? d.now() : new Date());
const iso = (d: AutomationDeps) => nowOf(d).toISOString();
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export type EmitInput = {
  type: string;
  key: string;
  licenseId?: string | null;
  customerId?: string | null;
  orderId?: string | null;
  data?: Record<string, string | number | boolean | null>;
};

export function conditionsMatch(conditions: Condition[], data: AutomationEvent["data"]): boolean {
  return conditions.every((c) => {
    const actual = data[c.field] === undefined || data[c.field] === null ? "" : String(data[c.field]);
    if (c.op === "eq") return actual === c.value;
    if (c.op === "neq") return actual !== c.value;
    return c.value.split(",").map((s) => s.trim()).includes(actual);
  });
}

function cleanData(data: EmitInput["data"]): AutomationEvent["data"] {
  const out: AutomationEvent["data"] = {};
  for (const [k, v] of Object.entries(data ?? {})) {
    if (!/^[a-z_]{1,40}$/.test(k)) continue;
    out[k] = typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 120) : v;
  }
  return out;
}

/**
 * Records an event once and queues every matching active workflow, then runs them.
 * `duplicate: true` means this key was already recorded and nothing new was started.
 */
export async function emitEvent(deps: AutomationDeps, input: EmitInput): Promise<{ duplicate: boolean; eventId: string; executionIds: string[] }> {
  if (!isEventType(input.type)) throw new Error(`Unknown event type: ${input.type}`);
  const { event, created } = await deps.repo.insertEvent({
    event_key: input.key.slice(0, 200),
    event_type: input.type,
    license_id: input.licenseId ?? null,
    customer_id: input.customerId ?? null,
    order_id: input.orderId ?? null,
    data: cleanData(input.data),
  });
  if (!created) return { duplicate: true, eventId: event.id, executionIds: [] };

  const workflows = (await deps.repo.listWorkflows()).filter((w) => w.status === "active" && w.trigger_event === input.type && conditionsMatch(w.conditions, event.data));
  const executionIds: string[] = [];
  for (const wf of workflows) {
    const { execution, created: fresh } = await deps.repo.insertExecution({ workflow_id: wf.id, event_id: event.id, is_test: false, max_attempts: wf.max_attempts, next_attempt_at: iso(deps) });
    if (!fresh) continue;
    if (wf.cooldown_hours > 0 && event.license_id) {
      const since = new Date(nowOf(deps).getTime() - wf.cooldown_hours * 3_600_000).toISOString();
      const recent = await deps.repo.findRecentSuccess(wf.id, event.license_id, since);
      if (recent) {
        await deps.repo.updateExecution(execution.id, { status: "skipped", error_kind: "skipped", error: `Skipped: this workflow already ran for this license within the last ${wf.cooldown_hours} hours.`, finished_at: iso(deps), next_attempt_at: null });
        continue;
      }
    }
    executionIds.push(execution.id);
  }
  for (const id of executionIds) {
    try {
      await processExecution(deps, id);
    } catch (e) {
      // The execution row already records state; never let one workflow stop the rest.
      console.error(`automation: execution ${id} crashed: ${sanitizeError(e, 160)}`);
    }
  }
  return { duplicate: false, eventId: event.id, executionIds };
}

// ------------------------------------------------------------------ context

async function recipientFor(deps: AutomationDeps, event: AutomationEvent, who: SendEmailAction["to"]): Promise<string | null> {
  if (who === "support") return deps.config.supportRecipient;
  let customerId = event.customer_id;
  if (!customerId && event.license_id) customerId = (await deps.commerce.getLicense(event.license_id))?.customer_id ?? null;
  const customer = customerId ? await deps.commerce.getCustomer(customerId) : null;
  return customer?.email ?? null;
}

const FAILURE_TEXT: Record<string, string> = {
  auth: "GoHighLevel no longer accepts the connection. Reconnect it from your setup page.",
  transient: "GoHighLevel was temporarily unavailable. Visitors were asked to try again.",
  permanent: "GoHighLevel rejected the contact details. Check your account settings.",
};

/** Real values for one event. Only fields a customer should see; never keys, tokens or lead contents. */
async function contextFor(deps: AutomationDeps, event: AutomationEvent): Promise<Record<string, string>> {
  const origin = (await deps.config.origin()).replace(/\/$/, "");
  const values: Record<string, string> = { support_email: deps.config.supportEmail, app_url: origin };
  const license = event.license_id ? await deps.commerce.getLicense(event.license_id) : null;
  const customerId = event.customer_id ?? license?.customer_id ?? null;
  const customer = customerId ? await deps.commerce.getCustomer(customerId) : null;
  if (customer) {
    const name = customer.full_name?.trim() || "there";
    values.customer_name = name;
    values.customer_first_name = name.split(/\s+/)[0] ?? name;
  }
  if (license) {
    const order = await deps.commerce.getOrder(license.order_id);
    const domains = (await deps.commerce.listDomains(license.id)).filter((d) => d.status === "active");
    const installation = await deps.commerce.findInstallationByOrder(license.order_id);
    const settings = deps.crm ? await deps.crm.getLeadSettings(license.id) : null;
    const connection = deps.crm ? await deps.crm.getLiveConnection(license.id) : null;
    values.business_name = settings?.business_name || customer?.full_name || "your business";
    values.license_reference = license.key_prefix ? `${license.key_prefix}…` : "being prepared";
    values.license_status = license.status;
    values.tax_year = license.licensed_tax_year ? String(license.licensed_tax_year) : "";
    values.order_number = order ? String(order.order_number) : "";
    values.authorized_domain = domains[0]?.domain ?? installation?.target_location ?? "";
    values.installation_status = installation?.status ?? "not recorded";
    values.crm_status = !connection ? "Not connected yet" : connection.status === "connected" ? "Connected" : "Needs to be reconnected";
    values.crm_account = connection?.provider === "highlevel" ? connection.location_name ?? "your GoHighLevel account" : connection ? "your workflow link" : "";
    const domain = values.authorized_domain;
    values.embed_instructions = license.embed_id
      ? [
          `1. Open the page${domain ? ` on ${domain}` : " on your authorized website"} where the calculator should appear. In GoHighLevel, add a Custom Code (HTML) element.`,
          "2. Paste this code:",
          embedSnippet(origin, license.embed_id),
          `3. Publish the page. The calculator shows only on your authorized website${domain ? ` (${domain} and its www version)` : ""}. If the area stays blank, check the website address in your setup page.`,
        ].join("\n")
      : "Your calculator code is created when your license is activated. We will email you as soon as it is ready.";
  }
  const kind = typeof event.data.error_kind === "string" ? event.data.error_kind : "";
  if (kind) values.failure_reason = FAILURE_TEXT[kind] ?? "A calculator lead could not be delivered.";
  return values;
}

// ----------------------------------------------------------- setup links

/** Creates a secure setup link for a license. Only a hash is stored; the raw token exists only in the email. */
export async function createSetupLink(deps: AutomationDeps, licenseId: string, createdBy: string | null) {
  const token = randomBytes(32).toString("base64url");
  const link = await deps.repo.insertLink({
    license_id: licenseId,
    token_hash: sha256(token),
    expires_at: new Date(nowOf(deps).getTime() + LINK_TTL_DAYS * 86_400_000).toISOString(),
    created_by: createdBy,
  });
  return { token, link, url: `${(await deps.config.origin()).replace(/\/$/, "")}/setup?t=${token}` };
}

export const hashSetupToken = sha256;

// ----------------------------------------------------------------- actions

type ActionOutcome = { status: "ok" | "failed" | "skipped"; detail: string; messageId?: string | null; kind?: ErrorKind };

async function runSendEmail(deps: AutomationDeps, exec: Execution, event: AutomationEvent, action: SendEmailAction, index: number): Promise<ActionOutcome> {
  const template = await deps.repo.getTemplate(action.template_id);
  if (!template) return { status: "failed", kind: "permanent", detail: "The email template for this step no longer exists. Choose another template in the workflow." };
  if (!template.active) return { status: "failed", kind: "config", detail: `The template "${template.name}" is switched off. Turn it on, then retry.` };

  const isTest = exec.is_test;
  const testRecipient = typeof event.data.test_recipient === "string" ? event.data.test_recipient : null;
  const to = isTest ? testRecipient : await recipientFor(deps, event, action.to);
  if (!to || !isEmailAddress(to)) return { status: "failed", kind: "permanent", detail: isTest ? "No valid test recipient." : "There is no valid email address for this customer, so nothing was sent." };

  if (!isTest && deps.config.env !== "production" && !deps.config.testRecipients.map((r) => r.toLowerCase()).includes(to.toLowerCase())) {
    return { status: "skipped", kind: "skipped", detail: `Not sent: this is a ${deps.config.env} environment, where email goes only to the addresses in AUTOMATION_TEST_RECIPIENTS.` };
  }

  let values: Record<string, string>;
  let createdLink: { id: string } | null = null;
  if (isTest) {
    values = { ...SAMPLE_VALUES };
  } else {
    values = await contextFor(deps, event);
    const needsLink = action.include_setup_link || variablesIn(template.subject, template.body).includes("setup_link");
    if (needsLink) {
      if (!event.license_id) return { status: "failed", kind: "permanent", detail: "This step needs a setup link but the event has no license." };
      const made = await createSetupLink(deps, event.license_id, null);
      values.setup_link = made.url;
      createdLink = made.link;
    }
  }

  let rendered;
  try {
    rendered = renderTemplate(template.subject, template.body, values, { supportEmail: deps.config.supportEmail });
  } catch (e) {
    return { status: "failed", kind: "permanent", detail: sanitizeError(e, 200) };
  }
  const result = await deps.email.send({
    to,
    subject: isTest ? `[TEST] ${rendered.subject}` : rendered.subject,
    html: rendered.html,
    text: isTest ? `*** TEST EMAIL: sample data only ***\n\n${rendered.text}` : rendered.text,
    idempotencyKey: `${exec.id}:${index}`,
  });
  if (!result.ok) return { status: "failed", kind: result.kind, detail: result.message };
  // The new link is the live one; older links are retired only after the email actually went out.
  if (createdLink && event.license_id) await deps.repo.revokeLinksForLicense(event.license_id, iso(deps), createdLink.id);
  return { status: "ok", detail: `Email "${template.name}" sent to ${isTest ? "the test recipient" : action.to === "support" ? "support" : "the customer"}.`, messageId: result.id };
}

async function runAction(deps: AutomationDeps, exec: Execution, event: AutomationEvent, action: Action, index: number): Promise<ActionOutcome> {
  if (action.type === "record_note") return { status: "ok", detail: action.note.slice(0, 300) };
  return runSendEmail(deps, exec, event, action, index);
}

// -------------------------------------------------------------- execution

export async function processExecution(deps: AutomationDeps, executionId: string): Promise<Execution | null> {
  const now = nowOf(deps);
  const claimed = await deps.repo.claimExecution(executionId, now.toISOString(), new Date(now.getTime() - STALE_RUNNING_MS).toISOString());
  if (!claimed) return null;
  const wf = await deps.repo.getWorkflow(claimed.workflow_id);
  const event = await deps.repo.getEvent(claimed.event_id);
  if (!wf || !event) return deps.repo.updateExecution(claimed.id, { status: "failed", error_kind: "permanent", error: "The workflow or event record is missing.", finished_at: iso(deps), next_attempt_at: null });
  if (!claimed.is_test && wf.status !== "active") {
    return deps.repo.updateExecution(claimed.id, { status: "skipped", error_kind: "skipped", error: "The workflow is paused or archived, so this did not run. Turn it on and use Retry to run it.", finished_at: iso(deps), next_attempt_at: null });
  }

  const log: ActionResult[] = [...claimed.action_log];
  let messageId = claimed.provider_message_id;
  for (let i = 0; i < wf.actions.length; i++) {
    const done = log.find((l) => l.index === i && (l.status === "ok" || l.status === "skipped"));
    if (done) continue;
    let outcome: ActionOutcome;
    try {
      outcome = await runAction(deps, claimed, event, wf.actions[i], i);
    } catch (e) {
      outcome = { status: "failed", kind: "transient", detail: sanitizeError(e, 240) };
    }
    const entry: ActionResult = { index: i, type: wf.actions[i].type, status: outcome.status, detail: sanitizeError(outcome.detail, 300), message_id: outcome.messageId ?? null, at: iso(deps) };
    const at = log.findIndex((l) => l.index === i);
    if (at >= 0) log[at] = entry;
    else log.push(entry);
    if (outcome.messageId) messageId = outcome.messageId;

    if (outcome.status === "failed") {
      const kind = outcome.kind ?? "transient";
      const retry = kind === "transient" && claimed.attempts < claimed.max_attempts;
      const wait = BACKOFF_SECONDS[Math.min(claimed.attempts - 1, BACKOFF_SECONDS.length - 1)];
      return deps.repo.updateExecution(claimed.id, {
        status: retry ? "retrying" : "failed",
        error: sanitizeError(outcome.detail, 500),
        error_kind: kind,
        action_log: log,
        provider_message_id: messageId,
        next_attempt_at: retry ? new Date(nowOf(deps).getTime() + wait * 1000).toISOString() : null,
        finished_at: retry ? null : iso(deps),
      });
    }
  }
  return deps.repo.updateExecution(claimed.id, { status: "succeeded", error: null, error_kind: null, action_log: log, provider_message_id: messageId, finished_at: iso(deps), next_attempt_at: null });
}

/** Processes queued and retrying executions that are due. Safe to call from many places; claims are atomic. */
export async function runDue(deps: AutomationDeps, limit = 20): Promise<{ processed: number }> {
  const due = await deps.repo.listDue(iso(deps), limit);
  let processed = 0;
  for (const e of due) {
    try {
      if (await processExecution(deps, e.id)) processed++;
    } catch (err) {
      console.error(`automation: execution ${e.id} crashed: ${sanitizeError(err, 160)}`);
    }
  }
  return { processed };
}

/** Administrator retry of a failed (or paused-skipped) execution. Completed actions are not repeated. */
export async function retryExecution(deps: AutomationDeps, executionId: string, actorId: string): Promise<Execution> {
  const exec = await deps.repo.getExecution(executionId);
  if (!exec) throw new Error("Execution not found.");
  if (exec.status !== "failed" && exec.status !== "skipped") throw new Error("Only failed or skipped runs can be retried.");
  const wf = await deps.repo.getWorkflow(exec.workflow_id);
  if (!wf || wf.status === "archived") throw new Error("This workflow is archived. Restore it before retrying.");
  if (wf.status !== "active" && !exec.is_test) throw new Error("Turn the workflow on before retrying.");
  await deps.repo.updateExecution(exec.id, { status: "queued", attempts: 0, max_attempts: wf.max_attempts, next_attempt_at: iso(deps), error: null, error_kind: null, finished_at: null });
  await deps.repo.addAudit({ actor_id: actorId, action: "execution_retried", target_type: "execution", target_id: exec.id, detail: { workflow_id: exec.workflow_id } });
  return (await processExecution(deps, exec.id)) ?? (await deps.repo.getExecution(exec.id))!;
}

/**
 * A safe test: runs the workflow with obviously fake sample values and sends only to the administrator's
 * own address. No customer, license or CRM is touched, and no setup link is created.
 */
export async function runTest(deps: AutomationDeps, workflowId: string, admin: { id: string; email: string }): Promise<Execution> {
  const wf = await deps.repo.getWorkflow(workflowId);
  if (!wf) throw new Error("Workflow not found.");
  const { event } = await deps.repo.insertEvent({ event_key: `test:${randomBytes(9).toString("base64url")}`, event_type: wf.trigger_event, license_id: null, customer_id: null, order_id: null, data: { test_recipient: admin.email } });
  const { execution } = await deps.repo.insertExecution({ workflow_id: wf.id, event_id: event.id, is_test: true, max_attempts: 1, next_attempt_at: iso(deps) });
  await deps.repo.addAudit({ actor_id: admin.id, action: "workflow_test_run", target_type: "workflow", target_id: wf.id, detail: {} });
  return (await processExecution(deps, execution.id)) ?? execution;
}

export { EVENTS, VARIABLES };
export type { Workflow };
