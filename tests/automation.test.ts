import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { MemoryRepo } from "./memory-repo.ts";
import { MemoryAutomationRepo } from "./automation-memory.ts";
import { createProduct } from "../lib/commerce/catalog.ts";
import { createInternalLicense, handleStripeEvent, type FulfillmentDeps } from "../lib/commerce/fulfillment.ts";
import { CrmSecrets } from "../lib/crm/crypto.ts";
import { createSetupLink, emitEvent, processExecution, retryExecution, runDue, runTest, BACKOFF_SECONDS, type AutomationDeps } from "../lib/automation/engine.ts";
import { installDefaults } from "../lib/automation/defaults.ts";
import { openSetupLink, resolveSetupSession } from "../lib/automation/onboarding.ts";
import { createTemplate, duplicateWorkflow, removeWorkflow, sendTemplateTest, setTemplateActive, setWorkflowStatus, workflowsUsing } from "../lib/automation/admin.ts";
import { emailConfig, emailConfigProblems, type EmailMessage, type EmailSender, type SendResult } from "../lib/automation/email.ts";
import { sanitizeError } from "../lib/automation/sanitize.ts";
import { renderTemplate, SAMPLE_VALUES } from "../lib/automation/template.ts";
import { validateTemplateInput, validateWorkflowInput } from "../lib/automation/validate.ts";
import { ValidationError } from "../lib/commerce/validation.ts";
import type { NewProduct } from "../lib/commerce/types.ts";

const ADMIN = { id: "00000000-0000-4000-8000-000000000001", email: "admin@monarch.test" };
const CALCULATOR: NewProduct = {
  slug: "monarch-basic-tax-calculator", name: "Monarch Basic Tax Calculator", description: "Estimator.", product_type: "software", access_type: "license",
  installation_options: ["self_service", "done_for_you"], price_cents: 7500, currency: "usd", stripe_product_id: "prod_TESTCALC123", stripe_price_id: null, status: "draft",
};

class FakeEmail implements EmailSender {
  sent: EmailMessage[] = [];
  queue: SendResult[] = [];
  async send(m: EmailMessage): Promise<SendResult> {
    const next = this.queue.shift();
    if (next) { if (next.ok) this.sent.push(m); return next; }
    this.sent.push(m);
    return { ok: true, id: `msg_${this.sent.length}` };
  }
}

async function setup(env: "production" | "preview" = "production", testRecipients: string[] = []) {
  const commerce = new MemoryRepo();
  const product = await createProduct(commerce, CALCULATOR);
  const repo = new MemoryAutomationRepo();
  const email = new FakeEmail();
  let clock = Date.parse("2026-10-10T12:00:00Z");
  const deps: AutomationDeps = {
    repo, commerce, crm: null, email,
    config: { origin: () => "https://app.test", supportEmail: "support@monarch.test", supportRecipient: "support@monarch.test", env, testRecipients },
    now: () => new Date(clock),
  };
  await installDefaults(repo, null);
  return { commerce, product, repo, email, deps, advance: (ms: number) => { clock += ms; } };
}

async function manualLicense(commerce: MemoryRepo, productId: string, emailAddr = "Owner@Example.com") {
  return createInternalLicense(commerce, { email: emailAddr, full_name: "Test Owner", phone: null, product_id: productId, platform: "gohighlevel", website_url: null, domain: "example.com", reason: "Own account", admin_id: ADMIN.id, confirmed: true });
}

const workflowByKey = async (repo: MemoryAutomationRepo, key: string) => (await repo.findWorkflowByKey(key))!;

