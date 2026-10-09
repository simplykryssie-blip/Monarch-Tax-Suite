import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { MemoryRepo } from "./memory-repo.ts";
import { FakeHighLevel, MemoryCrmRepo } from "./crm-memory.ts";
import { CrmSecrets } from "../lib/crm/crypto.ts";
import { completeConnection, setWebhook, startConnection, type CrmDeps } from "../lib/crm/connection.ts";
import { forwardLead, issueEmbedToken, type LeadSubmission } from "../lib/crm/leads.ts";
import type { WebhookSender } from "../lib/crm/webhook.ts";
import { mailerFromEnv, type MailMessage, type Mailer } from "../lib/crm/mailer.ts";
import { ValidationError } from "../lib/commerce/validation.ts";
import type { License } from "../lib/commerce/types.ts";

// Webhook bodies are asserted field by field.
/* eslint-disable @typescript-eslint/no-explicit-any */

// Lead delivery from the FULL calculator: the visitor's contact details and
// the calculated results reach the buyer's destination; income entries do not.

function license(): License {
  const id = randomUUID();
  return {
    id, customer_id: randomUUID(), order_id: randomUUID(), product_id: randomUUID(), key_hash: "a".repeat(64), key_prefix: "MTS-AAAAA", embed_id: `emb_${id.slice(0, 20)}`,
    original_tax_year: 2026, licensed_tax_year: 2026, status: "active", max_domains: 3, issued_at: null, activated_at: null, revoked_at: null, revoke_reason: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
}

function setup() {
  const commerce = new MemoryRepo();
  const repo = new MemoryCrmRepo();
  const api = new FakeHighLevel();
  api.addLocation("locAAAAAAAA", "Buyer A Tax Co");
  const sent: { body: Record<string, any>; key: string }[] = [];
  const webhook: WebhookSender = async (_t, body, key) => { sent.push({ body: body as Record<string, any>, key }); return { ok: true, status: 200 }; };
  const deps: CrmDeps = { repo, commerce, api, secrets: new CrmSecrets(randomBytes(32)), webhook, now: () => new Date(), sleep: async () => undefined };
  const A = license();
  commerce.licenses.push(A);
  commerce.domains.push({ id: randomUUID(), license_id: A.id, domain: "buyer-a.com", status: "active", created_at: "" });
  return { deps, repo, api, A, sent };
}

const enable = (deps: CrmDeps, licenseId: string, over = {}) =>
  deps.repo.saveLeadSettings({ license_id: licenseId, enabled: true, business_name: "Buyer A Tax Co", lead_source: "Tax Calculator", tags: ["calc-lead"], update_existing: false, include_summary: true, notification_email: null, ...over });

const INPUTS = { status: "single", wages: "65000", withholding: "8500", netProfit: "", investment: "", kids: "", tips: "", overtime: "", vehicleInterest: "", otherAdjustments: "", seniorSelf: false, seniorSpouse: false, tipsQualified: true, overtimeQualified: true, vehicleQualified: true, eicAge: "", eicUs: "", eicDependent: false, eicMfsApart: false };

const full = (deps: CrmDeps, licenseId: string, over: Partial<LeadSubmission> = {}): LeadSubmission => ({
  token: issueEmbedToken(deps, licenseId, "buyer-a.com"),
  submissionId: randomUUID(),
  firstName: "Jamie",
  lastName: "Rivera",
  email: "jamie@example.com",
  phone: "(555) 010-2030",
  consent: true,
  inputs: INPUTS,
  ...over,
});

describe("full calculator lead -> buyer's webhook", () => {
  test("delivers name, email, phone and the calculated results", async () => {
    const { deps, A, sent } = setup();
    await setWebhook(deps, A.id, "https://hooks.buyer-a.com/in");
    await enable(deps, A.id);
    const sub = full(deps, A.id);
    assert.deepEqual(await forwardLead(deps, sub, { ip: "203.0.113.5" }), { ok: true });
    assert.equal(sent.length, 1);
    const b = sent[0].body;
    assert.equal(sent[0].key, sub.submissionId);
    assert.equal(b.event, "calculator.lead");
    assert.deepEqual(b.contact, { first_name: "Jamie", last_name: "Rivera", email: "jamie@example.com", phone: "5550102030" });
    assert.equal(b.estimate.headline, "Estimated Refund: $2,880");
    assert.equal(b.estimate.result, "refund");
    assert.equal(b.estimate.amount, 2880);
    assert.equal(b.estimate.tax_year, 2026);
    assert.equal(b.estimate.filing_status_label, "Single");
    assert.equal(b.estimate.estimated_federal_tax, 5620);
    assert.equal(b.estimate.breakdown.taxable_income, 48900);
    assert.match(b.estimate.text, /Estimated Refund: \$2,880/);
    assert.match(b.estimate.text, /Self-employment tax/);
    assert.equal(b.source, "Tax Calculator");
    assert.deepEqual(b.tags, ["calc-lead"]);
    assert.equal(b.website, "buyer-a.com");
    assert.equal(b.consent.contact, true);
  });

  test("results are recomputed on the server: income entries are not forwarded and nothing is stored", async () => {
    const { deps, repo, A, sent } = setup();
    await setWebhook(deps, A.id, "https://hooks.buyer-a.com/in");
    await enable(deps, A.id);
    await forwardLead(deps, full(deps, A.id, { inputs: { ...INPUTS, wages: "91234", withholding: "7777" } }), { ip: "203.0.113.5" });
    assert.deepEqual(Object.keys(sent[0].body.estimate).sort(), ["amount", "breakdown", "currency", "estimated_federal_tax", "filing_status", "filing_status_label", "headline", "result", "tax_year", "text", "withholding_plus_refundable_credits"], "results only; the entries themselves (wages, tips, kids...) are not sent");
    assert.equal(sent[0].body.estimate.breakdown.adjusted_gross_income, 91234, "AGI is a result and is sent");
    const persisted = JSON.stringify({ c: repo.connections, s: repo.settings, l: repo.log, o: repo.states });
    for (const pii of ["Jamie", "Rivera", "jamie@example.com", "5550102030", "91234", "7777", "Estimated Refund", "Estimated Balance"]) assert.ok(!persisted.includes(pii), `${pii} not stored`);
    assert.equal(repo.log[0].outcome, "sent");
  });

  test("a tampered client cannot choose the figures: only inputs are accepted, the server computes the result", async () => {
    const { deps, A, sent } = setup();
    await setWebhook(deps, A.id, "https://hooks.buyer-a.com/in");
    await enable(deps, A.id);
    await forwardLead(deps, full(deps, A.id, { summary: { taxYear: 2026, filingStatus: "single", result: "refund", amount: 9_999_999 }, inputs: { ...INPUTS, wages: "30000", withholding: "0" } }), { ip: "203.0.113.6" });
    assert.equal(sent[0].body.estimate.result, "owed");
    assert.notEqual(sent[0].body.estimate.amount, 9_999_999);
  });

  test("rejects: no income entered, junk entries, missing consent, no email or phone", async () => {
    const { deps, A, sent } = setup();
    await setWebhook(deps, A.id, "https://hooks.buyer-a.com/in");
    await enable(deps, A.id);
    await assert.rejects(forwardLead(deps, full(deps, A.id, { inputs: { ...INPUTS, wages: "", netProfit: "" } }), { ip: "1.1.1.1" }), (e: Error) => e instanceof ValidationError && /W-2 wages/.test(e.message));
    await assert.rejects(forwardLead(deps, full(deps, A.id, { inputs: { ...INPUTS, status: "bogus" } }), { ip: "1.1.1.1" }), ValidationError);
    await assert.rejects(forwardLead(deps, full(deps, A.id, { consent: false }), { ip: "1.1.1.1" }), /agree to be contacted/);
    await assert.rejects(forwardLead(deps, full(deps, A.id, { email: "", phone: "" }), { ip: "1.1.1.1" }), /email address or phone/);
    assert.equal(sent.length, 0);
  });

  test("buyer can choose to send contact details only (summary off): no results are computed or sent", async () => {
    const { deps, A, sent } = setup();
    await setWebhook(deps, A.id, "https://hooks.buyer-a.com/in");
    await enable(deps, A.id, { include_summary: false });
    assert.deepEqual(await forwardLead(deps, full(deps, A.id), { ip: "203.0.113.7" }), { ok: true });
    assert.equal(sent[0].body.estimate, null);
    assert.equal(sent[0].body.contact.email, "jamie@example.com");
  });

  test("only the licensed host may submit; a disabled form refuses", async () => {
    const { deps, A, sent } = setup();
    await setWebhook(deps, A.id, "https://hooks.buyer-a.com/in");
    await enable(deps, A.id);
    const wrongHost = full(deps, A.id, { token: issueEmbedToken(deps, A.id, "evil.example") });
    assert.deepEqual(await forwardLead(deps, wrongHost, { ip: "2.2.2.2" }), { ok: false, reason: "unavailable", retryable: false });
    await enable(deps, A.id, { enabled: false });
    assert.deepEqual(await forwardLead(deps, full(deps, A.id), { ip: "2.2.2.2" }), { ok: false, reason: "unavailable", retryable: false });
    assert.equal(sent.length, 0);
  });

  test("a retry with the same submission id keeps the same idempotency key", async () => {
    const { deps, A, sent } = setup();
    await setWebhook(deps, A.id, "https://hooks.buyer-a.com/in");
    await enable(deps, A.id);
    const sub = full(deps, A.id);
    await forwardLead(deps, sub, { ip: "3.3.3.3" });
    await forwardLead(deps, sub, { ip: "3.3.3.3" });
    assert.equal(sent[0].key, sent[1].key);
  });

  test("GoHighLevel OAuth path: contact note carries the full results", async () => {
    const { deps, api, A } = setup();
    const state = await startConnection(deps, A.id);
    await completeConnection(deps, { state, code: api.issueCode("locAAAAAAAA"), redirectUri: "https://monarch.test/api/integrations/crm/callback" });
    await enable(deps, A.id);
    assert.deepEqual(await forwardLead(deps, full(deps, A.id), { ip: "4.4.4.4" }), { ok: true });
    assert.equal(api.contacts.length, 1);
    assert.match(api.contacts[0].notes[0], /Estimated Refund: \$2,880/);
    assert.match(api.contacts[0].notes[0], /Taxable income \(estimate\): \$48,900/);
  });
});

describe("notification email (optional copy to the license holder)", () => {
  function withMailer(result: "ok" | "fail" = "ok") {
    const ctx = setup();
    const mails: MailMessage[] = [];
    const mailer: Mailer = async (m) => { mails.push(m); return result === "ok" ? { ok: true } : { ok: false, reason: "http_422" }; };
    ctx.deps.mailer = mailer;
    return { ...ctx, mails };
  }

  test("emails the configured address with contact details and results, after the CRM delivery", async () => {
    const { deps, A, sent, mails } = withMailer();
    await setWebhook(deps, A.id, "https://hooks.buyer-a.com/in");
    await enable(deps, A.id, { notification_email: "owner@buyer-a.com" });
    assert.deepEqual(await forwardLead(deps, full(deps, A.id), { ip: "5.5.5.5" }), { ok: true });
    assert.equal(sent.length, 1);
    assert.equal(mails.length, 1);
    const m = mails[0];
    assert.equal(m.to, "owner@buyer-a.com");
    assert.equal(m.replyTo, "jamie@example.com");
    assert.equal(m.subject, "New tax calculator lead: Jamie Rivera");
    assert.match(m.text, /Name: Jamie Rivera/);
    assert.match(m.text, /Phone: 5550102030/);
    assert.match(m.text, /Estimated Refund: \$2,880/);
    assert.match(m.text, /Taxable income \(estimate\): \$48,900/);
    assert.ok(!/wages|withheld/i.test(m.text.replace("Withholding + refundable credits", "")), "income entries are not in the email");
  });

  test("no email when no address is set, when the provider is not configured, or when the CRM delivery failed", async () => {
    const a = withMailer();
    await setWebhook(a.deps, a.A.id, "https://hooks.buyer-a.com/in");
    await enable(a.deps, a.A.id);
    await forwardLead(a.deps, full(a.deps, a.A.id), { ip: "6.6.6.6" });
    assert.equal(a.mails.length, 0, "no address saved");

    const b = setup();
    await setWebhook(b.deps, b.A.id, "https://hooks.buyer-a.com/in");
    await enable(b.deps, b.A.id, { notification_email: "owner@buyer-a.com" });
    assert.deepEqual(await forwardLead(b.deps, full(b.deps, b.A.id), { ip: "6.6.6.7" }), { ok: true }, "lead still delivered without a mailer");

    const c = withMailer();
    c.deps.webhook = async () => ({ ok: false, status: 503, reason: "http_error" });
    await setWebhook(c.deps, c.A.id, "https://hooks.buyer-a.com/in");
    await enable(c.deps, c.A.id, { notification_email: "owner@buyer-a.com" });
    const r = await forwardLead(c.deps, full(c.deps, c.A.id), { ip: "6.6.6.8" });
    assert.equal(r.ok, false);
    assert.equal(c.mails.length, 0, "no email for an undelivered lead");
  });

  test("a failing email provider never fails the lead; the problem is recorded without personal data", async () => {
    const { deps, repo, A, sent, mails } = withMailer("fail");
    await setWebhook(deps, A.id, "https://hooks.buyer-a.com/in");
    await enable(deps, A.id, { notification_email: "owner@buyer-a.com" });
    assert.deepEqual(await forwardLead(deps, full(deps, A.id), { ip: "7.7.7.7" }), { ok: true });
    assert.equal(sent.length, 1);
    assert.equal(mails.length, 1);
    const err = repo.connections[0].last_error ?? "";
    assert.match(err, /Notification email failed \(http_422\)/);
    for (const pii of ["Jamie", "Rivera", "jamie@example.com", "owner@buyer-a.com"]) assert.ok(!err.includes(pii));
  });

  test("header-injection attempts in the visitor's name cannot reach the subject", async () => {
    const { deps, A, mails } = withMailer();
    await setWebhook(deps, A.id, "https://hooks.buyer-a.com/in");
    await enable(deps, A.id, { notification_email: "owner@buyer-a.com" });
    await forwardLead(deps, full(deps, A.id, { firstName: "Eve\r\nBcc: attacker@evil.test", lastName: "X\nSubject: spoof" }), { ip: "8.8.8.8" });
    assert.ok(!/[\r\n]/.test(mails[0].subject));
    assert.equal(mails[0].to, "owner@buyer-a.com");
  });

  test("mailerFromEnv: needs both a key and a well-formed sender; secrets are never required in the browser", () => {
    assert.equal(mailerFromEnv({}), null);
    assert.equal(mailerFromEnv({ RESEND_API_KEY: "re_x" }), null);
    assert.equal(mailerFromEnv({ RESEND_API_KEY: "re_x", LEAD_NOTIFY_FROM: "not an address" }), null);
    assert.equal(typeof mailerFromEnv({ RESEND_API_KEY: "re_x", LEAD_NOTIFY_FROM: "Leads <leads@monarchtaxsuite.com>" }), "function");
  });
});
