import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CrmSecrets } from "../lib/crm/crypto.ts";
import { TwilioAccounts, TwilioApi, platformTwilio } from "../lib/automation/twilio.ts";
import { MONARCH_TENANT_ID } from "../lib/tenants.ts";
import { CREDIT_PACK, creditPack, NUMBER_PLANS } from "../lib/sms/pricing.ts";
import { addMonth, renewalStep } from "../lib/sms/renewal.ts";
import { checkRegistration, suggestedRegistration } from "../lib/sms/registration.ts";
import { resolveSmsRoute, secretAad } from "../lib/sms/route.ts";
import { advanceRegistration, chooseNumber, findNumbers, fulfilSmsCheckout, resumeIfPaused, runRenewal, saveSetupChoices, smsSetupStep, startCreditsCheckout, startSetupCheckout, type Payments, type SetupDeps } from "../lib/sms/service.ts";
import type { CreditEntry, SmsAccount, SmsAccountPatch, SmsAccountsRepo, SmsCheckout } from "../lib/sms/types.ts";

// Text messaging billing and self-serve setup for tax offices. Fake offices, example.com addresses, fake Twilio and
// Stripe only: nothing here reaches a real service.

const T = "00000000-0000-4000-8000-0000000000b2";
const PARENT = `AC${"a".repeat(32)}`;
const SUB = `AC${"b".repeat(32)}`;
const KEY = `SK${"c".repeat(32)}`;
const PN = `PN${"d".repeat(32)}`;
const secrets = new CrmSecrets(Buffer.alloc(32, 7));

/** Mirrors the database: tenants read the ledger; only these functions write it, with the same rules. */
class MemorySms implements SmsAccountsRepo {
  row: SmsAccount | null = null;
  ledgerRows: CreditEntry[] = [];
  checkouts: SmsCheckout[] = [];
  async get() { return this.row ? structuredClone(this.row) : null; }
  async insert(input: SmsAccountPatch) {
    this.row = {
      id: "acc", tenant_id: T, subaccount_sid: null, api_key_sid: null, api_key_secret_encrypted: null, from_number: null, phone_number_sid: null, messaging_service_sid: null,
      registration_status: "not_started", status: "setting_up", created_by: null, created_at: "2026-10-16T00:00:00Z", updated_at: "2026-10-16T00:00:00Z",
      number_type: null, registration: {}, registration_sids: {}, registration_error: null, chosen_number: null, setup_paid_at: null, provision_status: "none", provision_error: null,
      renews_on: null, renewal_failed_at: null, renewal_attempts: 0, released_at: null, forfeited_at: null, ...structuredClone(input),
    } as SmsAccount;
    return structuredClone(this.row);
  }
  async update(_id: string, patch: SmsAccountPatch) { this.row = { ...this.row!, ...structuredClone(patch) }; return structuredClone(this.row); }
  async balance() { return this.ledgerRows.reduce((n, e) => n + e.delta, 0); }
  async ledger() { return [...this.ledgerRows].reverse(); }
  private add(delta: number, kind: CreditEntry["kind"], reference: string, note: string | null = null) {
    this.ledgerRows.push({ id: `l${this.ledgerRows.length}`, tenant_id: T, delta, kind, reference, note, created_by: null, created_at: new Date().toISOString() });
  }
  private has(kind: string, reference: string) { return this.ledgerRows.some((e) => e.kind === kind && e.reference === reference); }
  async spend(n: number, ref: string) { if ((await this.balance()) < n) return false; this.add(-n, "send", ref); return true; }
  async reverseSend(ref: string) { const s = this.ledgerRows.find((e) => e.kind === "send" && e.reference === ref); if (!s || this.has("send_reversal", ref)) return 0; this.add(-s.delta, "send_reversal", ref); return -s.delta; }
  async creditPurchase(sessionId: string) {
    const c = this.checkouts.find((x) => x.stripe_session_id === sessionId && x.purpose === "credits");
    if (!c) throw new Error("SMS_CHECKOUT_NOT_FOUND");
    c.status = "paid";
    if (!this.has("purchase", sessionId)) this.add(c.credits!, "purchase", sessionId);
    return c.credits!;
  }
  async chargeRenewal(credits: number, period: string, note: string) {
    if (this.has("renewal", period)) return true;
    if ((await this.balance()) < credits) return false;
    this.add(-credits, "renewal", period, note);
    return true;
  }
  async forfeit(ref: string) { const have = await this.balance(); if (have <= 0 || this.has("forfeit", ref)) return 0; this.add(-have, "forfeit", ref); return have; }
  async insertCheckout(input: Pick<SmsCheckout, "purpose" | "number_type" | "packs" | "credits" | "amount_cents" | "created_by">) {
    const c: SmsCheckout = { id: `11111111-1111-4111-8111-11111111111${this.checkouts.length}`, tenant_id: T, stripe_session_id: null, currency: "usd", status: "open", paid_at: null, created_at: "", ...input };
    this.checkouts.push(c);
    return structuredClone(c);
  }
  async updateCheckout(id: string, patch: Partial<SmsCheckout>) { const c = this.checkouts.find((x) => x.id === id)!; Object.assign(c, patch); return structuredClone(c); }
  async findCheckout(sessionId: string) { return structuredClone(this.checkouts.find((c) => c.stripe_session_id === sessionId) ?? null); }
}

