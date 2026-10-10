import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { MemoryRepo } from "./memory-repo.ts";
import { MemoryAutomationRepo } from "./automation-memory.ts";
import { createProduct } from "../lib/commerce/catalog.ts";
import { createInternalLicense, issueLicenseKey } from "../lib/commerce/fulfillment.ts";
import { emitEvent, runDue, type AutomationDeps } from "../lib/automation/engine.ts";
import { installDefaults } from "../lib/automation/defaults.ts";
import { requestInvite, requestInviteByEmail } from "../lib/automation/invites.ts";
import { completeOnboarding, deriveProgress, inviteFacts, stepsFor, validateProfileInput, type ConnectionFacts } from "../lib/automation/progress.ts";
import { activateDomain, previewActivation } from "../lib/crm/setup.ts";
import { ValidationError } from "../lib/commerce/validation.ts";
import type { EmailMessage, EmailSender, SendResult } from "../lib/automation/email.ts";
import type { NewProduct } from "../lib/commerce/types.ts";

const ADMIN = "00000000-0000-4000-8000-000000000001";
const CALC: NewProduct = { slug: "monarch-basic-tax-calculator", name: "Monarch Basic Tax Calculator", description: "x", product_type: "software", access_type: "license", installation_options: ["self_service", "done_for_you"], price_cents: 7500, currency: "usd", stripe_product_id: "prod_TESTCALC123", stripe_price_id: null, status: "draft" };

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

async function setup() {
  const commerce = new MemoryRepo();
  const product = await createProduct(commerce, CALC);
  const repo = new MemoryAutomationRepo();
  const email = new FakeEmail();
  let clock = Date.parse("2026-10-10T12:00:00Z");
  const deps: AutomationDeps = { repo, commerce, crm: null, email, config: { origin: () => "https://app.test", supportEmail: "support@monarch.test", supportRecipient: "support@monarch.test", env: "production", testRecipients: [] }, now: () => new Date(clock) };
  await installDefaults(repo, null);
  const advance = (ms: number) => { clock += ms; };
  const license = async (addr = "owner@example.com") => {
    const r = await createInternalLicense(commerce, { email: addr, full_name: "Pat Owner", phone: null, product_id: product.id, platform: "gohighlevel", website_url: null, domain: "hint.example.com", reason: "own", admin_id: ADMIN, confirmed: true });
    await issueLicenseKey(commerce, r.license!.id, ADMIN);
    await emitEvent(deps, { type: "license.manual_created", key: `license:${r.license!.id}:manual_created`, licenseId: r.license!.id, customerId: r.customer.id, orderId: r.order.id, data: { origin: "internal" } });
    return r;
  };
  return { commerce, repo, email, deps, advance, license };
}
const facts = async (s: Awaited<ReturnType<typeof setup>>, licenseId: string) => {
  const events = await s.repo.listEventsByLicense(licenseId, 40);
  return inviteFacts(events, await s.repo.listExecutionsForEvents(events.map((e) => e.id)), await s.repo.listLinksForLicense(licenseId, 10), s.deps.now!().getTime());
};
const good: ConnectionFacts = { provider: "webhook", status: "connected", last_checked_at: "2026-10-10T12:00:00Z", last_error: null };

