import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { accessOf, deleteAfter, GRACE_DAYS, mayContactClients, nextStep, precheckDue, READ_ONLY_DAYS, RETENTION_DAYS, type Subscription } from "../lib/billing/access.ts";
import { billingProblems, PAUSE_PLAN, PLANS } from "../lib/billing/plans.ts";
import { cleanSignup, readSignup, signSignup } from "../lib/billing/signup.ts";
import {
  handleBillingEvent, pauseWorkspace, requestSignup, resumeWorkspace, runBillingSweep, startCheckout, startReactivation,
  type BillingDeps, type BillingRepo, type BillingStripe, type Mail, type SubscriptionFacts,
} from "../lib/billing/service.ts";
import type { PracticeMember, PracticeRepo } from "../lib/practice/service.ts";

const KEY = Buffer.alloc(32, 9);
const DAY = 86_400_000;
const T0 = new Date("2026-11-01T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

function setup(over: { now?: Date; captcha?: boolean; exists?: boolean } = {}) {
  let now = over.now ?? T0;
  const subs = new Map<string, Subscription>();
  const events = new Set<string>();
  const mails: { to: string; mail: Mail }[] = [];
  const hits = new Map<string, number>();
  const prices: { sub: string; key: string }[] = [];
  const members = new Map<string, PracticeMember[]>();
  const tenants = new Map<string, string>();
  const stripeState = { retry: "none" as "none" | "paid" | "failed", card: { ok: true } as { ok: true } | { ok: false; reason: string }, canceled: [] as string[], facts: { status: "active", currentPeriodEnd: iso(T0.getTime() + 30 * DAY), cancelAtPeriodEnd: false, lookupKey: "verexa_ptin_monthly", customerId: "cus_1" } as SubscriptionFacts };
  const repo: BillingRepo = {
    byTenant: async (t) => subs.get(t) ?? null,
    bySubscription: async (s) => [...subs.values()].find((x) => x.stripe_subscription_id === s) ?? null,
    byCustomer: async (c) => [...subs.values()].find((x) => x.stripe_customer_id === c) ?? null,
    insert: async (s) => { const row = { ...s, created_at: "", updated_at: "" } as Subscription; subs.set(s.tenant_id, row); return row; },
    update: async (t, p) => { const row = { ...subs.get(t)!, ...p } as Subscription; subs.set(t, row); return row; },
    eventSeen: async (id) => events.has(id),
    recordEvent: async (id) => { events.add(id); },
    sweepList: async () => [...subs.values()].filter((s) => s.status !== "internal" && s.status !== "canceled"),
  };
  const stripe: BillingStripe = {
    signupCheckout: async (i) => ({ url: `https://checkout.test/${i.plan}?k=${i.idempotencyKey}` }),
    reactivateCheckout: async (i) => ({ url: `https://checkout.test/back/${i.tenantId}` }),
    portalUrl: async () => "https://portal.test",
    setPrice: async (sub, key) => { prices.push({ sub, key }); },
    subscriptionFacts: async () => stripeState.facts,
    cardCheck: async () => stripeState.card,
    retryOpenInvoice: async () => stripeState.retry,
    cancelNow: async (s) => { stripeState.canceled.push(s); },
  };
  const deps: BillingDeps = {
    repo, stripe, key: KEY, origin: async () => "https://app.test",
    provision: {
      createTenant: async (i) => {
        if ([...tenants.keys()].includes(i.slug)) throw new Error("duplicate key");
        const id = randomUUID(); tenants.set(i.slug, id); return { id };
      },
      tenantBySlug: async (slug) => (tenants.has(slug) ? { id: tenants.get(slug)! } : null),
      practiceRepo: (tenantId) => ({
        listMembers: async () => members.get(tenantId) ?? [],
        getMember: async () => null,
        insertMember: async (i) => { const m = { id: randomUUID(), role: "owner", user_id: null, status: "invited", accepted_at: null, last_seen_at: null, created_at: "", ...i } as unknown as PracticeMember; members.set(tenantId, [...(members.get(tenantId) ?? []), m]); return m; },
        updateMember: async () => { throw new Error("unused"); },
        addAudit: async () => undefined,
      } satisfies PracticeRepo),
      inviteLink: async (t) => `https://app.test/practice/invite/${t}`,
    },
    accountExists: async () => over.exists === true,
    ownerEmail: async (t) => { const m = members.get(t)?.[0]; return m ? { email: m.email, name: m.full_name } : null; },
    mail: async (to, mail) => { mails.push({ to, mail }); return null; },
    hit: async (b) => { hits.set(b, (hits.get(b) ?? 0) + 1); return hits.get(b)!; },
    captcha: async () => over.captcha !== false,
    termsVersion: "draft-test", now: () => now,
  };
  return { deps, subs, mails, prices, members, stripeState, tick: (ms: number) => { now = new Date(now.getTime() + ms); }, set: (d: Date) => { now = d; } };
}

const completed = (id: string, subId = "sub_1", plan = "ptin") => ({
  id, type: "checkout.session.completed",
  data: { object: { mode: "subscription", payment_status: "paid", subscription: subId, customer: "cus_1", metadata: { kind: "signup", plan, email: "pat@example.com", name: "Pat Preparer", workspace: "Pat Tax", terms: "draft-test" } } },
});

test("plans: three tiers at the owner's prices; only PTIN is open for self-serve", () => {
  assert.deepEqual([PLANS.ptin.priceCents, PLANS.ero.priceCents, PLANS.bureau.priceCents, PAUSE_PLAN.priceCents], [9900, 19900, 29900, 2700]);
  assert.deepEqual(Object.values(PLANS).map((p) => p.selfServe), [true, false, false]);
  assert.ok(billingProblems({}).length >= 2);
  assert.deepEqual(billingProblems({ STRIPE_BILLING_SECRET_KEY: "sk_test_abc", STRIPE_BILLING_WEBHOOK_SECRET: "whsec_x", MONARCH_ENCRYPTION_KEY: "k" }), []);
});

test("access: the owner's late-payment timeline", () => {
  const sub = (status: Subscription["status"], suspended_at: string | null = null) => ({ status, suspended_at });
  assert.equal(accessOf(null), "full");
  assert.deepEqual(["active", "internal", "suspended", "read_only", "paused", "canceled"].map((s) => accessOf({ status: s as Subscription["status"] })), ["full", "full", "grace", "read_only", "contacts_only", "closed"]);
  assert.equal(mayContactClients("full"), true);
  assert.equal(mayContactClients("grace"), false);
  const t = T0.getTime();
  assert.equal(nextStep(sub("suspended", iso(t - 6 * DAY)), T0), null);
  assert.equal(nextStep(sub("suspended", iso(t - GRACE_DAYS * DAY)), T0), "read_only");
  assert.equal(nextStep(sub("read_only", iso(t - (GRACE_DAYS + READ_ONLY_DAYS - 1) * DAY)), T0), null);
  assert.equal(nextStep(sub("read_only", iso(t - (GRACE_DAYS + READ_ONLY_DAYS) * DAY)), T0), "canceled");
  assert.equal(nextStep(sub("suspended", iso(t - 40 * DAY)), T0), "canceled", "a missed sweep never skips the end");
  assert.equal(nextStep(sub("active"), T0), null);
  assert.equal(deleteAfter(T0), iso(t + RETENTION_DAYS * DAY));
});

test("the card is checked at 7, 5 and 3 days before renewal, once each", () => {
  const base = (days: number, mark: number | null) => ({ status: "active" as const, current_period_end: iso(T0.getTime() + days * DAY - 3600_000), precheck_mark: mark });
  assert.equal(precheckDue(base(10, null), T0), null);
  assert.equal(precheckDue(base(7, null), T0), 7);
  assert.equal(precheckDue(base(7, 7), T0), null);
  assert.equal(precheckDue(base(5, 7), T0), 5);
  assert.equal(precheckDue(base(3, 5), T0), 3);
  assert.equal(precheckDue(base(3, 3), T0), null);
  assert.equal(precheckDue(base(2, 5), T0), 3, "a missed day catches up");
  assert.equal(precheckDue({ status: "suspended", current_period_end: iso(T0.getTime() + 3 * DAY), precheck_mark: null }, T0), null);
});

test("signup details are checked; PTIN only; terms must be accepted", () => {
  const ok = { email: " Pat@Example.com ", name: "Pat  Preparer", workspace: "", plan: "ptin", agree: "on" };
  assert.deepEqual(cleanSignup(ok), { email: "pat@example.com", name: "Pat Preparer", workspace: "Pat Preparer", plan: "ptin" });
  assert.throws(() => cleanSignup({ ...ok, plan: "ero" }), /aren't open for self-serve/);
  assert.throws(() => cleanSignup({ ...ok, plan: "free" }), /Choose a plan/);
  assert.throws(() => cleanSignup({ ...ok, agree: undefined }), /agree to the Terms/);
  assert.throws(() => cleanSignup({ ...ok, email: "nope" }), /valid email/);
});

test("signup links can't be forged, edited or used after they expire", () => {
  const token = signSignup(KEY, { email: "pat@example.com", name: "Pat", workspace: "Pat Tax", plan: "ptin" }, "v1", T0);
  assert.equal(readSignup(KEY, token, new Date(T0.getTime() + 3600_000))?.email, "pat@example.com");
  assert.equal(readSignup(KEY, token, new Date(T0.getTime() + 25 * 3600_000)), null);
  assert.equal(readSignup(Buffer.alloc(32, 1), token, T0), null);
  const [body, sig] = token.split(".");
  const edited = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), plan: "bureau" })).toString("base64url");
  assert.equal(readSignup(KEY, `${edited}.${sig}`, T0), null);
  assert.equal(readSignup(KEY, "garbage", T0), null);
});