/** Fake Twilio: records every call and answers like the real API. */
function fakeTwilio(opts: { brand?: string; campaign?: string; tollfree?: string; failAt?: string } = {}) {
  const calls: string[] = [];
  const bodies: Record<string, string> = {};
  const f = (async (url: string, init: RequestInit) => {
    const at = `${init.method} ${url.replace(/^https:\/\/[a-z]+\.twilio\.com/, "")}`;
    calls.push(at);
    if (init.body) bodies[at] = String(init.body);
    const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (opts.failAt && at.includes(opts.failAt)) return ok({ message: "down" }, 500);
    if (at === "POST /2010-04-01/Accounts.json") return ok({ sid: SUB }, 201);
    if (at.endsWith("/Keys.json")) return ok({ sid: KEY, secret: "office-key-secret" }, 201);
    if (at.includes("/AvailablePhoneNumbers/US/TollFree.json")) return ok({ available_phone_numbers: [{ phone_number: "+18885550123", friendly_name: "(888) 555-0123" }] });
    if (at.includes("/AvailablePhoneNumbers/US/Local.json")) return ok({ available_phone_numbers: [{ phone_number: "+13375550123", friendly_name: "(337) 555-0123", locality: "Lafayette", region: "LA" }] });
    if (at.endsWith("/IncomingPhoneNumbers.json")) return ok({ sid: PN, phone_number: new URLSearchParams(String(init.body)).get("PhoneNumber") }, 201);
    if (at.startsWith("DELETE") && at.includes("/IncomingPhoneNumbers/")) return new Response(null, { status: 204 });
    if (at === "POST /v1/Tollfree/Verifications") return ok({ sid: "HH123", status: "PENDING_REVIEW" }, 201);
    if (at === "GET /v1/Tollfree/Verifications/HH123") return ok({ status: opts.tollfree ?? "IN_REVIEW", rejection_reason: "Opt-in unclear" });
    if (at.startsWith("GET /v1/a2p/BrandRegistrations/")) return ok({ status: opts.brand ?? "PENDING" });
    if (at.startsWith("GET /v1/Services/") && at.includes("/Compliance/Usa2p/")) return ok({ campaign_status: opts.campaign ?? "IN_PROGRESS" });
    if (at.startsWith("POST")) {
      const prefix = at.includes("CustomerProfiles") && !at.includes("/") ? "BU" : at.includes("/Addresses.json") ? "AD" : at.includes("/Services") && !at.includes("/Services/") ? "MG" : at.includes("/Usa2p") ? "QE" : at.includes("BrandRegistrations") ? "BN" : at.includes("TrustProducts") && !at.includes("TrustProducts/") ? "BU" : at.includes("EndUsers") ? "IT" : at.includes("SupportingDocuments") ? "RD" : at.includes("CustomerProfiles") && at.split("/").length === 4 ? "BU" : "XX";
      return ok({ sid: `${prefix}${String(calls.length).padStart(32, "0")}` }, 201);
    }
    return ok({}, 404);
  }) as unknown as typeof fetch;
  return { fetch: f, calls, bodies };
}

const REG = {
  ...suggestedRegistration("Test Tax Office"), legal_name: "Test Tax Office LLC", business_type: "Limited Liability Corporation", ein: "12-3456789", website: "www.example.com",
  street: "1 Main St", city: "Lafayette", state: "la", postal_code: "70501", contact_first_name: "Pat", contact_last_name: "Tester", contact_email: "pat@example.com",
  contact_phone: "(337) 555-0100", opt_in_image_url: "https://app.example.com/media/x/images/library/optin.png",
};

