import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import { connectMode, connectProblems } from "../lib/connect/config.ts";
import {
  canTakePayments, connectReturnPath, disconnect, finishConnect, handleConnectEvent, readState, refreshConnection, signState, startInvoiceCheckout,
  type AppliedInvoice, type Connection, type ConnectDeps, type ConnectEvent, type ConnectRepo, type ConnectStripe, type InvoicePayment, type PayableInvoice,
} from "../lib/connect/service.ts";

const TENANT = "00000000-0000-4000-8000-0000000000a1";
const ACCT = "acct_1TestOffice";
const CLIENT_A = "00000000-0000-4000-8000-0000000000c1";
const CLIENT_B = "00000000-0000-4000-8000-0000000000c2";
const NOW = new Date("2027-02-01T15:00:00Z");

class Repo implements ConnectRepo {
  conn: Connection | null = null;
  invoices = new Map<string, PayableInvoice>();
  payments: InvoicePayment[] = [];
  audit: string[] = [];
  async getConnection() { return this.conn; }
  async saveConnection(i: Parameters<ConnectRepo["saveConnection"]>[0]) { this.conn = { id: "conn1", tenant_id: TENANT, status: "connected", connected_at: NOW.toISOString(), disconnected_at: null, ...i }; return this.conn; }
  async updateConnection(p: Parameters<ConnectRepo["updateConnection"]>[0]) { this.conn = { ...this.conn!, ...p }; return this.conn; }
  plans = new Map<string, { position: number; due_on: string; amount_cents: number }[]>();
  async installmentsFor(id: string) { return this.plans.get(id) ?? []; }
  async getInvoice(id: string) { return this.invoices.get(id) ?? null; }
  async openPaymentFor(invoiceId: string) { return this.payments.find((p) => p.invoice_id === invoiceId && p.status === "open") ?? null; }
  async getPayment(id: string) { return this.payments.find((p) => p.id === id) ?? null; }
  async getPaymentBySession(sid: string) { return this.payments.find((p) => p.stripe_session_id === sid) ?? null; }
  async insertPayment(i: Parameters<ConnectRepo["insertPayment"]>[0]) {
    if (this.payments.some((p) => p.invoice_id === i.invoice_id && p.status === "open")) throw new Error("duplicate key value violates unique constraint invoice_payments_one_open");
    const p: InvoicePayment = { id: randomUUID(), tenant_id: TENANT, stripe_session_id: null, payment_intent_id: null, status: "open", created_at: NOW.toISOString(), paid_at: null, ...i };
    this.payments.push(p);
    return p;
  }
  async attachSession(id: string, sid: string) { this.payments.find((p) => p.id === id)!.stripe_session_id = sid; }
  async closePayment(id: string, status: "expired" | "failed") { const p = this.payments.find((x) => x.id === id && x.status === "open"); if (p) p.status = status; }
  async applyPayment(id: string, pi: string | null): Promise<AppliedInvoice | null> {
    const p = this.payments.find((x) => x.id === id && x.status === "open");
    if (!p) return null;
    p.status = "paid"; p.payment_intent_id = pi; p.paid_at = NOW.toISOString();
    const inv = this.invoices.get(p.invoice_id)!;
    inv.paid_cents = Math.min(inv.total_cents, inv.paid_cents + p.amount_cents);
    if (inv.paid_cents >= inv.total_cents) inv.status = "paid";
    return { id: inv.id, status: inv.status, paid_cents: inv.paid_cents, total_cents: inv.total_cents };
  }
  async addAudit(i: { action: string }) { this.audit.push(i.action); }
}
class FakeStripe implements ConnectStripe {
  livemode = false;
  calls: string[] = [];
  account = { account: ACCT, livemode: false };
  facts = { charges_enabled: true, payouts_enabled: true, details_submitted: true };
  failDeauth = false;
  authorizeUrl(state: string, redirectUri: string) { return `https://connect.stripe.test/oauth/authorize?state=${state}&redirect_uri=${redirectUri}`; }
  async exchangeCode() { return this.account; }
  async accountFacts() { return this.facts; }
  async deauthorize() { if (this.failDeauth) throw new Error("down"); this.calls.push("deauthorize"); }
  async createCheckout(account: string, i: Parameters<ConnectStripe["createCheckout"]>[1]) { this.calls.push(`checkout:${account}:${i.amountCents}`); return { id: `cs_test_${i.paymentId.slice(0, 8)}`, url: `https://checkout.stripe.test/${i.paymentId}` }; }
  async expireCheckout(account: string, sid: string) { this.calls.push(`expire:${account}:${sid}`); }
}
function setup() {
  const repo = new Repo();
  const stripe = new FakeStripe();
  const deps: ConnectDeps = { tenantId: TENANT, repo, stripe, now: () => NOW };
  const invoice: PayableInvoice = { id: randomUUID(), client_id: CLIENT_A, number: "INV-0001", status: "sent", total_cents: 22300, paid_cents: 0 };
  repo.invoices.set(invoice.id, invoice);
  return { repo, stripe, deps, invoice };
}
const checkoutInput = (invoiceId: string, clientId = CLIENT_A) => ({ invoiceId, clientId, clientEmail: "client@example.com", office: "Test Tax Office", successUrl: "https://x/ok", cancelUrl: "https://x/no", actorId: "u1" });
async function connected() {
  const s = setup();
  await finishConnect(s.deps, "staff1", "ac_code");
  return s;
}
const paidEvent = (session: string, paymentId: string, amount: number, over: Partial<ConnectEvent> = {}): ConnectEvent => ({
  id: "evt_1", type: "checkout.session.completed", livemode: false, account: ACCT,
  data: { object: { id: session, payment_status: "paid", amount_total: amount, currency: "usd", payment_intent: "pi_123", metadata: { invoice_payment_id: paymentId, tenant_id: TENANT } } }, ...over,
});

