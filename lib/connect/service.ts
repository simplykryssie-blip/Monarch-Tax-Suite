import { createHmac, timingSafeEqual } from "node:crypto";
import { ValidationError } from "../commerce/validation.ts";

// Online invoice payments through Stripe Connect (Standard accounts, direct charges). The platform account is Verexa
// HQ's. An office connects its own Stripe account with Stripe's authorization screen; a client's payment is then created
// on THAT account, so the money lands with the office and never passes through the platform. The platform takes no fee.
// Everything here is pure: Stripe and the database are reached through the ports below.

export type Connection = {
  id: string; tenant_id: string; stripe_account_id: string; livemode: boolean; status: "connected" | "disconnected";
  charges_enabled: boolean; payouts_enabled: boolean; details_submitted: boolean; connected_at: string; disconnected_at: string | null;
};
export type InvoicePayment = {
  id: string; tenant_id: string; invoice_id: string; client_id: string; stripe_account_id: string; stripe_session_id: string | null; payment_intent_id: string | null;
  amount_cents: number; status: "open" | "paid" | "expired" | "failed"; created_at: string; paid_at: string | null;
};
export type PayableInvoice = { id: string; client_id: string; number: string; status: string; total_cents: number; paid_cents: number };
export type AppliedInvoice = { id: string; status: string; paid_cents: number; total_cents: number };

/** The office's own rows. */
export interface ConnectRepo {
  getConnection(): Promise<Connection | null>;
  saveConnection(input: { stripe_account_id: string; livemode: boolean; connected_by: string | null; charges_enabled: boolean; payouts_enabled: boolean; details_submitted: boolean }): Promise<Connection>;
  updateConnection(patch: Partial<Pick<Connection, "charges_enabled" | "payouts_enabled" | "details_submitted" | "status" | "disconnected_at">>): Promise<Connection>;
  getInvoice(id: string): Promise<PayableInvoice | null>;
  openPaymentFor(invoiceId: string): Promise<InvoicePayment | null>;
  getPayment(id: string): Promise<InvoicePayment | null>;
  getPaymentBySession(sessionId: string): Promise<InvoicePayment | null>;
  /** Fails (unique) when an open payment for the invoice already exists. */
  insertPayment(input: { invoice_id: string; client_id: string; stripe_account_id: string; amount_cents: number; created_by: string | null }): Promise<InvoicePayment>;
  attachSession(id: string, sessionId: string): Promise<void>;
  closePayment(id: string, status: "expired" | "failed"): Promise<void>;
  /** Atomic: marks an open payment paid and adds it to the invoice. Null when it was not open (already applied). */
  applyPayment(id: string, paymentIntent: string | null): Promise<AppliedInvoice | null>;
  addAudit(input: { actor_id: string | null; action: string; subject_type: string; subject_id: string; detail?: Record<string, unknown> }): Promise<void>;
}

export type AccountFacts = { charges_enabled: boolean; payouts_enabled: boolean; details_submitted: boolean };
/** What is asked of Stripe. */
export interface ConnectStripe {
  livemode: boolean;
  authorizeUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string): Promise<{ account: string; livemode: boolean }>;
  accountFacts(account: string): Promise<AccountFacts>;
  deauthorize(account: string): Promise<void>;
  createCheckout(account: string, input: { amountCents: number; description: string; customerEmail: string | null; paymentId: string; invoiceId: string; tenantId: string; successUrl: string; cancelUrl: string }): Promise<{ id: string; url: string }>;
  expireCheckout(account: string, sessionId: string): Promise<void>;
}
export type ConnectDeps = { tenantId: string; repo: ConnectRepo; stripe: ConnectStripe; now?: () => Date };
const nowOf = (d: { now?: () => Date }) => (d.now ? d.now() : new Date());
const fail = (m: string): never => { throw new ValidationError(m); };

// ------------------------------------------------------------ OAuth state

const STATE_MINUTES = 15;
/** Where the person is sent back to after Stripe's authorization screen. A fixed list: the state never carries a free-form address. */
export const CONNECT_RETURNS = ["payments", "store-payments"] as const;
export type ConnectReturn = (typeof CONNECT_RETURNS)[number];
export const connectReturnPath = (back: ConnectReturn | undefined): string => (back === "store-payments" ? "/settings/store-payments" : "/settings/payments");