describe("manual license onboarding", () => {
  test("a manual license sends one onboarding email with a secure setup link, once", async () => {
    const { commerce, product, deps, email, repo } = await setup();
    const r = await manualLicense(commerce, product.id);
    const input = { type: "license.manual_created", key: `license:${r.license!.id}:manual_created`, licenseId: r.license!.id, customerId: r.customer.id, orderId: r.order.id, data: { origin: "internal" } };
    const first = await emitEvent(deps, input);
    assert.equal(first.duplicate, false);
    assert.equal(email.sent.length, 1);
    assert.equal(email.sent[0].to, "owner@example.com");
    assert.match(email.sent[0].text, /https:\/\/app\.test\/setup\?t=[A-Za-z0-9_-]{40,}/);
    assert.equal((await emitEvent(deps, input)).duplicate, true, "same event key is idempotent");
    assert.equal(email.sent.length, 1);
    assert.equal(repo.links.length, 1);
    assert.equal(repo.executions[0].status, "succeeded");
    assert.ok(repo.executions[0].provider_message_id);
  });

  test("only a hash of the token is stored, and the link opens a session for exactly that license", async () => {
    const { commerce, product, deps, repo } = await setup();
    const r = await manualLicense(commerce, product.id);
    const secrets = CrmSecrets.fromBase64(randomBytes(32).toString("base64"))!;
    const { token, link } = await createSetupLink(deps, r.license!.id, ADMIN.id);
    assert.notEqual(link.token_hash, token);
    assert.match(link.token_hash, /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(repo.links).includes(token));
    const d = { repo, commerce, secrets, now: deps.now };
    const opened = await openSetupLink(d, token);
    assert.ok(opened.ok);
    if (!opened.ok) return;
    assert.equal(opened.firstOpen, true);
    assert.equal((await resolveSetupSession(d, opened.session))?.licenseId, r.license!.id);
    assert.equal((await openSetupLink(d, token) as { firstOpen: boolean }).firstOpen, false);
    assert.equal(await resolveSetupSession(d, "garbage"), null);
  });

  test("expired and revoked links are refused, and revoking ends existing sessions", async () => {
    const { commerce, product, deps, repo, advance } = await setup();
    const r = await manualLicense(commerce, product.id);
    const secrets = CrmSecrets.fromBase64(randomBytes(32).toString("base64"))!;
    const d = { repo, commerce, secrets, now: deps.now };
    const a = await createSetupLink(deps, r.license!.id, null);
    const opened = await openSetupLink(d, a.token);
    assert.ok(opened.ok);
    await repo.revokeLink(a.link.id, new Date().toISOString());
    assert.deepEqual(await openSetupLink(d, a.token), { ok: false, reason: "revoked" });
    if (opened.ok) assert.equal(await resolveSetupSession(d, opened.session), null);
    const b = await createSetupLink(deps, r.license!.id, null);
    advance(15 * 86_400_000);
    assert.deepEqual(await openSetupLink(d, b.token), { ok: false, reason: "expired" });
    assert.deepEqual(await openSetupLink(d, "short"), { ok: false, reason: "invalid" });
  });

  test("a new setup email retires the earlier link only after the email was sent", async () => {
    const { commerce, product, deps, repo, email } = await setup();
    const r = await manualLicense(commerce, product.id);
    const ev = (n: number) => ({ type: "license.manual_created", key: `k${n}`, licenseId: r.license!.id, data: { origin: "internal" } });
    await emitEvent(deps, ev(1));
    const first = repo.links[0];
    email.queue.push({ ok: false, kind: "permanent", message: "rejected" });
    await emitEvent(deps, ev(2));
    assert.equal(repo.links.find((l) => l.id === first.id)!.revoked_at, null, "a failed send leaves the earlier link usable");
    await emitEvent(deps, ev(3));
    assert.equal(repo.links.filter((l) => !l.revoked_at).length, 1, "after a successful send only the newest link is live");
  });
});