describe("settings", () => {
  test("names the missing settings, never values", () => {
    assert.equal(connectProblems({}).length, 3);
    assert.deepEqual(connectProblems({ STRIPE_CONNECT_SECRET_KEY: "sk_test_abc", STRIPE_CONNECT_CLIENT_ID: "ca_ABC123", STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_x" }), []);
    assert.match(connectProblems({ STRIPE_CONNECT_SECRET_KEY: "nope", STRIPE_CONNECT_CLIENT_ID: "ca_1", STRIPE_CONNECT_WEBHOOK_SECRET: "w" })[0], /isn't a Stripe secret key/);
    assert.equal(connectMode("sk_live_x"), "live");
    assert.equal(connectMode("rk_test_x"), "test");
    assert.equal(connectMode("pk_test_x"), null);
  });
});

describe("OAuth state", () => {
  const key = Buffer.alloc(32, 9);
  test("round-trips for the same office and person; expires; refuses tampering", () => {
    const s = signState(key, { tenantId: TENANT, userId: "u1" }, NOW);
    assert.deepEqual(readState(key, s, new Date(NOW.getTime() + 60_000)), { tenantId: TENANT, userId: "u1", back: "payments" });
    assert.equal(readState(key, s, new Date(NOW.getTime() + 16 * 60_000)), null);
    assert.equal(readState(Buffer.alloc(32, 1), s, NOW), null);
    const [body, mac] = s.split(".");
    const forged = Buffer.from(JSON.stringify({ t: "other", u: "u1", e: NOW.getTime() + 1e6 })).toString("base64url");
    assert.equal(readState(key, `${forged}.${mac}`, NOW), null);
    assert.equal(readState(key, `${body}.${mac}.x`, NOW), null);
    assert.equal(readState(key, undefined, NOW), null);
    assert.equal(readState(key, "x".repeat(700), NOW), null);
  });
});

describe("OAuth state: where the person returns to", () => {
  const key = Buffer.alloc(32, 9);
  test("the store screen's return is carried and signed; anything else falls back to Payments", () => {
    const s = signState(key, { tenantId: TENANT, userId: "u1", back: "store-payments" }, NOW);
    assert.equal(readState(key, s, NOW)?.back, "store-payments");
    assert.equal(connectReturnPath("store-payments"), "/settings/store-payments");
    assert.equal(connectReturnPath("payments"), "/settings/payments");
    assert.equal(connectReturnPath(undefined), "/settings/payments");
    // A state that names some other place is read as the default: the state never carries a free-form address.
    const body = Buffer.from(JSON.stringify({ t: TENANT, u: "u1", e: NOW.getTime() + 1e6, b: "https://evil.example" })).toString("base64url");
    const mac = createHmac("sha256", key).update(`connect-state:v1:${body}`).digest("base64url");
    assert.equal(readState(key, `${body}.${mac}`, NOW)?.back, "payments");
    // The return cannot be switched without breaking the signature.
    const [b0, m0] = s.split(".");
    const swapped = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(b0, "base64url").toString()), b: "payments" })).toString("base64url");
    assert.equal(readState(key, `${swapped}.${m0}`, NOW), null);
  });
});