describe("setup email lifecycle", () => {
  test("a manual license produces exactly one invitation, recorded with the provider id", async () => {
    const s = await setup();
    const r = await s.license();
    assert.equal(s.email.sent.length, 1);
    assert.equal(s.commerce.licenses.length, 1);
    const f = await facts(s, r.license!.id);
    assert.equal(f.status, "sent");
    assert.equal(f.messageId, "msg_1");
    assert.equal(f.linkState, "active");
  });

  test("a failed email leaves the one license intact, is shown as failed, and a resend fixes it without a second license", async () => {
    const s = await setup();
    s.email.queue.push({ ok: false, kind: "config", message: "Sender domain is not verified in Resend." });
    const r = await s.license();
    assert.equal(s.commerce.licenses.length, 1);
    assert.equal(s.commerce.licenses[0].status, "active");
    const failed = await facts(s, r.license!.id);
    assert.equal(failed.status, "failed");
    assert.match(failed.error!, /not verified/);
    const p = deriveProgress({ license: s.commerce.licenses[0], profile: null, domains: [], connection: null, invite: failed });
    assert.equal(p.status, "needs_attention");
    assert.equal((await requestInvite(s.deps, r.license!.id, { adminId: ADMIN })).sent, true);
    assert.equal(s.commerce.licenses.length, 1);
    assert.equal((await facts(s, r.license!.id)).status, "sent");
    assert.equal(s.email.sent.length, 1);
  });

  test("resends are limited per license per hour and refused for revoked licenses", async () => {
    const s = await setup();
    const r = await s.license();
    for (let i = 0; i < 3; i++) { s.advance(1000); assert.equal((await requestInvite(s.deps, r.license!.id, { adminId: ADMIN })).sent, true); }
    s.advance(1000);
    assert.deepEqual(await requestInvite(s.deps, r.license!.id, { adminId: ADMIN }), { sent: false, reason: "throttled" });
    await s.commerce.updateLicense(r.license!.id, { status: "revoked" });
    s.advance(1000);
    await assert.rejects(requestInvite(s.deps, r.license!.id, { adminId: ADMIN }), ValidationError);
  });

  test("the customer's 'new link' form sends only to the licensed address and reveals nothing about unknown ones", async () => {
    const s = await setup();
    await s.license("owner@example.com");
    const before = s.email.sent.length;
    await requestInviteByEmail(s.deps, "stranger@nowhere.test");
    await requestInviteByEmail(s.deps, "not an email");
    assert.equal(s.email.sent.length, before);
    s.advance(1000);
    await requestInviteByEmail(s.deps, "OWNER@example.com");
    assert.equal(s.email.sent.length, before + 1);
    assert.equal(s.email.sent.at(-1)!.to, "owner@example.com");
  });

  test("a retried workflow run does not duplicate the license or resend a delivered email", async () => {
    const s = await setup();
    const r = await s.license();
    const again = await emitEvent(s.deps, { type: "license.manual_created", key: `license:${r.license!.id}:manual_created`, licenseId: r.license!.id, data: { origin: "internal" } });
    assert.equal(again.duplicate, true);
    await runDue(s.deps);
    assert.equal(s.email.sent.length, 1);
    assert.equal(s.commerce.licenses.length, 1);
  });
});

describe("customer-entered domain", () => {
  test("the customer's own domain is normalized and authorized against their license only", async () => {
    const s = await setup();
    const a = await s.license("a@example.com");
    const b = await s.license("b@example.com");
    const done = await activateDomain(s.commerce, a.license!.id, "https://WWW.Customer-Site.com/page?x=1");
    assert.equal(done.domain, "customer-site.com");
    assert.deepEqual((await s.commerce.listDomains(a.license!.id)).map((d) => d.domain), ["customer-site.com"]);
    assert.equal((await s.commerce.listDomains(b.license!.id)).length, 0);
  });

  test("malformed, shared-host and conflicting domains are refused; the license limit holds; repeats do not duplicate", async () => {
    const s = await setup();
    const a = await s.license("a@example.com");
    const b = await s.license("b@example.com");
    for (const bad of ["", "javascript:alert(1)", "not a domain", "localhost", "foo.vercel.app", "ftp://x.com"]) {
      await assert.rejects(previewActivation(s.commerce, a.license!.id, bad), ValidationError, bad);
    }
    await activateDomain(s.commerce, a.license!.id, "taken.com");
    await assert.rejects(activateDomain(s.commerce, b.license!.id, "www.taken.com"), /already registered to another/);
    assert.equal((await s.commerce.listDomains(b.license!.id)).length, 0);
    await assert.rejects(activateDomain(s.commerce, a.license!.id, "second.com"), /already activated/);
    await activateDomain(s.commerce, a.license!.id, "taken.com");
    assert.equal((await s.commerce.listDomains(a.license!.id)).length, 1);
  });

  test("a pending (not yet active) license cannot authorize anything", async () => {
    const s = await setup();
    const r = await createInternalLicense(s.commerce, { email: "p@example.com", full_name: "P", phone: null, product_id: s.commerce.products[0].id, platform: "other", website_url: null, domain: "p.com", reason: "Pending license for test", admin_id: ADMIN, confirmed: true });
    await assert.rejects(activateDomain(s.commerce, r.license!.id, "p.com"), /active/);
  });
});

describe("profile input", () => {
  test("is validated and sanitized", () => {
    const v = validateProfileInput({ contact_name: " Pat  <b>Owner</b> ", business_name: "Owner Tax", business_email: "PAT@Example.com", phone: "(337) 555-0100" });
    assert.equal(v.business_email, "pat@example.com");
    assert.ok(!v.contact_name.includes("<"));
    assert.throws(() => validateProfileInput({ contact_name: "P", business_name: "Owner Tax", business_email: "a@b.co" }), ValidationError);
    assert.throws(() => validateProfileInput({ contact_name: "Pat", business_name: "Owner Tax", business_email: "nope" }), ValidationError);
    assert.throws(() => validateProfileInput({ contact_name: "Pat", business_name: "Owner Tax", business_email: "a@b.co", phone: "call me" }), ValidationError);
  });
});