describe("paid license from a verified Stripe event", () => {
  test("is emitted once per order even when Stripe redelivers", async () => {
    const { commerce, deps, repo, email } = await setup();
    const fulfil: FulfillmentDeps = { repo: commerce, listCheckoutProductIds: async () => ["prod_TESTCALC123"], emit: (e) => emitEvent(deps, e).then(() => undefined) };
    const evt = (id: string, type = "checkout.session.completed") => ({
      id, type, data: { object: { id: "cs_1", payment_status: "paid", payment_intent: "pi_1", amount_total: 7500, currency: "usd", customer: "cus_1", customer_details: { email: "buyer@example.com", name: "Buyer One" }, metadata: { installation_type: "self_service" } } },
    });
    await handleStripeEvent(fulfil, evt("evt_1"));
    await handleStripeEvent(fulfil, evt("evt_1"));
    await handleStripeEvent(fulfil, evt("evt_2", "checkout.session.async_payment_succeeded"));
    assert.equal(commerce.licenses.length, 1);
    assert.equal(repo.events.filter((e) => e.event_type === "license.paid_created").length, 1);
    assert.equal(email.sent.length, 1);
    assert.equal(email.sent[0].to, "buyer@example.com");
  });

  test("an unpaid checkout never emits", async () => {
    const { commerce, deps, repo } = await setup();
    const fulfil: FulfillmentDeps = { repo: commerce, listCheckoutProductIds: async () => ["prod_TESTCALC123"], emit: (e) => emitEvent(deps, e).then(() => undefined) };
    await handleStripeEvent(fulfil, { id: "evt_u", type: "checkout.session.completed", data: { object: { id: "cs_u", payment_status: "unpaid", payment_intent: "pi_u", amount_total: 7500, currency: "usd", customer_details: { email: "x@example.com", name: "X" }, metadata: {} } } });
    assert.equal(repo.events.length, 0);
  });

  test("a failing emit never fails the payment", async () => {
    const { commerce } = await setup();
    const fulfil: FulfillmentDeps = { repo: commerce, listCheckoutProductIds: async () => ["prod_TESTCALC123"], emit: async () => { throw new Error("automation down"); } };
    const out = await handleStripeEvent(fulfil, { id: "evt_f", type: "checkout.session.completed", data: { object: { id: "cs_f", payment_status: "paid", payment_intent: "pi_f", amount_total: 7500, currency: "usd", customer_details: { email: "f@example.com", name: "F" }, metadata: {} } } });
    assert.equal(out.status, "processed");
    assert.equal(commerce.licenses.length, 1);
  });
});

describe("retries and failure handling", () => {
  test("a transient email failure retries with backoff, then succeeds without duplicating work", async () => {
    const { commerce, product, deps, repo, email, advance } = await setup();
    const r = await manualLicense(commerce, product.id);
    email.queue.push({ ok: false, kind: "transient", message: "Resend is busy" });
    await emitEvent(deps, { type: "license.manual_created", key: "t1", licenseId: r.license!.id, data: { origin: "internal" } });
    let x = repo.executions[0];
    assert.equal(x.status, "retrying");
    assert.equal(x.attempts, 1);
    assert.equal(Date.parse(x.next_attempt_at!) - Date.parse(deps.now!().toISOString()), BACKOFF_SECONDS[0] * 1000);
    assert.equal((await runDue(deps)).processed, 0, "not due yet");
    advance(61_000);
    assert.equal((await runDue(deps)).processed, 1);
    x = repo.executions[0];
    assert.equal(x.status, "succeeded");
    assert.equal(email.sent.length, 1);
  });

  test("attempts are bounded; the final failure is recorded and can be retried by an administrator", async () => {
    const { commerce, product, deps, repo, email, advance } = await setup();
    const wf = await workflowByKey(repo, "manual_license_created");
    await repo.updateWorkflow(wf.id, { max_attempts: 2 });
    const r = await manualLicense(commerce, product.id);
    for (let i = 0; i < 3; i++) email.queue.push({ ok: false, kind: "transient", message: "down" });
    await emitEvent(deps, { type: "license.manual_created", key: "b1", licenseId: r.license!.id, data: { origin: "internal" } });
    advance(61_000);
    await runDue(deps);
    const x = repo.executions[0];
    assert.equal(x.status, "failed");
    assert.equal(x.attempts, 2);
    assert.equal(x.next_attempt_at, null);
    advance(10 * 86_400_000);
    assert.equal((await runDue(deps)).processed, 0, "no further automatic attempts");
    const retried = await retryExecution(deps, x.id, ADMIN.id);
    assert.equal(retried.status, "retrying", "a manual retry starts a fresh attempt budget");
    advance(61_000);
    await runDue(deps);
    assert.equal((await repo.getExecution(x.id))!.status, "succeeded");
    assert.ok(repo.audit.some((a) => a.action === "execution_retried"));
  });

  test("a configuration error fails immediately with a plain message and no retries", async () => {
    const { commerce, product, deps, repo, email } = await setup();
    const r = await manualLicense(commerce, product.id);
    email.queue.push({ ok: false, kind: "config", message: "Email is not configured: RESEND_API_KEY is missing." });
    await emitEvent(deps, { type: "license.manual_created", key: "c1", licenseId: r.license!.id, data: { origin: "internal" } });
    const x = repo.executions[0];
    assert.equal(x.status, "failed");
    assert.equal(x.error_kind, "config");
    assert.equal(x.attempts, 1);
  });

  test("a claimed execution cannot be processed twice at once", async () => {
    const { commerce, product, deps, repo } = await setup();
    const r = await manualLicense(commerce, product.id);
    await emitEvent(deps, { type: "license.manual_created", key: "d1", licenseId: r.license!.id, data: { origin: "internal" } });
    assert.equal(await processExecution(deps, repo.executions[0].id), null, "already finished, not claimable");
  });

  test("errors stored for display never contain keys, tokens or license keys", () => {
    const s = sanitizeError("failed re_AbCdEf123456789 with Bearer abcdefghijklmnop sk_live_abcdefghijkl and MTS-ABCDE-FGHIJ-KLMNO-PQRST at /setup?t=secrettoken123");
    assert.ok(!/re_AbCdEf|abcdefghijklmnop|sk_live_|MTS-ABCDE|secrettoken/.test(s), s);
  });
});