test("requesting signup: a link by email, the same answer every time, abuse limits", async () => {
  const s = setup();
  const raw = { email: "pat@example.com", name: "Pat", workspace: "Pat Tax", plan: "ptin", agree: "on" };
  const r1 = await requestSignup(s.deps, raw, { ipHash: "ip1", captchaToken: "ok", ip: "1.2.3.4" });
  assert.equal(s.mails.length, 1);
  assert.match(s.mails[0].mail.text, /https:\/\/app\.test\/signup\/verify\//);
  const existing = setup({ exists: true });
  const r2 = await requestSignup(existing.deps, raw, { ipHash: "ip1", captchaToken: "ok", ip: null });
  assert.equal(r1.message, r2.message, "no way to tell whether an email has an account");
  assert.match(existing.mails[0].mail.subject, /already have/);
  for (let i = 0; i < 3; i++) await requestSignup(s.deps, raw, { ipHash: "ip1", captchaToken: "ok", ip: null });
  assert.equal(s.mails.length, 3, "the fourth request for one email sends nothing");
  await assert.rejects(requestSignup(setup({ captcha: false }).deps, raw, { ipHash: "ip2", captchaToken: null, ip: null }), /not a robot/);
  const many = setup();
  for (let i = 0; i < 6; i++) await requestSignup(many.deps, { ...raw, email: `p${i}@example.com` }, { ipHash: "ipX", captchaToken: "ok", ip: null });
  await assert.rejects(requestSignup(many.deps, { ...raw, email: "p9@example.com" }, { ipHash: "ipX", captchaToken: "ok", ip: null }), /Too many attempts/);
});

test("the verified link leads to the payment page, and a bad one doesn't", async () => {
  const s = setup();
  const token = signSignup(KEY, { email: "pat@example.com", name: "Pat", workspace: "Pat Tax", plan: "ptin" }, "v1", T0);
  assert.match((await startCheckout(s.deps, token)).url, /checkout\.test\/ptin/);
  await assert.rejects(startCheckout(s.deps, "nope"), /expired or isn't valid/);
  await assert.rejects(startCheckout(setup({ exists: true }).deps, token), /already has an account/);
});

test("a paid signup makes the workspace once, even if Stripe repeats the event", async () => {
  const s = setup();
  const r = await handleBillingEvent(s.deps, completed("evt_1"));
  assert.equal(r.status, "processed");
  const sub = s.subs.get(r.tenantId!)!;
  assert.deepEqual([sub.plan, sub.status, sub.stripe_subscription_id], ["ptin", "active", "sub_1"]);
  assert.equal(s.members.get(r.tenantId!)!.length, 1);
  assert.equal(s.mails.length, 1);
  assert.match(s.mails[0].mail.text, /practice\/invite\//);
  assert.equal((await handleBillingEvent(s.deps, completed("evt_1"))).status, "duplicate");
  // Same payment, new event id (a retry after a crash): still one workspace.
  await handleBillingEvent(s.deps, completed("evt_2"));
  assert.equal(s.subs.size, 1);
  assert.equal(s.mails.length, 1);
  assert.equal((await handleBillingEvent(s.deps, { id: "evt_3", type: "charge.refunded", data: { object: {} } })).status, "ignored");
});

test("a renewal that fails suspends; payment restores; the first payment is ignored", async () => {
  const s = setup();
  const { tenantId } = await handleBillingEvent(s.deps, completed("evt_1"));
  const failed = (id: string, reason: string) => ({ id, type: "invoice.payment_failed", data: { object: { subscription: "sub_1", customer: "cus_1", billing_reason: reason } } });
  await handleBillingEvent(s.deps, failed("evt_a", "subscription_create"));
  assert.equal(s.subs.get(tenantId!)!.status, "active");
  await handleBillingEvent(s.deps, failed("evt_b", "subscription_cycle"));
  assert.equal(s.subs.get(tenantId!)!.status, "suspended");
  assert.equal(s.subs.get(tenantId!)!.suspended_at, T0.toISOString());
  assert.match(s.mails.at(-1)!.mail.subject, /payment didn't go through/);
  await handleBillingEvent(s.deps, { id: "evt_c", type: "invoice.paid", data: { object: { subscription: "sub_1", customer: "cus_1" } } });
  assert.equal(s.subs.get(tenantId!)!.status, "active");
  assert.equal(s.subs.get(tenantId!)!.suspended_at, null);
});

test("sweep: suspended → read-only → cancelled with the 90 day clock, retrying payment each day", async () => {
  const s = setup();
  const { tenantId } = await handleBillingEvent(s.deps, completed("evt_1"));
  await handleBillingEvent(s.deps, { id: "evt_b", type: "invoice.payment_failed", data: { object: { subscription: "sub_1", customer: "cus_1", billing_reason: "subscription_cycle" } } });
  s.stripeState.retry = "failed";
  s.tick(3 * DAY);
  let rep = await runBillingSweep(s.deps);
  assert.deepEqual([rep.readOnly, rep.canceled, rep.retried], [0, 0, 1]);
  s.tick((GRACE_DAYS - 3) * DAY);
  rep = await runBillingSweep(s.deps);
  assert.equal(s.subs.get(tenantId!)!.status, "read_only");
  assert.equal(rep.readOnly, 1);
  s.tick(READ_ONLY_DAYS * DAY);
  rep = await runBillingSweep(s.deps);
  const sub = s.subs.get(tenantId!)!;
  assert.equal(sub.status, "canceled");
  assert.equal(rep.canceled, 1);
  assert.deepEqual(s.stripeState.canceled, ["sub_1"]);
  assert.equal(Date.parse(sub.delete_after!) - Date.parse(sub.canceled_at!), RETENTION_DAYS * DAY);
  assert.match(s.mails.at(-1)!.mail.text, /90 days/);
});

test("sweep: the card is checked before renewal and a bad one is warned about once per mark", async () => {
  const s = setup();
  const { tenantId } = await handleBillingEvent(s.deps, completed("evt_1"));
  s.subs.set(tenantId!, { ...s.subs.get(tenantId!)!, current_period_end: iso(T0.getTime() + 7 * DAY - 3600_000) });
  s.stripeState.card = { ok: false, reason: "the card on file expires before then" };
  const before = s.mails.length;
  let rep = await runBillingSweep(s.deps);
  assert.equal(rep.warned, 1);
  assert.equal(s.mails.length, before + 1);
  rep = await runBillingSweep(s.deps);
  assert.equal(rep.warned, 0, "same day, same mark: no second email");
  s.stripeState.card = { ok: true };
  s.tick(2 * DAY);
  rep = await runBillingSweep(s.deps);
  assert.equal(rep.warned, 0);
  assert.equal(s.subs.get(tenantId!)!.precheck_mark, 5);
});

test("pause switches to the $27 price, resume switches back; only good accounts can pause", async () => {
  const s = setup();
  const { tenantId } = await handleBillingEvent(s.deps, completed("evt_1"));
  await pauseWorkspace(s.deps, tenantId!);
  assert.deepEqual(s.prices.at(-1), { sub: "sub_1", key: PAUSE_PLAN.lookupKey });
  assert.equal(s.subs.get(tenantId!)!.status, "paused");
  assert.equal(accessOf(s.subs.get(tenantId!)!), "contacts_only");
  await assert.rejects(pauseWorkspace(s.deps, tenantId!), /already paused/);
  await resumeWorkspace(s.deps, tenantId!);
  assert.deepEqual(s.prices.at(-1), { sub: "sub_1", key: PLANS.ptin.lookupKey });
  assert.equal(s.subs.get(tenantId!)!.status, "active");
  await assert.rejects(resumeWorkspace(s.deps, tenantId!), /isn't paused/);
});

test("cancelling keeps data 90 days; the account can come back until then, by a payment for exactly that workspace", async () => {
  const s = setup();
  const { tenantId } = await handleBillingEvent(s.deps, completed("evt_1"));
  await handleBillingEvent(s.deps, { id: "evt_d", type: "customer.subscription.deleted", data: { object: { object: "subscription", id: "sub_1", customer: "cus_1" } } });
  const sub = s.subs.get(tenantId!)!;
  assert.equal(sub.status, "canceled");
  assert.equal(accessOf(sub), "closed");
  assert.match((await startReactivation(s.deps, tenantId!, "pat@example.com")).url, /back/);
  await handleBillingEvent(s.deps, { id: "evt_r", type: "checkout.session.completed", data: { object: { mode: "subscription", payment_status: "paid", subscription: "sub_2", customer: "cus_1", metadata: { kind: "reactivate", tenant_id: tenantId } } } });
  assert.equal(s.subs.get(tenantId!)!.status, "active");
  assert.equal(s.subs.get(tenantId!)!.stripe_subscription_id, "sub_2");
  // After the retention period it can't come back.
  await handleBillingEvent(s.deps, { id: "evt_d2", type: "customer.subscription.deleted", data: { object: { object: "subscription", id: "sub_2", customer: "cus_1" } } });
  s.tick((RETENTION_DAYS + 1) * DAY);
  await assert.rejects(startReactivation(s.deps, tenantId!, "pat@example.com"), /data has been removed/);
});

test("a reactivation payment can't revive another workspace or an account that isn't cancelled", async () => {
  const s = setup();
  const { tenantId } = await handleBillingEvent(s.deps, completed("evt_1"));
  await handleBillingEvent(s.deps, { id: "evt_x", type: "checkout.session.completed", data: { object: { mode: "subscription", payment_status: "paid", subscription: "sub_9", customer: "cus_9", metadata: { kind: "reactivate", tenant_id: tenantId } } } });
  assert.equal(s.subs.get(tenantId!)!.stripe_subscription_id, "sub_1", "an active account isn't touched");
});