/** A signed, short-lived value that ties Stripe's redirect back to the office and the person who started it. */
export function signState(key: Buffer, input: { tenantId: string; userId: string; back?: ConnectReturn }, now: Date = new Date()): string {
  const body = Buffer.from(JSON.stringify({ t: input.tenantId, u: input.userId, e: now.getTime() + STATE_MINUTES * 60_000, ...(input.back ? { b: input.back } : {}) })).toString("base64url");
  return `${body}.${createHmac("sha256", key).update(`connect-state:v1:${body}`).digest("base64url")}`;
}
export function readState(key: Buffer, state: unknown, now: Date = new Date()): { tenantId: string; userId: string; back: ConnectReturn } | null {
  if (typeof state !== "string" || state.length > 600) return null;
  const [body, mac, extra] = state.split(".");
  if (!body || !mac || extra !== undefined) return null;
  const want = createHmac("sha256", key).update(`connect-state:v1:${body}`).digest();
  let got: Buffer;
  try { got = Buffer.from(mac, "base64url"); } catch { return null; }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const v = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { t?: unknown; u?: unknown; e?: unknown; b?: unknown };
    if (typeof v.t !== "string" || typeof v.u !== "string" || typeof v.e !== "number" || v.e < now.getTime()) return null;
    const back = (CONNECT_RETURNS as readonly unknown[]).includes(v.b) ? (v.b as ConnectReturn) : "payments";
    return { tenantId: v.t, userId: v.u, back };
  } catch {
    return null;
  }
}

// -------------------------------------------------------------- connecting

/** Finishes the authorization: stores which Stripe account the office connected. Test accounts only connect to test deployments. */
export async function finishConnect(deps: ConnectDeps, userId: string, code: string): Promise<Connection> {
  if (!code || code.length > 300) fail("Stripe didn't send back an authorization. Try connecting again.");
  const { account, livemode } = await deps.stripe.exchangeCode(code);
  if (livemode !== deps.stripe.livemode) fail(`That is a ${livemode ? "live" : "test"} Stripe account, but this deployment uses ${deps.stripe.livemode ? "live" : "test"} mode. Connect a ${deps.stripe.livemode ? "live" : "test"} account.`);
  const facts = await deps.stripe.accountFacts(account);
  const conn = await deps.repo.saveConnection({ stripe_account_id: account, livemode, connected_by: userId, ...facts });
  await deps.repo.addAudit({ actor_id: userId, action: "stripe_connected", subject_type: "payment_connection", subject_id: conn.id, detail: { livemode, charges_enabled: facts.charges_enabled } });
  return conn;
}

/** Re-reads what Stripe says the connected account can do. */
export async function refreshConnection(deps: ConnectDeps): Promise<Connection | null> {
  const c = await deps.repo.getConnection();
  if (!c || c.status !== "connected") return c;
  return deps.repo.updateConnection(await deps.stripe.accountFacts(c.stripe_account_id));
}

export async function disconnect(deps: ConnectDeps, userId: string): Promise<void> {
  const c = await deps.repo.getConnection();
  if (!c || c.status !== "connected") fail("No Stripe account is connected.");
  const conn = c!;
  // If Stripe can't be reached the connection stays as it was and the person tries again.
  await deps.stripe.deauthorize(conn.stripe_account_id).catch(() => { fail("Stripe couldn't be reached to disconnect. Nothing was changed; try again."); });
  await deps.repo.updateConnection({ status: "disconnected", charges_enabled: false, payouts_enabled: false, disconnected_at: nowOf(deps).toISOString() });
  await deps.repo.addAudit({ actor_id: userId, action: "stripe_disconnected", subject_type: "payment_connection", subject_id: conn.id });
}

/** Whether invoices can be paid online right now. */
export const canTakePayments = (c: Connection | null, stripeLivemode: boolean): boolean => Boolean(c && c.status === "connected" && c.charges_enabled && c.livemode === stripeLivemode);

// ------------------------------------------------------- paying an invoice

/** Cents Stripe can charge in USD: at least 50. */
export const MIN_CHARGE_CENTS = 50;

/**
 * Starts a Checkout Session on the office's account for what is still owed on one of the client's invoices. An earlier
 * open session for the same invoice is expired first, so two pay links can never both be paid.
 */