describe("workflow rules", () => {
  test("paused workflows do not start; conditions filter; cooldown prevents repeats", async () => {
    const { commerce, product, deps, repo, email } = await setup();
    const r = await manualLicense(commerce, product.id);
    const wf = await workflowByKey(repo, "manual_license_created");
    await repo.updateWorkflow(wf.id, { status: "paused" });
    await emitEvent(deps, { type: "license.manual_created", key: "p1", licenseId: r.license!.id, data: { origin: "internal" } });
    assert.equal(repo.executions.length, 0);
    await repo.updateWorkflow(wf.id, { status: "active", conditions: [{ field: "origin", op: "eq", value: "reconciled" }] });
    await emitEvent(deps, { type: "license.manual_created", key: "p2", licenseId: r.license!.id, data: { origin: "internal" } });
    assert.equal(repo.executions.length, 0, "condition does not match");
    await repo.updateWorkflow(wf.id, { conditions: [], cooldown_hours: 24 });
    await emitEvent(deps, { type: "license.manual_created", key: "p3", licenseId: r.license!.id, data: { origin: "internal" } });
    await emitEvent(deps, { type: "license.manual_created", key: "p4", licenseId: r.license!.id, data: { origin: "internal" } });
    assert.equal(email.sent.length, 1);
    assert.equal(repo.executions.filter((x) => x.status === "skipped").length, 1);
  });

  test("onboarding started records progress without emailing", async () => {
    const { commerce, product, deps, repo, email } = await setup();
    const r = await manualLicense(commerce, product.id);
    await emitEvent(deps, { type: "onboarding.started", key: "o1", licenseId: r.license!.id });
    assert.equal(email.sent.length, 0);
    assert.equal(repo.executions[0].status, "succeeded");
    assert.equal(repo.executions[0].action_log[0].type, "record_note");
  });

  test("CRM connected, installation and lead events each trigger only their own workflow", async () => {
    const { commerce, product, deps, repo, email } = await setup();
    const r = await manualLicense(commerce, product.id);
    await emitEvent(deps, { type: "crm.connected", key: "m1", licenseId: r.license!.id, data: { provider: "highlevel" } });
    assert.equal(email.sent.length, 1);
    await emitEvent(deps, { type: "crm.connected", key: "m2", licenseId: r.license!.id, data: { provider: "webhook" } });
    assert.equal(email.sent.length, 1, "the confirmation is for GoHighLevel only");
    await emitEvent(deps, { type: "installation.recorded", key: "m3", licenseId: r.license!.id });
    assert.equal(email.sent.length, 2);
    await emitEvent(deps, { type: "lead.delivered", key: "m4", licenseId: r.license!.id, data: { provider: "highlevel" } });
    assert.equal(email.sent.length, 2, "delivered leads record, never email");
    const joined = JSON.stringify(repo.events);
    assert.ok(!/@example\.com/.test(joined), "no customer or lead email addresses in events");
  });

  test("failed lead delivery emails only for auth failures, at most once a day", async () => {
    const { commerce, product, deps, repo, email, advance } = await setup();
    const r = await manualLicense(commerce, product.id);
    await setWorkflowStatus(repo, ADMIN, (await workflowByKey(repo, "lead_delivery_failed")).id, "active");
    const fail = (key: string, kind: string) => emitEvent(deps, { type: "lead.delivery_failed", key, licenseId: r.license!.id, data: { provider: "highlevel", error_kind: kind } });
    await fail("l1", "transient");
    assert.equal(email.sent.length, 0);
    await fail("l2", "auth");
    await fail("l3", "auth");
    assert.equal(email.sent.length, 1);
    advance(25 * 3_600_000);
    await fail("l4", "auth");
    assert.equal(email.sent.length, 2);
    assert.ok(repo.events.every((e) => !("lead" in e.data)));
  });

  test("suspension and revocation notices are available but off until turned on", async () => {
    const { commerce, product, deps, email } = await setup();
    const r = await manualLicense(commerce, product.id);
    await emitEvent(deps, { type: "license.suspended", key: "s1", licenseId: r.license!.id });
    assert.equal(email.sent.length, 0);
  });
});