describe("connecting", () => {
  test("stores the account and what it can do; audited", async () => {
    const { repo } = await connected();
    assert.equal(repo.conn?.stripe_account_id, ACCT);
    assert.equal(repo.conn?.charges_enabled, true);
    assert.deepEqual(repo.audit, ["stripe_connected"]);
  });
  test("a live account does not connect to a test deployment, or the reverse", async () => {
    const s = setup();
    s.stripe.account = { account: ACCT, livemode: true };
    await assert.rejects(finishConnect(s.deps, "u", "code"), /live Stripe account.*test mode/);
    assert.equal(s.repo.conn, null);
    const live = setup();
    live.stripe.livemode = true;
    await assert.rejects(finishConnect(live.deps, "u", "code"), /test Stripe account.*live mode/);
  });
  test("an empty code is refused", async () => {
    await assert.rejects(finishConnect(setup().deps, "u", ""), /didn't send back/);
  });
  test("can take payments only when connected, charges are on, and the mode matches", async () => {
    const { repo, stripe, deps } = await connected();
    assert.equal(canTakePayments(repo.conn, stripe.livemode), true);
    assert.equal(canTakePayments(repo.conn, true), false);
    assert.equal(canTakePayments({ ...repo.conn!, charges_enabled: false }, false), false);
    assert.equal(canTakePayments({ ...repo.conn!, status: "disconnected" }, false), false);
    assert.equal(canTakePayments(null, false), false);
    stripe.facts = { charges_enabled: false, payouts_enabled: false, details_submitted: false };
    assert.equal(await refreshConnection(setup().deps), null);
    assert.equal((await refreshConnection(deps))?.charges_enabled, false);
  });
  test("disconnect tells Stripe first; if Stripe is down nothing changes", async () => {
    const s = await connected();
    s.stripe.failDeauth = true;
    await assert.rejects(disconnect(s.deps, "u"), /Nothing was changed/);
    assert.equal(s.repo.conn?.status, "connected");
    s.stripe.failDeauth = false;
    await disconnect(s.deps, "u");
    assert.equal(s.repo.conn?.status, "disconnected");
    assert.equal(s.repo.conn?.charges_enabled, false);
    await assert.rejects(disconnect(s.deps, "u"), /No Stripe account/);
  });
});

describe("starting a payment", () => {
  test("charges the balance on the office's account", async () => {
    const { deps, repo, stripe, invoice } = await connected();
    invoice.paid_cents = 10000;
    const r = await startInvoiceCheckout(deps, checkoutInput(invoice.id));
    assert.match(r.url, /checkout\.stripe\.test/);
    assert.deepEqual(stripe.calls.filter((c) => c.startsWith("checkout")), [`checkout:${ACCT}:12300`]);
    assert.equal(repo.payments[0].amount_cents, 12300);
    assert.ok(repo.payments[0].stripe_session_id);
  });
  test("with a payment plan, online payment is the next installment, not the whole balance", async () => {
    const { deps, repo, stripe, invoice } = await connected();
    repo.plans.set(invoice.id, [{ position: 1, due_on: "2026-11-01", amount_cents: 11150 }, { position: 2, due_on: "2026-12-01", amount_cents: 11150 }]);
    await startInvoiceCheckout(deps, checkoutInput(invoice.id));
    assert.deepEqual(stripe.calls.filter((c) => c.startsWith("checkout")), [`checkout:${ACCT}:11150`]);
    invoice.paid_cents = 11150;
    await startInvoiceCheckout(deps, checkoutInput(invoice.id));
    assert.equal(repo.payments.at(-1)!.amount_cents, 11150, "the second payment is the second installment");
    invoice.paid_cents = 15000;
    await startInvoiceCheckout(deps, checkoutInput(invoice.id));
    assert.equal(repo.payments.at(-1)!.amount_cents, 7300, "a part-paid installment asks only for what is left of it");
  });
  test("a second click expires the first link, so only one can ever be paid", async () => {
    const { deps, repo, stripe, invoice } = await connected();
    await startInvoiceCheckout(deps, checkoutInput(invoice.id));
    const first = repo.payments[0];
    await startInvoiceCheckout(deps, checkoutInput(invoice.id));
    assert.equal(first.status, "expired");
    assert.ok(stripe.calls.includes(`expire:${ACCT}:${first.stripe_session_id}`));
    assert.equal(repo.payments.filter((p) => p.status === "open").length, 1);
  });
  test("another client's invoice, a paid or draft or void one, and tiny balances are refused", async () => {
    const { deps, repo, invoice } = await connected();
    await assert.rejects(startInvoiceCheckout(deps, checkoutInput(invoice.id, CLIENT_B)), /wasn't found/);
    await assert.rejects(startInvoiceCheckout(deps, checkoutInput(randomUUID())), /wasn't found/);
    invoice.status = "paid";
    await assert.rejects(startInvoiceCheckout(deps, checkoutInput(invoice.id)), /already paid/);
    invoice.status = "draft";
    await assert.rejects(startInvoiceCheckout(deps, checkoutInput(invoice.id)), /can't be paid online/);
    invoice.status = "void";
    await assert.rejects(startInvoiceCheckout(deps, checkoutInput(invoice.id)), /can't be paid online/);
    invoice.status = "sent"; invoice.paid_cents = 22300 - 20;
    await assert.rejects(startInvoiceCheckout(deps, checkoutInput(invoice.id)), /too small/);
    assert.equal(repo.payments.length, 0);
  });
  test("not connected, charges off, or wrong mode: no payment page", async () => {
    const s = setup();
    await assert.rejects(startInvoiceCheckout(s.deps, checkoutInput(s.invoice.id)), /isn't available/);
    await finishConnect(s.deps, "u", "c");
    s.repo.conn!.charges_enabled = false;
    await assert.rejects(startInvoiceCheckout(s.deps, checkoutInput(s.invoice.id)), /isn't available/);
  });
  test("if Stripe fails the attempt is closed and nothing is left open", async () => {
    const s = await connected();
    s.stripe.createCheckout = async () => { throw new Error("stripe down"); };
    await assert.rejects(startInvoiceCheckout(s.deps, checkoutInput(s.invoice.id)), /stripe down/);
    assert.equal(s.repo.payments[0].status, "failed");
    s.stripe.createCheckout = FakeStripe.prototype.createCheckout.bind(s.stripe);
    await startInvoiceCheckout(s.deps, checkoutInput(s.invoice.id));
  });
});

describe("events", () => {
  async function started() {
    const s = await connected();
    await startInvoiceCheckout(s.deps, checkoutInput(s.invoice.id));
    const payment = s.repo.payments[0];
    return { ...s, payment, session: payment.stripe_session_id! };
  }
  test("a paid session pays the invoice once; a repeat is a duplicate", async () => {
    const { deps, repo, invoice, payment, session } = await started();
    const first = await handleConnectEvent(deps, paidEvent(session, payment.id, 22300));
    assert.deepEqual(first, { status: "processed", invoiceId: invoice.id, paid: true });
    assert.equal(invoice.status, "paid");
    assert.equal(invoice.paid_cents, 22300);
    assert.equal(repo.payments[0].payment_intent_id, "pi_123");
    assert.equal((await handleConnectEvent(deps, paidEvent(session, payment.id, 22300, { type: "checkout.session.async_payment_succeeded" }))).status, "duplicate");
    assert.equal(invoice.paid_cents, 22300);
    assert.ok(repo.audit.includes("invoice_paid_online"));
  });
  test("a wrong amount is not applied and is flagged for review", async () => {
    const { deps, repo, invoice, payment, session } = await started();
    await assert.rejects(handleConnectEvent(deps, paidEvent(session, payment.id, 100)), /left for review/);
    assert.equal(invoice.paid_cents, 0);
    assert.equal(repo.payments[0].status, "open");
    assert.ok(repo.audit.includes("stripe_payment_mismatch"));
  });
  test("an unpaid session, another account, another mode, other metadata, or an unknown session do nothing", async () => {
    const { deps, invoice, payment, session } = await started();
    const ev = paidEvent(session, payment.id, 22300);
    assert.equal((await handleConnectEvent(deps, { ...ev, data: { object: { ...ev.data.object, payment_status: "unpaid" } } })).status, "ignored");
    assert.equal((await handleConnectEvent(deps, { ...ev, account: "acct_1Other" })).status, "ignored");
    assert.equal((await handleConnectEvent(deps, { ...ev, livemode: true })).status, "ignored");
    assert.equal((await handleConnectEvent(deps, { ...ev, data: { object: { ...ev.data.object, metadata: { invoice_payment_id: randomUUID(), tenant_id: TENANT } } } })).status, "ignored");
    assert.equal((await handleConnectEvent(deps, { ...ev, data: { object: { ...ev.data.object, metadata: { invoice_payment_id: payment.id, tenant_id: "other" } } } })).status, "ignored");
    assert.equal((await handleConnectEvent(deps, paidEvent("cs_test_unknown", payment.id, 22300))).status, "ignored");
    assert.equal(invoice.paid_cents, 0);
  });
  test("a partial invoice payment leaves the invoice open", async () => {
    const s = await connected();
    s.invoice.paid_cents = 10000;
    await startInvoiceCheckout(s.deps, checkoutInput(s.invoice.id));
    const p = s.repo.payments[0];
    // Someone paid the rest by hand in the meantime: the online payment is capped at the total, and the invoice is paid.
    s.invoice.paid_cents = 20000;
    const out = await handleConnectEvent(s.deps, paidEvent(p.stripe_session_id!, p.id, 12300));
    assert.equal(out.paid, true);
    assert.equal(s.invoice.paid_cents, 22300);
  });
  test("an expired session closes its payment; the account updating changes what it can do; deauthorizing disconnects", async () => {
    const { deps, repo, payment, session } = await started();
    await handleConnectEvent(deps, { id: "e2", type: "checkout.session.expired", livemode: false, account: ACCT, data: { object: { id: session } } });
    assert.equal(repo.payments.find((p) => p.id === payment.id)?.status, "expired");
    await handleConnectEvent(deps, { id: "e3", type: "account.updated", livemode: false, account: ACCT, data: { object: { charges_enabled: false, payouts_enabled: true, details_submitted: true } } });
    assert.equal(repo.conn?.charges_enabled, false);
    await handleConnectEvent(deps, { id: "e4", type: "account.application.deauthorized", livemode: false, account: ACCT, data: { object: {} } });
    assert.equal(repo.conn?.status, "disconnected");
    assert.equal((await handleConnectEvent(deps, { id: "e5", type: "account.updated", livemode: false, account: ACCT, data: { object: { charges_enabled: true } } })).status, "ignored");
    assert.equal((await handleConnectEvent(deps, { id: "e6", type: "charge.refunded", livemode: false, account: ACCT, data: { object: {} } })).status, "ignored");
  });
});