function setup(over: Partial<SetupDeps> = {}, tw = fakeTwilio()) {
  const repo = new MemorySms();
  const notices: string[] = [];
  let clock = new Date("2026-10-16T12:00:00Z");
  const d: SetupDeps = {
    tenantId: T, repo, twilio: new TwilioAccounts({ username: PARENT, password: "owner-token" }, tw.fetch), parentSid: PARENT, secrets, primaryProfileSid: null,
    officeName: "Test Tax Office", api: (login) => new TwilioApi(login, tw.fetch), notify: async (subject) => { notices.push(subject); }, now: () => clock, ...over,
  };
  const checkouts: Parameters<Payments["createCheckout"]>[0][] = [];
  const payments: Payments = { async createCheckout(input) { checkouts.push(input); return { id: `cs_test_${"x".repeat(20)}${checkouts.length}`, url: "https://checkout.stripe.test/pay" }; } };
  return { d, repo, tw, notices, checkouts, payments, at: (iso: string) => { clock = new Date(iso); } };
}
const paid = (s: ReturnType<typeof setup>, i = 0, over: Partial<{ amount_total: number; tenant: string; payment_status: string }> = {}) => {
  const c = s.repo.checkouts[i];
  return { id: c.stripe_session_id!, status: "complete", payment_status: over.payment_status ?? "paid", amount_total: over.amount_total ?? c.amount_cents, currency: "usd", metadata: { purpose: c.purpose === "credits" ? "sms_credits" : "sms_setup", tenant_id: over.tenant ?? T, sms_checkout_id: c.id } };
};

describe("prices", () => {
  test("credit packs are $25 for 1,000 credits ($0.025 each); 1 to 10 packs", () => {
    assert.deepEqual(CREDIT_PACK, { cents: 2500, credits: 1000 });
    assert.deepEqual(creditPack(3), { packs: 3, cents: 7500, credits: 3000, item: "1,000 credits for text messages" });
    assert.throws(() => creditPack(0));
    assert.throws(() => creditPack(11));
  });
  test("toll-free: $5 setup, $2.75 a month = 110 credits; local: $23.50 setup, $3.25 a month = 130 credits", () => {
    assert.deepEqual([NUMBER_PLANS.toll_free.setupCents, NUMBER_PLANS.toll_free.monthlyCents, NUMBER_PLANS.toll_free.monthlyCredits], [500, 275, 110]);
    assert.deepEqual([NUMBER_PLANS.local.setupCents, NUMBER_PLANS.local.monthlyCents, NUMBER_PLANS.local.monthlyCredits], [2350, 325, 130]);
    assert.equal(NUMBER_PLANS.toll_free.recommended, true);
  });
  test("charges say what they're for, never how they're built up", () => {
    for (const p of Object.values(NUMBER_PLANS)) for (const text of [p.setupItem, p.monthlyItem, p.summary]) assert.doesNotMatch(text, /margin|markup|twilio|cost|fee|profit/i);
  });
});

describe("renewal policy", () => {
  const a = (over: Partial<SmsAccount>) => ({ status: "active", renews_on: "2026-11-16", renewal_failed_at: null, renewal_attempts: 0, forfeited_at: null, from_number: "+18885550123", ...over }) as SmsAccount;
  test("charge on the due date; retry on day 3 and day 7; release after the last; forfeit 30 days after the due date", () => {
    assert.deepEqual(renewalStep(a({}), new Date("2026-11-15T23:00:00Z")), { do: "none" });
    assert.deepEqual(renewalStep(a({}), new Date("2026-11-16T06:00:00Z")), { do: "charge", attempt: 1, period: "2026-11-16" });
    const failed = a({ status: "paused", renewal_failed_at: "2026-11-16T11:00:00Z", renewal_attempts: 1 });
    assert.deepEqual(renewalStep(failed, new Date("2026-11-18T11:00:00Z")), { do: "none" });
    assert.deepEqual(renewalStep(failed, new Date("2026-11-19T11:00:00Z")), { do: "charge", attempt: 2, period: "2026-11-16" });
    const second = { ...failed, renewal_attempts: 2 };
    assert.deepEqual(renewalStep(second, new Date("2026-11-22T11:00:00Z")), { do: "none" });
    assert.deepEqual(renewalStep(second, new Date("2026-11-23T11:00:00Z")), { do: "charge", attempt: 3, period: "2026-11-16" });
    const released = a({ status: "released", renewal_attempts: 3 });
    assert.deepEqual(renewalStep(released, new Date("2026-12-15T00:00:00Z")), { do: "none" });
    assert.deepEqual(renewalStep(released, new Date("2026-12-16T00:00:00Z")), { do: "forfeit", period: "2026-11-16" });
    assert.deepEqual(renewalStep({ ...released, forfeited_at: "2026-12-16T00:00:00Z" }, new Date("2027-01-30T00:00:00Z")), { do: "none" });
  });
  test("months roll over cleanly", () => {
    assert.equal(addMonth("2027-01-31"), "2027-02-28");
    assert.equal(addMonth("2026-12-16"), "2027-01-16");
  });
});