describe("test mode and safe tests", () => {
  test("outside production, real customers are never emailed unless allow-listed", async () => {
    const { commerce, product, deps, repo, email } = await setup("preview");
    const r = await manualLicense(commerce, product.id, "stranger@example.com");
    await emitEvent(deps, { type: "license.manual_created", key: "e1", licenseId: r.license!.id, data: { origin: "internal" } });
    assert.equal(email.sent.length, 0);
    assert.equal(repo.executions[0].status, "succeeded");
    assert.equal(repo.executions[0].action_log[0].status, "skipped");
    assert.match(repo.executions[0].action_log[0].detail, /AUTOMATION_TEST_RECIPIENTS/);
    const allowed = await setup("preview", ["owner@example.com"]);
    const r2 = await manualLicense(allowed.commerce, allowed.product.id);
    await emitEvent(allowed.deps, { type: "license.manual_created", key: "e2", licenseId: r2.license!.id, data: { origin: "internal" } });
    assert.equal(allowed.email.sent.length, 1);
  });

  test("a workflow test uses sample data, goes only to the administrator, and creates no link", async () => {
    const { deps, repo, email } = await setup();
    const wf = await workflowByKey(repo, "manual_license_created");
    const x = await runTest(deps, wf.id, ADMIN);
    assert.equal(x.status, "succeeded");
    assert.equal(x.is_test, true);
    assert.equal(email.sent.length, 1);
    assert.equal(email.sent[0].to, ADMIN.email);
    assert.match(email.sent[0].subject, /^\[TEST\]/);
    assert.equal(repo.links.length, 0);
    await runTest(deps, wf.id, ADMIN);
    assert.equal(email.sent.length, 2, "tests are repeatable");
  });
});