export async function startInvoiceCheckout(
  deps: ConnectDeps,
  input: { invoiceId: string; clientId: string; clientEmail: string | null; office: string; successUrl: string; cancelUrl: string; actorId: string | null },
): Promise<{ url: string; paymentId: string }> {
  const conn = await deps.repo.getConnection();
  if (!canTakePayments(conn, deps.stripe.livemode)) fail("Online payment isn't available right now. Please pay your tax office another way.");
  const invoice = await deps.repo.getInvoice(input.invoiceId);
  // The invoice must be this client's own: a portal user can only ever pay their own.
  if (!invoice || invoice.client_id !== input.clientId) fail("That invoice wasn't found.");
  const inv = invoice!;
  if (inv.status !== "sent") fail(inv.status === "paid" ? "That invoice is already paid." : "That invoice can't be paid online.");
  const owed = inv.total_cents - inv.paid_cents;
  if (owed <= 0) fail("That invoice is already paid.");
  if (owed < MIN_CHARGE_CENTS) fail("The balance is too small to pay online. Please pay your tax office another way.");
  const account = conn!.stripe_account_id;
  const previous = await deps.repo.openPaymentFor(inv.id);
  if (previous) {
    if (previous.stripe_session_id) await deps.stripe.expireCheckout(account, previous.stripe_session_id).catch(() => undefined);
    await deps.repo.closePayment(previous.id, "expired");
  }
  const payment = await deps.repo.insertPayment({ invoice_id: inv.id, client_id: inv.client_id, stripe_account_id: account, amount_cents: owed, created_by: input.actorId });
  try {
    const session = await deps.stripe.createCheckout(account, {
      amountCents: owed, description: `Invoice ${inv.number} (${input.office})`, customerEmail: input.clientEmail, paymentId: payment.id, invoiceId: inv.id, tenantId: deps.tenantId,
      successUrl: input.successUrl, cancelUrl: input.cancelUrl,
    });
    await deps.repo.attachSession(payment.id, session.id);
    return { url: session.url, paymentId: payment.id };
  } catch (e) {
    await deps.repo.closePayment(payment.id, "failed");
    throw e;
  }
}

// ------------------------------------------------------------------ events

export type ConnectEvent = {
  id: string; type: string; livemode: boolean; account?: string;
  data: { object: { id?: string; payment_status?: string; amount_total?: number | null; currency?: string | null; payment_intent?: string | { id?: string } | null; metadata?: Record<string, string> | null; charges_enabled?: boolean; payouts_enabled?: boolean; details_submitted?: boolean } };
};
export type EventOutcome = { status: "processed" | "ignored" | "duplicate"; invoiceId?: string; paid?: boolean };

/**
 * Applies one verified Connect event for one office. A paid session is applied to its invoice once: the amount must be
 * exactly what the payment was created for, the session must be the payment's own, and a repeat does nothing.
 */
export async function handleConnectEvent(deps: ConnectDeps, event: ConnectEvent): Promise<EventOutcome> {
  const conn = await deps.repo.getConnection();
  if (!conn || conn.status !== "connected" || conn.stripe_account_id !== event.account) return { status: "ignored" };
  if (event.livemode !== conn.livemode) return { status: "ignored" };
  const obj = event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      if (obj.payment_status !== "paid" || !obj.id) return { status: "ignored" };
      const payment = await deps.repo.getPaymentBySession(obj.id);
      if (!payment) return { status: "ignored" };
      if (obj.metadata?.invoice_payment_id !== payment.id || obj.metadata?.tenant_id !== deps.tenantId) return { status: "ignored" };
      if (payment.status === "paid") return { status: "duplicate", invoiceId: payment.invoice_id };
      if (obj.amount_total !== payment.amount_cents || (obj.currency ?? "").toLowerCase() !== "usd") {
        await deps.repo.addAudit({ actor_id: null, action: "stripe_payment_mismatch", subject_type: "invoice_payment", subject_id: payment.id, detail: { expected: payment.amount_cents, got: obj.amount_total ?? null } });
        throw new Error(`Payment ${payment.id} does not match its invoice payment; left for review.`);
      }
      const pi = typeof obj.payment_intent === "string" ? obj.payment_intent : obj.payment_intent?.id ?? null;
      const invoice = await deps.repo.applyPayment(payment.id, pi);
      if (!invoice) return { status: "duplicate", invoiceId: payment.invoice_id };
      await deps.repo.addAudit({ actor_id: null, action: "invoice_paid_online", subject_type: "invoice_payment", subject_id: payment.id, detail: { invoice_id: payment.invoice_id, amount_cents: payment.amount_cents } });
      return { status: "processed", invoiceId: invoice.id, paid: invoice.status === "paid" };
    }
    case "checkout.session.expired": {
      if (!obj.id) return { status: "ignored" };
      const payment = await deps.repo.getPaymentBySession(obj.id);
      if (!payment || payment.status !== "open") return { status: "ignored" };
      await deps.repo.closePayment(payment.id, "expired");
      return { status: "processed", invoiceId: payment.invoice_id };
    }
    case "account.updated": {
      await deps.repo.updateConnection({ charges_enabled: Boolean(obj.charges_enabled), payouts_enabled: Boolean(obj.payouts_enabled), details_submitted: Boolean(obj.details_submitted) });
      return { status: "processed" };
    }
    case "account.application.deauthorized": {
      await deps.repo.updateConnection({ status: "disconnected", charges_enabled: false, payouts_enabled: false, disconnected_at: nowOf(deps).toISOString() });
      await deps.repo.addAudit({ actor_id: null, action: "stripe_disconnected_by_office", subject_type: "payment_connection", subject_id: conn.id });
      return { status: "processed" };
    }
    default:
      return { status: "ignored" };
  }
}