describe("guided registration", () => {
  test("answers are checked; samples must say how to opt out; local needs two samples", () => {
    const r = checkRegistration(REG, "toll_free");
    assert.deepEqual([r.ein, r.website, r.state, r.contact_phone], ["123456789", "https://www.example.com", "LA", "+13375550100"]);
    assert.throws(() => checkRegistration({ ...REG, sample_1: "Your return was accepted by the IRS today." }, "toll_free"), /opt out/);
    assert.throws(() => checkRegistration({ ...REG, ein: "123" }, "toll_free"), /9-digit EIN/);
    assert.throws(() => checkRegistration({ ...REG, opt_in_image_url: "" }, "toll_free"), /picture/);
    assert.throws(() => checkRegistration({ ...REG, sample_2: "" }, "local"), /sample message 2/);
  });
});

describe("toll-free setup, start to finish", () => {
  test("choose, register, pick a number, pay; payment verified; number bought into the office's own subaccount; verification submitted", async () => {
    const s = setup();
    assert.equal(smsSetupStep(null), "choose");
    await assert.rejects(saveSetupChoices({ ...s.d, tenantId: MONARCH_TENANT_ID }, { ...REG, number_type: "toll_free" }, "u"), /owner's own Twilio/);
    await assert.rejects(saveSetupChoices(s.d, { ...REG, number_type: "local" }, "u"), /Local numbers aren't available yet/);
    await saveSetupChoices(s.d, { ...REG, number_type: "toll_free" }, "u");
    assert.equal(smsSetupStep(s.repo.row), "number");

    const found = await findNumbers(s.d, undefined);
    assert.equal(found[0].phoneNumber, "+18885550123");
    assert.ok(s.tw.calls.at(-1)!.startsWith(`GET /2010-04-01/Accounts/${PARENT}/AvailablePhoneNumbers/US/TollFree.json`), "searched before any subaccount exists");
    await assert.rejects(chooseNumber(s.d, "+13375550123"), /isn't a toll-free number/);
    await chooseNumber(s.d, "+18885550123");
    assert.equal(smsSetupStep(s.repo.row), "pay");
    assert.equal(s.tw.calls.filter((c) => c.includes("/Accounts.json")).length, 0, "no subaccount before payment");

    const url = await startSetupCheckout(s.d, s.payments, { origin: "https://app.example.com", email: "pat@example.com" }, "u");
    assert.equal(url, "https://checkout.stripe.test/pay");
    assert.deepEqual([s.checkouts[0].item, s.checkouts[0].unitCents, s.checkouts[0].quantity], [NUMBER_PLANS.toll_free.setupItem, 500, 1]);
    assert.deepEqual(s.checkouts[0].metadata, { purpose: "sms_setup", tenant_id: T, sms_checkout_id: s.repo.checkouts[0].id });

    // Nothing is issued for an unpaid, short, or someone else's payment.
    assert.equal(await fulfilSmsCheckout(s.d, paid(s, 0, { payment_status: "unpaid" })), "not_paid");
    await assert.rejects(fulfilSmsCheckout(s.d, paid(s, 0, { amount_total: 100 })), /doesn't match/);
    await assert.rejects(fulfilSmsCheckout(s.d, paid(s, 0, { tenant: MONARCH_TENANT_ID })), /another account/);
    assert.equal(s.repo.row!.setup_paid_at, null);

    assert.equal(await fulfilSmsCheckout(s.d, paid(s)), "provisioned");
    const a = s.repo.row!;
    assert.deepEqual([a.subaccount_sid, a.api_key_sid, a.from_number, a.phone_number_sid, a.status, a.provision_status, a.registration_status], [SUB, KEY, "+18885550123", PN, "active", "done", "submitted"]);
    assert.equal(secrets.decrypt(a.api_key_secret_encrypted!, secretAad(T)), "office-key-secret");
    assert.equal(a.renews_on, "2026-11-16", "the setup covers the first month");
    assert.ok(s.tw.calls.includes(`POST /2010-04-01/Accounts/${SUB}/IncomingPhoneNumbers.json`), "bought into the office's subaccount");
    const v = new URLSearchParams(s.tw.bodies["POST /v1/Tollfree/Verifications"]);
    assert.deepEqual([v.get("TollfreePhoneNumberSid"), v.get("BusinessName"), v.get("BusinessRegistrationNumber"), v.get("OptInType"), v.getAll("UseCaseCategories").length], [PN, "Test Tax Office LLC", "123456789", "PAPER_FORM", 2]);
    assert.equal(s.tw.calls.filter((c) => c.includes("Usa2p") || c.includes("BrandRegistrations")).length, 0, "toll-free never registers a campaign");

    // Texts stay blocked until approved.
    assert.equal(resolveSmsRoute(T, a, platformTwilio({}), secrets).ok, false);
    const callsBefore = s.tw.calls.length;
    assert.equal(await fulfilSmsCheckout(s.d, paid(s)), "already");
    assert.equal(s.tw.calls.length, callsBefore, "a second confirmation does nothing");

    s.tw.calls.length = 0;
    const tw2 = fakeTwilio({ tollfree: "TWILIO_APPROVED" });
    const approved = await advanceRegistration({ ...s.d, api: (l) => new TwilioApi(l, tw2.fetch) });
    assert.equal(approved.registration_status, "approved");
    assert.deepEqual(s.notices, ["Texting is approved"]);
    const route = resolveSmsRoute(T, approved, platformTwilio({}), secrets);
    assert.ok(route.ok && route.route.from === "+18885550123" && route.route.username === KEY && route.billing === "credits");
  });

  test("if the chosen number was taken meanwhile, another of the same kind is bought", async () => {
    const tw = fakeTwilio();
    const s = setup({}, tw);
    await saveSetupChoices(s.d, { ...REG, number_type: "toll_free" }, "u");
    await chooseNumber(s.d, "+18005550000");
    await startSetupCheckout(s.d, s.payments, { origin: "https://app.example.com", email: null }, "u");
    let bought = 0;
    const flaky = (async (url: string, init: RequestInit) => (String(url).endsWith("/IncomingPhoneNumbers.json") && bought++ === 0 ? new Response(JSON.stringify({ message: "not available" }), { status: 400 }) : tw.fetch(url, init))) as unknown as typeof fetch;
    await fulfilSmsCheckout({ ...s.d, twilio: new TwilioAccounts({ username: PARENT, password: "t" }, flaky) }, paid(s));
    assert.equal(s.repo.row!.from_number, "+18885550123");
  });
});

describe("credits", () => {
  test("bought by card; credited once, only after Stripe confirms the exact amount", async () => {
    const s = setup();
    await startCreditsCheckout(s.d, s.payments, "2", { origin: "https://app.example.com", email: null }, "u");
    assert.deepEqual([s.checkouts[0].unitCents, s.checkouts[0].quantity, s.repo.checkouts[0].amount_cents, s.repo.checkouts[0].credits], [2500, 2, 5000, 2000]);
    await assert.rejects(fulfilSmsCheckout(s.d, paid(s, 0, { amount_total: 2500 })), /doesn't match/);
    assert.equal(await s.repo.balance(), 0);
    assert.equal(await fulfilSmsCheckout(s.d, paid(s)), "credited");
    assert.equal(await fulfilSmsCheckout(s.d, paid(s)), "already");
    assert.equal(await s.repo.balance(), 2000);
    await assert.rejects(startCreditsCheckout(s.d, s.payments, "11", { origin: "https://app.example.com", email: null }, "u"), /between 1 and 10/);
  });

  test("no manual credits: the ledger has no way to add credits except a confirmed purchase", () => {
    const sql = readFileSync(new URL("../supabase/migrations/20261103090000_sms_billing.sql", import.meta.url), "utf8");
    assert.match(sql, /revoke insert, update, delete on table public\.sms_credit_ledger from tenant_app, authenticated, anon/);
    assert.match(sql, /check \(kind in \('purchase', 'send', 'send_reversal', 'renewal', 'forfeit'\)\)/);
    assert.doesNotMatch(sql, /'grant'|'transfer'|'refund'/);
    assert.match(sql, /select \* into c from public\.sms_checkouts where tenant_id = t and stripe_session_id = p_session_id and purpose = 'credits'/);
    const repoSrc = readFileSync(new URL("../lib/sms/supabase-repo.ts", import.meta.url), "utf8");
    assert.doesNotMatch(repoSrc, /from\("sms_credit_ledger"\)\.(insert|update|delete|upsert)/);
  });
});

describe("monthly renewal from credits", () => {
  async function activeOffice(credits: number) {
    const s = setup();
    await saveSetupChoices(s.d, { ...REG, number_type: "toll_free" }, "u");
    await chooseNumber(s.d, "+18885550123");
    await startSetupCheckout(s.d, s.payments, { origin: "https://app.example.com", email: null }, "u");
    await fulfilSmsCheckout(s.d, paid(s));
    if (credits) {
      await startCreditsCheckout(s.d, s.payments, "1", { origin: "https://app.example.com", email: null }, "u");
      await fulfilSmsCheckout(s.d, paid(s, 1));
      s.repo.ledgerRows.push({ id: "adj", tenant_id: T, delta: credits - 1000, kind: "send", reference: "test", note: null, created_by: null, created_at: "" });
    }
    s.notices.length = 0;
    return s;
  }

  test("renews from credits on the due date and moves the date a month on", async () => {
    const s = await activeOffice(500);
    s.at("2026-11-16T12:00:00Z");
    assert.equal(await runRenewal(s.d), "renewed");
    assert.equal(await s.repo.balance(), 390);
    assert.equal(s.repo.row!.renews_on, "2026-12-16");
    assert.equal(s.repo.ledgerRows.at(-1)!.note, NUMBER_PLANS.toll_free.monthlyItem);
    assert.equal(await runRenewal(s.d), "none", "once per month");
  });

  test("not enough: paused and told; buying credits resumes at once", async () => {
    const s = await activeOffice(50);
    s.at("2026-11-16T12:00:00Z");
    assert.equal(await runRenewal(s.d), "paused");
    assert.equal(s.repo.row!.status, "paused");
    assert.match(s.notices[0], /Texting paused/);
    assert.equal(resolveSmsRoute(T, s.repo.row, platformTwilio({}), secrets).ok, false, "texts blocked while paused");
    await startCreditsCheckout(s.d, s.payments, "1", { origin: "https://app.example.com", email: null }, "u");
    await fulfilSmsCheckout(s.d, paid(s, 2));
    assert.equal(s.repo.row!.status, "active");
    assert.equal(s.repo.row!.renews_on, "2026-12-16");
    assert.equal(await s.repo.balance(), 50 + 1000 - 110);
  });

  test("still not paid: retried day 3 and day 7, then the number is released; 30 days after the due date the credits are forfeited", async () => {
    const s = await activeOffice(50);
    s.at("2026-11-16T12:00:00Z");
    assert.equal(await runRenewal(s.d), "paused");
    s.at("2026-11-18T12:00:00Z");
    assert.equal(await runRenewal(s.d), "none");
    s.at("2026-11-19T12:00:00Z");
    assert.equal(await runRenewal(s.d), "retry_failed");
    s.at("2026-11-23T12:00:00Z");
    s.tw.calls.length = 0;
    assert.equal(await runRenewal(s.d), "released");
    assert.ok(s.tw.calls.includes(`DELETE /2010-04-01/Accounts/${SUB}/IncomingPhoneNumbers/${PN}.json`));
    assert.deepEqual([s.repo.row!.status, s.repo.row!.from_number], ["released", null]);
    assert.ok(s.notices.includes("Your texting number was released"));
    s.at("2026-12-15T12:00:00Z");
    assert.equal(await runRenewal(s.d), "none");
    s.at("2026-12-16T12:00:00Z");
    assert.equal(await runRenewal(s.d), "forfeited");
    assert.equal(await s.repo.balance(), 0);
    assert.equal(s.repo.ledgerRows.at(-1)!.kind, "forfeit");
    assert.equal(await runRenewal(s.d), "none");
    assert.equal(smsSetupStep(s.repo.row), "released");
  });

  test("an early retry after buying too few credits changes nothing", async () => {
    const s = await activeOffice(50);
    s.at("2026-11-16T12:00:00Z");
    await runRenewal(s.d);
    assert.equal(await resumeIfPaused(s.d), false);
    assert.equal(s.repo.row!.renewal_attempts, 1);
  });
});

describe("local numbers: the A2P 10DLC chain", () => {
  test("profile, A2P profile, brand, messaging service; the campaign once the brand is approved; approved once verified", async () => {
    const primary = `BU${"e".repeat(32)}`;
    const s = setup({ primaryProfileSid: primary });
    await saveSetupChoices(s.d, { ...REG, number_type: "local" }, "u");
    await assert.rejects(findNumbers(s.d, "12"), /area code/);
    await findNumbers(s.d, "337");
    await chooseNumber(s.d, "+13375550123");
    await startSetupCheckout(s.d, s.payments, { origin: "https://app.example.com", email: null }, "u");
    assert.equal(s.checkouts[0].unitCents, 2350);
    await fulfilSmsCheckout(s.d, paid(s));
    let a = s.repo.row!;
    assert.equal(a.registration_status, "submitted");
    for (const k of ["customer_profile", "business_info", "representative", "address", "address_document", "profile_submitted", "a2p_profile", "a2p_submitted", "brand", "messaging_service", "service_number"]) assert.ok(a.registration_sids[k], `${k} recorded`);
    assert.equal(a.registration_sids.campaign, undefined, "no campaign while the brand is pending");
    assert.ok(s.tw.calls.some((c) => c.includes("EntityAssignments")) && s.tw.bodies[s.tw.calls.find((c) => c.includes("CustomerProfiles/") && c.includes("EntityAssignments"))!] !== undefined);
    assert.ok(Object.values(s.tw.bodies).some((b) => b === `ObjectSid=${primary}`), "linked to the platform's primary profile");
    assert.match(a.messaging_service_sid ?? "", /^MG/);

    const approvedBrand = fakeTwilio({ brand: "APPROVED" });
    a = await advanceRegistration({ ...s.d, api: (l) => new TwilioApi(l, approvedBrand.fetch) });
    assert.match(a.registration_sids.campaign, /^QE/);
    const camp = new URLSearchParams(approvedBrand.bodies[approvedBrand.calls.find((c) => c.includes("/Usa2p"))!]);
    assert.equal(camp.getAll("MessageSamples").length, 2);
    assert.equal(approvedBrand.calls.filter((c) => c.startsWith("POST") && !c.includes("Usa2p")).length, 0, "earlier steps aren't repeated");

    const verified = fakeTwilio({ campaign: "VERIFIED" });
    a = await advanceRegistration({ ...s.d, api: (l) => new TwilioApi(l, verified.fetch) });
    assert.equal(a.registration_status, "approved");
    const route = resolveSmsRoute(T, a, platformTwilio({}), secrets);
    assert.ok(route.ok && route.route.messagingServiceSid === a.messaging_service_sid, "local texts go through the registered messaging service");
  });

  test("a failure part-way keeps what was done; the next run carries on", async () => {
    const s = setup({ primaryProfileSid: `BU${"e".repeat(32)}` }, fakeTwilio({ failAt: "TrustProducts" }));
    await saveSetupChoices(s.d, { ...REG, number_type: "local" }, "u");
    await chooseNumber(s.d, "+13375550123");
    await startSetupCheckout(s.d, s.payments, { origin: "https://app.example.com", email: null }, "u");
    await fulfilSmsCheckout(s.d, paid(s));
    const a = s.repo.row!;
    assert.ok(a.registration_sids.customer_profile && !a.registration_sids.a2p_profile);
    assert.match(a.registration_error ?? "", /Twilio refused/);
    const next = fakeTwilio();
    await advanceRegistration({ ...s.d, api: (l) => new TwilioApi(l, next.fetch) });
    assert.equal(next.calls.filter((c) => c === "POST /v1/CustomerProfiles").length, 0, "the business profile isn't made twice");
    assert.ok(s.repo.row!.registration_sids.a2p_profile);
  });
});