describe("templates", () => {
  test("variables are validated and escaped; unknown placeholders are rejected", () => {
    assert.throws(() => validateTemplateInput({ name: "Bad", subject: "Hi {{nope}}", body: "x" }), ValidationError);
    const out = renderTemplate("Hello {{customer_first_name}}", "Hi {{customer_name}}", { ...SAMPLE_VALUES, customer_name: '<script>alert("x")</script>', customer_first_name: "A&B" }, { supportEmail: "s@x.test" });
    assert.ok(!out.html.includes("<script>"));
    assert.match(out.html, /&lt;script&gt;/);
    assert.ok(!out.subject.includes("<"));
  });

  test("a template in use by an active workflow is listed, and a workflow cannot be turned on with a switched-off template", async () => {
    const { repo } = await setup();
    const tpl = (await repo.findTemplateByKey("onboarding_welcome"))!;
    const wf = await workflowByKey(repo, "manual_license_created");
    assert.ok(workflowsUsing(tpl.id, await repo.listWorkflows()).some((w) => w.id === wf.id));
    await repo.updateWorkflow(wf.id, { status: "paused" });
    await setTemplateActive(repo, ADMIN, tpl.id, false);
    await assert.rejects(setWorkflowStatus(repo, ADMIN, wf.id, "active"), /switched off/);
  });

  test("template test sends to the admin only, is rate limited, and is audited", async () => {
    const { repo, email } = await setup();
    const t = await createTemplate(repo, ADMIN, { name: "Mine", subject: "Hi {{customer_first_name}}", body: "Hello {{customer_name}}" });
    await sendTemplateTest(repo, email, "support@monarch.test", ADMIN, t.id);
    assert.equal(email.sent[0].to, ADMIN.email);
    assert.match(email.sent[0].text, /TEST EMAIL/);
    for (let i = 0; i < 9; i++) await sendTemplateTest(repo, email, "support@monarch.test", ADMIN, t.id);
    await assert.rejects(sendTemplateTest(repo, email, "support@monarch.test", ADMIN, t.id), /Too many/);
  });
});

describe("workflow management", () => {
  test("duplicate is paused; delete needs the exact name; workflows with history are archived, never deleted", async () => {
    const { commerce, product, deps, repo } = await setup();
    const wf = await workflowByKey(repo, "manual_license_created");
    const copy = await duplicateWorkflow(repo, ADMIN, wf.id);
    assert.equal(copy.status, "paused");
    await assert.rejects(removeWorkflow(repo, ADMIN, copy.id, "wrong"), ValidationError);
    assert.equal(await removeWorkflow(repo, ADMIN, copy.id, copy.name), "deleted");
    const r = await manualLicense(commerce, product.id);
    await emitEvent(deps, { type: "license.manual_created", key: "h1", licenseId: r.license!.id, data: { origin: "internal" } });
    assert.equal(await removeWorkflow(repo, ADMIN, wf.id, wf.name), "archived");
    assert.ok(await repo.getWorkflow(wf.id), "history is kept");
    assert.ok(repo.executions.length > 0);
  });

  test("workflow input is validated server-side", async () => {
    const { repo } = await setup();
    const templates = await repo.listTemplates();
    const base = { name: "X1", trigger_event: "crm.connected", conditions: [], actions: [{ type: "send_email", template_id: templates[0].id }] };
    assert.ok(validateWorkflowInput(base, templates));
    assert.throws(() => validateWorkflowInput({ ...base, trigger_event: "bogus" }, templates), ValidationError);
    assert.throws(() => validateWorkflowInput({ ...base, actions: [] }, templates), ValidationError);
    assert.throws(() => validateWorkflowInput({ ...base, actions: [{ type: "send_email", template_id: "nope" }] }, templates), ValidationError);
    assert.throws(() => validateWorkflowInput({ ...base, conditions: [{ field: "origin", op: "eq", value: "x" }] }, templates), ValidationError);
    assert.throws(() => validateWorkflowInput({ ...base, max_attempts: 99 }, templates), ValidationError);
  });

  test("installing the standard set twice changes nothing and leaves everything the owner edits alone", async () => {
    const { repo } = await setup();
    const before = (await repo.listWorkflows()).length;
    const wf = await workflowByKey(repo, "crm_connected");
    await repo.updateWorkflow(wf.id, { name: "Renamed by owner" });
    assert.deepEqual(await installDefaults(repo, ADMIN.id), { templates: 0, workflows: 0 });
    assert.equal((await repo.listWorkflows()).length, before);
    assert.equal((await workflowByKey(repo, "crm_connected")).name, "Renamed by owner");
  });
});

describe("email provider configuration", () => {
  test("reports missing key and sender in plain words and never echoes the key", () => {
    const none = emailConfig({});
    assert.ok(emailConfigProblems(none).length >= 1);
    const set = emailConfig({ RESEND_API_KEY: "re_supersecretvalue123", MONARCH_EMAIL_FROM: "Monarch <hello@mail.example.com>" });
    assert.deepEqual(emailConfigProblems(set), []);
    assert.ok(!JSON.stringify(emailConfigProblems(set)).includes("supersecret"));
  });
});