describe("progress and completion", () => {
  const profile = { license_id: "l", contact_name: "Pat", business_name: "Tax Co", business_email: "p@x.co", phone: null, ghl_account: null, completed_at: null, last_activity_at: null, created_at: "", updated_at: "" };
  const none = { status: "none" as const, at: null, error: null, messageId: null, linkOpenedAt: null, linkState: "none" as const };

  test("status moves through the stages without skipping", () => {
    const L = { status: "active" as const };
    const d = [{ status: "active" as const }];
    assert.equal(deriveProgress({ license: L, profile: null, domains: [], connection: null, invite: none }).status, "not_started");
    assert.equal(deriveProgress({ license: L, profile: null, domains: [], connection: null, invite: { ...none, status: "sent" } }).status, "invitation_sent");
    assert.equal(deriveProgress({ license: L, profile: null, domains: [], connection: null, invite: { ...none, status: "sent", linkOpenedAt: "x" } }).status, "in_progress");
    assert.equal(deriveProgress({ license: L, profile, domains: d, connection: null, invite: none }).status, "awaiting_crm");
    assert.equal(deriveProgress({ license: L, profile, domains: d, connection: good, invite: none }).status, "ready_to_install");
    assert.equal(deriveProgress({ license: L, profile: { ...profile, completed_at: "t" }, domains: d, connection: good, invite: none }).status, "completed");
    assert.equal(deriveProgress({ license: L, profile, domains: d, connection: { ...good, last_error: "boom" }, invite: none }).status, "needs_attention");
  });

  test("a saved but untested or failing CRM never completes onboarding", async () => {
    const s = await setup();
    const r = await s.license();
    const id = r.license!.id;
    await s.repo.saveProfile(id, { contact_name: "Pat", business_name: "Tax Co", business_email: "p@x.co" });
    await activateDomain(s.commerce, id, "mysite.com");
    const domains = await s.commerce.listDomains(id);
    const lic = (await s.commerce.getLicense(id))!;
    const untested: ConnectionFacts = { provider: "webhook", status: "connected", last_checked_at: null, last_error: null };
    for (const connection of [null, untested, { ...good, last_error: "HTTP 500" }, { ...good, status: "reauth_required" }]) {
      const res = await completeOnboarding(s.repo, { license: lic, domains, connection }, "2026-10-10T13:00:00Z");
      assert.equal(res.ok, false);
    }
    assert.equal((await s.repo.getProfile(id))!.completed_at, null);
  });

  test("completion is recorded once, emails the customer their own installation instructions, and is idempotent", async () => {
    const s = await setup();
    const a = await s.license("a@example.com");
    const b = await s.license("b@example.com");
    const id = a.license!.id;
    await s.repo.saveProfile(id, { contact_name: "Pat", business_name: "Tax Co", business_email: "a@example.com" });
    await activateDomain(s.commerce, id, "mysite.com");
    const lic = (await s.commerce.getLicense(id))!;
    const domains = await s.commerce.listDomains(id);
    const res = await completeOnboarding(s.repo, { license: lic, domains, connection: good }, "2026-10-10T13:00:00Z");
    assert.deepEqual(res, { ok: true, alreadyCompleted: false });
    await emitEvent(s.deps, { type: "onboarding.completed", key: `onboarding_completed:${id}`, licenseId: id, customerId: lic.customer_id });
    const mail = s.email.sent.at(-1)!;
    assert.equal(mail.to, "a@example.com");
    assert.match(mail.subject, /all set/);
    assert.ok(mail.text.includes(lic.embed_id!), "uses this customer's embed id");
    const other = (await s.commerce.getLicense(b.license!.id))!;
    assert.ok(!mail.text.includes(other.embed_id!), "never another customer's embed id");
    assert.match(mail.text, /mysite\.com/);
    const count = s.email.sent.length;
    assert.deepEqual(await completeOnboarding(s.repo, { license: lic, domains, connection: good }, "2026-10-10T14:00:00Z"), { ok: true, alreadyCompleted: true });
    await emitEvent(s.deps, { type: "onboarding.completed", key: `onboarding_completed:${id}`, licenseId: id });
    assert.equal(s.email.sent.length, count, "no second confirmation");
    assert.equal((await s.repo.getProfile(id))!.completed_at, "2026-10-10T13:00:00Z");
  });

  test("steps list what is missing in plain words", () => {
    const steps = stepsFor({ profile: null, domains: [], connection: null });
    assert.deepEqual(steps.map((x) => x.done), [false, false, false, false]);
  });
});
