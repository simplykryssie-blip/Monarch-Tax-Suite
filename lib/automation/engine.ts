import { createHash, randomBytes } from "node:crypto";
import type { CommerceRepo } from "../commerce/types.ts";
import type { ServiceOrdersRepo } from "../commerce/service-orders.ts";
import { embedSnippet } from "../commerce/platforms.ts";
import { isEventType, EVENTS } from "./events.ts";
import { isEmailAddress, type EmailSender } from "./email.ts";
import { sanitizeError } from "./sanitize.ts";
import { renderTemplate, SAMPLE_VALUES, VARIABLES, variablesIn } from "./template.ts";
import { resolveSender, type ResolvedSender, type SendersRepo } from "./senders.ts";
import { ValidationError } from "../commerce/validation.ts";
import { createDelivery, deliveryPathFor, MissingValuesError, type DocumentDeps } from "../documents/service.ts";
import { SAMPLE_FIELD_VALUES } from "../documents/fields.ts";
import { documentValues } from "../documents/values.ts";
import { documentEmail } from "../documents/emails.ts";
import type { Action, ActionResult, AutomationEvent, AutomationRepo, Condition, ErrorKind, Execution, RequestSignatureAction, SendDocumentAction, SendEmailAction, Workflow } from "./types.ts";

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

/** A tenant's look for its customer emails (name, logo, colour, support address). Absent: the Monarch default. */
export type EmailBrandSource = () => Promise<import("../branding/brand.ts").EmailBrand | null>;

export type AutomationDeps = {
  /** The tenant's email brand. Optional: tests and the default render the standard look. */
  brand?: EmailBrandSource;
  repo: AutomationRepo;
  commerce: CommerceRepo;
  crm: { getLiveConnection(licenseId: string): Promise<{ status: string; provider: string; location_name: string | null } | null>; getLeadSettings(licenseId: string): Promise<{ business_name: string | null } | null> } | null;
  /** Service orders, for the service email values. Optional: absent where no service orders exist. */
  services?: Pick<ServiceOrdersRepo, "findServiceOrderByOrder"> | null;
  email: EmailSender;
  config: AutomationConfig;
  /** The tenant's document library (send document / request signature steps). */
  documents?: DocumentDeps | null;
  /** The tenant's sending addresses. Absent: emails go from the configured platform sender. */
  senders?: SendersRepo | null;
  /** Used when the tenant has no verified sender of its own (only for tenants allowed the platform sender). */
  fallbackSender?: ResolvedSender | null;
  /** A form submission's answers as text (form.submitted events): for answer.<key> conditions and {{form.<key>}} merge fields. */
  formAnswers?: ((submissionId: string) => Promise<Record<string, string> | null>) | null;
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

/** Conditions on `product.<attribute>` read the attributes of the product behind the event's order. */
export const PRODUCT_FIELD = /^product\.([a-z][a-z0-9_]{1,39})$/;
/** Conditions on `answer.<key>` read the submitted answer to that form question (form.submitted events). */
export const ANSWER_FIELD = /^answer\.([a-z][a-z0-9_]{0,39})$/;

export function conditionsMatch(conditions: Condition[], data: AutomationEvent["data"], product: Record<string, string> | null = null, answers: Record<string, string> | null = null): boolean {
  return conditions.every((c) => {
    const attr = c.field.match(PRODUCT_FIELD)?.[1];
    const answer = c.field.match(ANSWER_FIELD)?.[1];
    const raw = attr ? product?.[attr] : answer ? answers?.[answer] : data[c.field];
    const actual = raw === undefined || raw === null ? "" : String(raw).trim();
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

  const candidates = (await deps.repo.listWorkflows()).filter((w) => w.status === "active" && w.trigger_event === input.type);
  const product = candidates.some((w) => w.conditions.some((c) => PRODUCT_FIELD.test(c.field))) ? await productAttributes(deps, event) : null;
  const answers = candidates.some((w) => w.conditions.some((c) => ANSWER_FIELD.test(c.field))) ? await submissionAnswers(deps, event) : null;
  const workflows = candidates.filter((w) => conditionsMatch(w.conditions, event.data, product, answers));
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

/** The attributes (product settings) of the product behind an event's order, for package conditions. */
async function productAttributes(deps: AutomationDeps, event: AutomationEvent): Promise<Record<string, string> | null> {
  let orderId = event.order_id;
  if (!orderId && event.license_id) orderId = (await deps.commerce.getLicense(event.license_id))?.order_id ?? null;
  const order = orderId ? await deps.commerce.getOrder(orderId) : null;
  const product = order ? await deps.commerce.getProduct(order.product_id) : null;
  return product ? { ...product.metadata } : null;
}

/** The answers of the form submission behind a form.submitted event. */
async function submissionAnswers(deps: AutomationDeps, event: AutomationEvent): Promise<Record<string, string> | null> {
  const id = typeof event.data.submission_id === "string" ? event.data.submission_id : null;
  return id && deps.formAnswers ? deps.formAnswers(id) : null;
}

/** From / reply-to for an email: the chosen sender, else the tenant's default, else the platform sender. */
export async function senderFor(deps: AutomationDeps, senderId: string | null | undefined): Promise<{ from?: string; replyTo?: string | null; label?: string }> {
  if (!deps.senders && !senderId) return {};
  const s = await resolveSender(deps.senders ?? null, senderId ?? null, deps.fallbackSender ?? null);
  return { from: s.from, replyTo: s.replyTo, label: s.label };
}

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
  const eb = (await deps.brand?.().catch(() => null)) ?? null;
  const values: Record<string, string> = { support_email: eb?.supportEmail ?? deps.config.supportEmail, app_url: origin };
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
  // Purchases without a license (services): the order, the product, and what the buyer was promised.
  if (!license && event.order_id) {
    const order = await deps.commerce.getOrder(event.order_id);
    if (order) {
      values.order_number = String(order.order_number);
      if (!customer) {
        const c = await deps.commerce.getCustomer(order.customer_id);
        if (c) Object.assign(values, { customer_name: c.full_name?.trim() || "there", customer_first_name: (c.full_name?.trim() || "there").split(/\s+/)[0] });
      }
      const product = await deps.commerce.getProduct(order.product_id);
      if (product) values.product_name = product.name;
      const so = deps.services ? await deps.services.findServiceOrderByOrder(order.id).catch(() => null) : null;
      if (so) Object.assign(values, { service_deliverable: so.deliverable, service_owner: so.owner, service_response_time: so.response_time, service_next_step: so.next_step ?? "" });
    }
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
    const eb = (await deps.brand?.().catch(() => null)) ?? null;
    rendered = renderTemplate(template.subject, template.body, values, { ...(eb ?? {}), supportEmail: eb?.supportEmail ?? deps.config.supportEmail });
  } catch (e) {
    return { status: "failed", kind: "permanent", detail: sanitizeError(e, 200) };
  }
  let sender;
  try {
    sender = await senderFor(deps, template.sender_id);
  } catch (e) {
    return { status: "failed", kind: "config", detail: sanitizeError(e, 240) };
  }
  const result = await deps.email.send({
    ...sender,
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

/**
 * Send document / request signature: fill the library document for the event's customer, save the fingerprinted
 * copy, and email the secure link. A retried run reuses the copy (and link) it already made.
 */
async function runDocumentStep(deps: AutomationDeps, exec: Execution, event: AutomationEvent, action: SendDocumentAction | RequestSignatureAction, index: number): Promise<ActionOutcome> {
  const docs = deps.documents;
  if (!docs) return { status: "failed", kind: "config", detail: "Document management is not set up for this account yet." };
  const kind = action.type === "request_signature" ? "signature" : "send";
  const isTest = exec.is_test;
  const testRecipient = typeof event.data.test_recipient === "string" ? event.data.test_recipient : null;
  const license = event.license_id ? await deps.commerce.getLicense(event.license_id) : null;
  const customerId = event.customer_id ?? license?.customer_id ?? null;
  const customer = !isTest && customerId ? await deps.commerce.getCustomer(customerId) : null;
  const to = isTest ? testRecipient : customer?.email ?? null;
  if (!to || !isEmailAddress(to)) return { status: "failed", kind: "permanent", detail: isTest ? "No valid test recipient." : "There is no valid email address for this customer, so nothing was sent." };
  if (!isTest && deps.config.env !== "production" && !deps.config.testRecipients.map((r) => r.toLowerCase()).includes(to.toLowerCase())) {
    return { status: "skipped", kind: "skipped", detail: `Not sent: this is a ${deps.config.env} environment, where email goes only to the addresses in AUTOMATION_TEST_RECIPIENTS.` };
  }

  const profile = await docs.repo.getProfile();
  let values: Record<string, string>;
  if (isTest) {
    values = { ...SAMPLE_FIELD_VALUES };
    // Sample answers for any {{form.<key>}} merge fields the document uses.
    const doc = await docs.repo.getDocument(action.document_id);
    const version = doc?.current_version_id ? await docs.repo.getVersion(doc.current_version_id) : null;
    for (const f of version?.merge_fields ?? []) if (f.startsWith("form.")) values[f] = `Sample ${f.slice(5).replace(/_/g, " ")}`;
  } else {
    const orderId = event.order_id ?? license?.order_id ?? null;
    const order = orderId ? await deps.commerce.getOrder(orderId) : null;
    const product = order ? await deps.commerce.getProduct(order.product_id) : null;
    const onboarding = license ? await deps.repo.getProfile(license.id).catch(() => null) : null;
    values = documentValues({ profile, customer, businessName: onboarding?.business_name ?? null, order, product, now: nowOf(deps) });
    const answers = await submissionAnswers(deps, event);
    for (const [k, v] of Object.entries(answers ?? {})) values[`form.${k}`] = v;
  }

  let sender;
  try {
    sender = await senderFor(deps, action.sender_id);
  } catch (e) {
    return { status: "failed", kind: "config", detail: sanitizeError(e, 240) };
  }
  let made;
  try {
    made = await createDelivery(docs, {
      documentId: action.document_id, kind, recipientEmail: to, recipientName: isTest ? "Test recipient" : customer?.full_name ?? null,
      customerId: isTest ? null : customerId, orderId: isTest ? null : event.order_id ?? license?.order_id ?? null,
      executionId: exec.id, actionIndex: index, isTest, values, linkDays: action.link_days,
      reminderDays: action.type === "request_signature" ? action.reminder_days : null, createdBy: null,
    });
  } catch (e) {
    if (e instanceof MissingValuesError || e instanceof ValidationError) return { status: "failed", kind: "config", detail: sanitizeError(e, 300) };
    throw e;
  }
  const origin = (await deps.config.origin()).replace(/\/$/, "");
  const firmName = profile?.display_name ?? "Your tax office";
  const email = documentEmail({
    kind, firmName, documentName: made.document.name, clientFirstName: isTest ? "there" : values.client_first_name || null,
    message: action.message, url: `${origin}${deliveryPathFor(kind, made.token)}`, expiresAt: new Date(made.delivery.expires_at),
  });
  const result = await deps.email.send({
    ...sender,
    to,
    subject: isTest ? `[TEST] ${email.subject}` : email.subject,
    html: email.html,
    text: isTest ? `*** TEST EMAIL: sample data only ***\n\n${email.text}` : email.text,
    idempotencyKey: `${exec.id}:${index}`,
  });
  if (!result.ok) return { status: "failed", kind: result.kind, detail: result.message };
  if (!isTest && !made.reused && kind === "send") {
    await emitEvent(deps, { type: "document.sent", key: `delivery:${made.delivery.id}:sent`, customerId, orderId: made.delivery.order_id, licenseId: event.license_id, data: { document_id: made.document.id } }).catch((e) => console.error(`automation: document.sent not recorded: ${sanitizeError(e, 120)}`));
  }
  const what = kind === "signature" ? "Signature request for" : "Document";
  return { status: "ok", detail: `${what} "${made.document.name}" sent to ${isTest ? "the test recipient" : "the customer"}${made.reused ? " (same copy as the earlier attempt)" : ""}.`, messageId: result.id };
}

async function runAction(deps: AutomationDeps, exec: Execution, event: AutomationEvent, action: Action, index: number): Promise<ActionOutcome> {
  if (action.type === "record_note") return { status: "ok", detail: action.note.slice(0, 300) };
  if (action.type === "send_document" || action.type === "request_signature") return runDocumentStep(deps, exec, event, action, index);
  return runSendEmail(deps, exec, event, action, index);
}

// -------------------------------------------------------------- client test

/** A test with a real client: sending steps are checked but never sent, and everything else runs. */
const isClientTest = (exec: Execution, event: AutomationEvent) => exec.is_test && event.data.test_client === true;

async function dryRunStep(deps: AutomationDeps, event: AutomationEvent, action: Action): Promise<ActionOutcome> {
  if (action.type === "record_note") return { status: "ok", detail: action.note.slice(0, 300) };
  if (action.type === "send_email") {
    const template = await deps.repo.getTemplate(action.template_id);
    if (!template) return { status: "failed", kind: "permanent", detail: "The email template for this step no longer exists. Choose another template in the workflow." };
    if (!template.active) return { status: "failed", kind: "config", detail: `The template "${template.name}" is switched off. Turn it on before this workflow can send it.` };
    const values = await contextFor(deps, event);
    // A setup link is made only for a real send; the test shows where it would go.
    if (action.include_setup_link || variablesIn(template.subject, template.body).includes("setup_link")) values.setup_link = "https://example.com/setup-link-made-when-sent";
    try {
      const eb = (await deps.brand?.().catch(() => null)) ?? null;
      const rendered = renderTemplate(template.subject, template.body, { ...SAMPLE_VALUES, ...values }, { ...(eb ?? {}), supportEmail: eb?.supportEmail ?? deps.config.supportEmail });
      const to = action.to === "support" ? "Monarch support" : (await recipientFor(deps, event, "customer")) ?? "the client (no email address on file)";
      return { status: "skipped", kind: "skipped", detail: `Skipped in test: would email "${template.name}" to ${to} with the subject "${rendered.subject}". The message filled in without problems.` };
    } catch (e) {
      return { status: "failed", kind: "permanent", detail: sanitizeError(e, 200) };
    }
  }
  const what = action.type === "request_signature" ? "request a signature on" : "send";
  const doc = deps.documents ? await deps.documents.repo.getDocument(action.document_id).catch(() => null) : null;
  if (deps.documents && !doc) return { status: "failed", kind: "permanent", detail: "The document for this step no longer exists. Choose another document in the workflow." };
  return { status: "skipped", kind: "skipped", detail: `Skipped in test: would ${what} "${doc?.name ?? "the document"}" to the client.` };
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
      outcome = isClientTest(claimed, event) ? await dryRunStep(deps, event, wf.actions[i]) : await runAction(deps, claimed, event, wf.actions[i], i);
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

/**
 * Tests a workflow end to end with a real client chosen by the administrator. Steps that would send an email or text
 * (or a document) are checked and skipped, so nothing reaches the client, and the run carries on to the next step. Every
 * step's result is recorded in the run history.
 */
export async function runClientTest(deps: AutomationDeps, workflowId: string, customerId: string, admin: { id: string; email: string }): Promise<Execution> {
  const wf = await deps.repo.getWorkflow(workflowId);
  if (!wf) throw new Error("Workflow not found.");
  const customer = await deps.commerce.getCustomer(customerId);
  if (!customer) throw new Error("Choose a client to test with.");
  const { event } = await deps.repo.insertEvent({ event_key: `client-test:${randomBytes(9).toString("base64url")}`, event_type: wf.trigger_event, license_id: null, customer_id: customer.id, order_id: null, data: { test_client: true, test_recipient: admin.email } });
  const { execution } = await deps.repo.insertExecution({ workflow_id: wf.id, event_id: event.id, is_test: true, max_attempts: 1, next_attempt_at: iso(deps) });
  await deps.repo.addAudit({ actor_id: admin.id, action: "workflow_client_test", target_type: "workflow", target_id: wf.id, detail: { customer_id: customer.id } });
  return (await processExecution(deps, execution.id)) ?? execution;
}

export { EVENTS, VARIABLES };
export type { Workflow };
