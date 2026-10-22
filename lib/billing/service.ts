import { createHash } from "node:crypto";
import { ValidationError } from "../commerce/validation.ts";
import { hashToken, INVITE_DAYS, newToken } from "../office/service.ts";
import { slugFor, type PracticeRepo } from "../practice/service.ts";
import { deleteAfter, lateReminderDue, LATE_DAYS, nextStep, precheckDue, RETENTION_DAYS, type SubStatus, type Subscription } from "./access.ts";
import { PAUSE_PLAN, PLANS, dollars, isPlanKey, type PlanKey } from "./plans.ts";
import { cleanSignup, existingAccountEmail, signSignup, readSignup, verificationEmail, type SignupClaims } from "./signup.ts";

// Subscriptions for workspaces: signing up, what a Stripe event changes, pausing, and the daily sweep that moves late
// accounts along (read-only → cancelled) and warns before a renewal that may fail. Everything reaches the
// outside world through the ports below, so the rules can be tested without Stripe, a database or email.

export interface BillingRepo {
  byTenant(tenantId: string): Promise<Subscription | null>;
  bySubscription(subscriptionId: string): Promise<Subscription | null>;
  byCustomer(customerId: string): Promise<Subscription | null>;
  insert(sub: Omit<Subscription, "created_at" | "updated_at">): Promise<Subscription>;
  update(tenantId: string, patch: Partial<Omit<Subscription, "tenant_id" | "created_at" | "updated_at">>): Promise<Subscription>;
  eventSeen(eventId: string): Promise<boolean>;
  recordEvent(eventId: string, tenantId: string, type: string): Promise<void>;
  /** Accounts the daily sweep looks at. */
  sweepList(): Promise<Subscription[]>;
}

export type SubscriptionFacts = { status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; lookupKey: string | null; customerId: string };
export interface BillingStripe {
  signupCheckout(i: { plan: PlanKey; email: string; claims: { name: string; workspace: string; terms: string }; successUrl: string; cancelUrl: string; idempotencyKey: string }): Promise<{ url: string }>;
  reactivateCheckout(i: { tenantId: string; plan: PlanKey; customerId: string | null; email: string; successUrl: string; cancelUrl: string; idempotencyKey: string }): Promise<{ url: string }>;
  portalUrl(customerId: string, returnUrl: string): Promise<string>;
  /** Moves the subscription to another price (by lookup key) from the next renewal, with no charge now. */
  setPrice(subscriptionId: string, lookupKey: string): Promise<void>;
  subscriptionFacts(subscriptionId: string): Promise<SubscriptionFacts>;
  /** Whether the customer's card is good for the renewal date. */
  cardCheck(customerId: string, renewalIso: string): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Tries to collect the open invoice of a subscription, if there is one. */
  retryOpenInvoice(subscriptionId: string): Promise<"none" | "paid" | "failed">;
  cancelNow(subscriptionId: string): Promise<void>;
}

export type Mail = { subject: string; text: string; /** The email's main step, shown as a button. */ action?: { label: string; url: string } };
export type BillingDeps = {
  repo: BillingRepo;
  stripe: BillingStripe;
  /** The key signup links are signed with. */
  key: Buffer;
  origin: () => Promise<string>;
  /** Provisions a workspace: the platform makes the tenant, the workspace repo is its own. */
  provision: {
    createTenant(input: { slug: string; name: string; tier: "ptin" }): Promise<{ id: string }>;
    tenantBySlug(slug: string): Promise<{ id: string } | null>;
    practiceRepo(tenantId: string): PracticeRepo;
    inviteLink(token: string): Promise<string>;
  };
  accountExists(email: string): Promise<boolean>;
  ownerEmail(tenantId: string): Promise<{ email: string; name: string } | null>;
  /** Sends from the platform's address. Returns a problem in words, or null when sent (or held back outside production). */
  mail(to: string, mail: Mail): Promise<string | null>;
  /** Counts a hit in an hourly window and returns how many so far. */
  hit(bucket: string): Promise<number>;
  captcha(token: string | null, ip: string | null): Promise<boolean>;
  termsVersion: string;
  now?: () => Date;
};
const nowOf = (d: BillingDeps) => (d.now ? d.now() : new Date());
const fail = (m: string): never => { throw new ValidationError(m); };

// ----------------------------------------------------------------- signup

export const SIGNUP_LIMITS = { perIp: 6, perEmail: 3 };
const GENERIC = "If the details are right, we've emailed you a link to confirm your address and continue to payment. It can take a minute; check your spam folder too.";

/** Step one. Always answers the same, so the form can't be used to find out who has an account. */
export async function requestSignup(deps: BillingDeps, raw: Parameters<typeof cleanSignup>[0], who: { ipHash: string | null; captchaToken: string | null; ip: string | null }): Promise<{ message: string }> {
  const input = cleanSignup(raw);
  if (!(await deps.captcha(who.captchaToken, who.ip))) fail("Please complete the check that you're not a robot, then try again.");
  const emailHash = createHash("sha256").update(input.email).digest("hex").slice(0, 32);
  if (who.ipHash && (await deps.hit(`signup:ip:${who.ipHash}`)) > SIGNUP_LIMITS.perIp) fail("Too many attempts from your network. Please try again in an hour.");
  if ((await deps.hit(`signup:email:${emailHash}`)) > SIGNUP_LIMITS.perEmail) return { message: GENERIC };
  const origin = (await deps.origin()).replace(/\/$/, "");
  if (await deps.accountExists(input.email)) {
    await deps.mail(input.email, existingAccountEmail({ name: input.name, link: `${origin}/login` }));
    return { message: GENERIC };
  }
  const token = signSignup(deps.key, input, deps.termsVersion, nowOf(deps));
  await deps.mail(input.email, verificationEmail({ name: input.name, link: `${origin}/signup/verify/${token}` }));
  return { message: GENERIC };
}

export function signupFromLink(deps: BillingDeps, token: unknown): SignupClaims | null {
  return readSignup(deps.key, token, nowOf(deps));
}

/** Step two: the confirmed link leads to the card page. */
export async function startCheckout(deps: BillingDeps, token: unknown): Promise<{ url: string }> {
  const c = signupFromLink(deps, token) ?? fail("This link has expired or isn't valid. Start again from the signup page.");
  if (await deps.accountExists(c.email)) fail("That email already has an account. Sign in instead.");
  const origin = (await deps.origin()).replace(/\/$/, "");
  return deps.stripe.signupCheckout({
    plan: c.plan, email: c.email, claims: { name: c.name, workspace: c.workspace, terms: c.terms },
    successUrl: `${origin}/signup/done?session_id={CHECKOUT_SESSION_ID}`, cancelUrl: `${origin}/signup/verify/${token as string}`,
    // The same link gives the same payment page, so a double click never makes two.
    idempotencyKey: `signup:${createHash("sha256").update(token as string).digest("hex").slice(0, 40)}`,
  });
}

// ------------------------------------------------------------- stripe events

export type BillingEvent = { id: string; type: string; data: { object: Record<string, unknown> } };
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export type EventOutcome = { status: "processed" | "ignored" | "duplicate"; tenantId?: string };

export async function handleBillingEvent(deps: BillingDeps, event: BillingEvent): Promise<EventOutcome> {
  if (await deps.repo.eventSeen(event.id)) return { status: "duplicate" };
  const o = event.data.object;
  let tenantId: string | null = null;
  switch (event.type) {
    case "checkout.session.completed": tenantId = await onCheckoutCompleted(deps, o); break;
    case "invoice.paid": tenantId = await onInvoicePaid(deps, o); break;
    case "invoice.payment_failed": tenantId = await onPaymentFailed(deps, o); break;
    case "customer.subscription.updated": tenantId = await onSubscriptionUpdated(deps, o); break;
    case "customer.subscription.deleted": tenantId = await onSubscriptionDeleted(deps, o); break;
    default: return { status: "ignored" };
  }
  if (!tenantId) return { status: "ignored" };
  await deps.repo.recordEvent(event.id, tenantId, event.type);
  return { status: "processed", tenantId };
}

async function subFor(deps: BillingDeps, o: Record<string, unknown>): Promise<Subscription | null> {
  // An invoice names its subscription directly or, in newer Stripe versions, under parent.subscription_details.
  const subId = str(o.subscription) ?? str(obj(obj(o.parent).subscription_details).subscription) ?? (str(o.object) === "subscription" ? str(o.id) : null);
  if (subId) {
    const s = await deps.repo.bySubscription(subId);
    if (s) return s;
  }
  const customer = str(o.customer);
  return customer ? deps.repo.byCustomer(customer) : null;
}

async function tell(deps: BillingDeps, tenantId: string, mail: (name: string) => Mail) {
  const owner = await deps.ownerEmail(tenantId).catch(() => null);
  if (owner) await deps.mail(owner.email, mail(owner.name)).catch(() => null);
}

async function onCheckoutCompleted(deps: BillingDeps, o: Record<string, unknown>): Promise<string | null> {
  if (str(o.mode) !== "subscription" || str(o.payment_status) === "unpaid") return null;
  const meta = obj(o.metadata);
  const subscriptionId = str(o.subscription);
  const customerId = str(o.customer);
  if (!subscriptionId || !customerId) return null;
  if (meta.kind === "reactivate") return reactivate(deps, str(meta.tenant_id), subscriptionId, customerId);
  if (meta.kind !== "signup" || !isPlanKey(meta.plan)) return null;
  const existing = await deps.repo.bySubscription(subscriptionId);
  if (existing) return existing.tenant_id;
  const email = (str(meta.email) ?? str(obj(o.customer_details).email) ?? "").toLowerCase();
  const name = str(meta.name) ?? email;
  const workspace = str(meta.workspace) ?? name;
  // The address label comes from the payment, so a repeated delivery finds the workspace it already made.
  const stamp = createHash("sha256").update(subscriptionId).digest("hex").slice(0, 6);
  const slug = slugFor(workspace, () => stamp);
  let tenantId: string;
  try {
    tenantId = (await deps.provision.createTenant({ slug, name: workspace, tier: "ptin" })).id;
  } catch (e) {
    const found = await deps.provision.tenantBySlug(slug);
    if (!found) throw e;
    tenantId = found.id;
  }
  const facts = await deps.stripe.subscriptionFacts(subscriptionId).catch(() => null);
  if (!(await deps.repo.byTenant(tenantId))) {
    await deps.repo.insert({
      tenant_id: tenantId, plan: meta.plan as PlanKey, status: "active", stripe_customer_id: customerId, stripe_subscription_id: subscriptionId,
      current_period_end: facts?.currentPeriodEnd ?? null, cancel_at_period_end: false, paused_from_plan: null, suspended_at: null, canceled_at: null,
      delete_after: null, precheck_mark: null, terms_version: str(meta.terms),
    });
  }
  // The owner gets the one-time link to set a password.
  const repo = deps.provision.practiceRepo(tenantId);
  if ((await repo.listMembers()).length === 0) {
    const token = newToken();
    const member = await repo.insertMember({
      email, full_name: name, invite_token_hash: hashToken(token),
      invite_expires_at: new Date(nowOf(deps).getTime() + INVITE_DAYS * 86_400_000).toISOString(), invited_by: null,
    });
    await repo.addAudit({ actor_id: null, action: "workspace_signed_up", subject_type: "practice_member", subject_id: member.id, detail: { plan: meta.plan, tier: "ptin" } });
    const link = await deps.provision.inviteLink(token);
    const problem = await deps.mail(email, welcomeEmail({ name, workspace, plan: meta.plan as PlanKey, link }));
    if (problem) await repo.addAudit({ actor_id: null, action: "invite_email_failed", subject_type: "practice_member", subject_id: member.id, detail: { reason: problem.slice(0, 200) } });
  }
  return tenantId;
}

async function reactivate(deps: BillingDeps, tenantId: string | null, subscriptionId: string, customerId: string): Promise<string | null> {
  if (!tenantId) return null;
  const sub = await deps.repo.byTenant(tenantId);
  // Only a cancelled account of this tenant can be brought back, by a payment made for exactly it.
  if (!sub || sub.status !== "canceled") return sub?.tenant_id ?? null;
  const facts = await deps.stripe.subscriptionFacts(subscriptionId).catch(() => null);
  await deps.repo.update(tenantId, {
    status: "active", stripe_customer_id: customerId, stripe_subscription_id: subscriptionId, current_period_end: facts?.currentPeriodEnd ?? null,
    cancel_at_period_end: false, paused_from_plan: null, suspended_at: null, canceled_at: null, delete_after: null, precheck_mark: null,
  });
  await tell(deps, tenantId, (name) => ({ subject: "Your Verexa HQ account is active again", text: `Hi ${name},\n\nYour payment went through and your workspace is back, with everything as you left it.\n` }));
  return tenantId;
}

async function onInvoicePaid(deps: BillingDeps, o: Record<string, unknown>): Promise<string | null> {
  const sub = await subFor(deps, o);
  if (!sub || sub.status === "internal" || sub.status === "canceled") return sub?.tenant_id ?? null;
  const facts = sub.stripe_subscription_id ? await deps.stripe.subscriptionFacts(sub.stripe_subscription_id).catch(() => null) : null;
  const wasLate = sub.status === "suspended" || sub.status === "read_only";
  await deps.repo.update(sub.tenant_id, {
    // A paused account stays paused; a late one is back in good standing.
    status: wasLate ? (sub.paused_from_plan ? "paused" : "active") : sub.status,
    suspended_at: null, precheck_mark: null, current_period_end: facts?.currentPeriodEnd ?? sub.current_period_end,
  });
  if (wasLate) await tell(deps, sub.tenant_id, (name) => ({ subject: "Payment received: your Verexa HQ account is back to normal", text: `Hi ${name},\n\nThank you. Your payment went through and everything is working again.\n` }));
  return sub.tenant_id;
}

async function onPaymentFailed(deps: BillingDeps, o: Record<string, unknown>): Promise<string | null> {
  const sub = await subFor(deps, o);
  if (!sub || sub.status === "internal" || sub.status === "canceled") return sub?.tenant_id ?? null;
  // Only a renewal that fails puts the account in the late-payment timeline; the first payment can't fail (it is the signup).
  if (str(o.billing_reason) !== "subscription_cycle") return sub.tenant_id;
  if (sub.status === "active" || sub.status === "paused") {
    // Read-only at once; the Billing page keeps working so the card can be fixed. Payment is retried daily until the window ends.
    await deps.repo.update(sub.tenant_id, { status: "read_only", suspended_at: nowOf(deps).toISOString() });
    await tell(deps, sub.tenant_id, (name) => paymentFailedEmail(name));
  }
  return sub.tenant_id;
}

async function onSubscriptionUpdated(deps: BillingDeps, o: Record<string, unknown>): Promise<string | null> {
  const sub = await subFor(deps, o);
  if (!sub || sub.status === "internal") return sub?.tenant_id ?? null;
  if (str(o.status) === "canceled") return cancel(deps, sub);
  const facts = sub.stripe_subscription_id ? await deps.stripe.subscriptionFacts(sub.stripe_subscription_id).catch(() => null) : null;
  if (facts) await deps.repo.update(sub.tenant_id, { current_period_end: facts.currentPeriodEnd, cancel_at_period_end: facts.cancelAtPeriodEnd });
  return sub.tenant_id;
}

async function onSubscriptionDeleted(deps: BillingDeps, o: Record<string, unknown>): Promise<string | null> {
  const sub = await subFor(deps, o);
  if (!sub || sub.status === "internal") return sub?.tenant_id ?? null;
  return cancel(deps, sub);
}

/** The subscription has ended: the data is kept for the retention period, then deleted (by the deletion job, which is separate). */
async function cancel(deps: BillingDeps, sub: Subscription): Promise<string> {
  if (sub.status === "canceled") return sub.tenant_id;
  const at = nowOf(deps);
  await deps.repo.update(sub.tenant_id, { status: "canceled", canceled_at: at.toISOString(), delete_after: deleteAfter(at), cancel_at_period_end: false, suspended_at: null, precheck_mark: null });
  await tell(deps, sub.tenant_id, (name) => canceledEmail(name, new Date(deleteAfter(at))));
  return sub.tenant_id;
}

// ------------------------------------------------------- pause, resume, come back

export async function pauseWorkspace(deps: BillingDeps, tenantId: string): Promise<void> {
  const sub = (await deps.repo.byTenant(tenantId)) ?? fail("This workspace has no subscription.");
  if (sub.status !== "active") fail(sub.status === "paused" ? "Your plan is already paused." : "Only an account in good standing can be paused.");
  const subscriptionId = sub.stripe_subscription_id ?? fail("This workspace has no subscription to pause.");
  await deps.stripe.setPrice(subscriptionId, PAUSE_PLAN.lookupKey);
  await deps.repo.update(tenantId, { status: "paused", paused_from_plan: sub.plan });
}

export async function resumeWorkspace(deps: BillingDeps, tenantId: string): Promise<void> {
  const sub = (await deps.repo.byTenant(tenantId)) ?? fail("This workspace has no subscription.");
  const subscriptionId = sub.stripe_subscription_id;
  const back = sub.paused_from_plan;
  if (sub.status !== "paused" || !back || !subscriptionId) return fail("Your plan isn't paused.");
  await deps.stripe.setPrice(subscriptionId, PLANS[back].lookupKey);
  await deps.repo.update(tenantId, { status: "active", paused_from_plan: null });
}

/** A cancelled workspace's way back, within the retention period. */
export async function startReactivation(deps: BillingDeps, tenantId: string, email: string): Promise<{ url: string }> {
  const sub = (await deps.repo.byTenant(tenantId)) ?? fail("This workspace has no subscription.");
  if (sub.status !== "canceled") fail("Your account isn't cancelled.");
  if (sub.delete_after && Date.parse(sub.delete_after) < nowOf(deps).getTime()) fail("The 90 days have passed and this workspace's data has been removed.");
  const origin = (await deps.origin()).replace(/\/$/, "");
  return deps.stripe.reactivateCheckout({
    tenantId, plan: sub.plan, customerId: sub.stripe_customer_id, email, successUrl: `${origin}/practice/billing?notice=${encodeURIComponent("Payment received. Your workspace is back.")}`,
    cancelUrl: `${origin}/practice/billing`, idempotencyKey: `reactivate:${tenantId}:${Math.floor(nowOf(deps).getTime() / 3_600_000)}`,
  });
}

// --------------------------------------------------------------- daily sweep

export type SweepReport = { checked: number; canceled: number; warned: number; retried: number; errors: number };

export async function runBillingSweep(deps: BillingDeps): Promise<SweepReport> {
  const report: SweepReport = { checked: 0, canceled: 0, warned: 0, retried: 0, errors: 0 };
  const now = nowOf(deps);
  for (const sub of await deps.repo.sweepList()) {
    report.checked++;
    try {
      // A late account is cancelled once its window is over.
      if (nextStep(sub, now) === "canceled") {
        if (sub.stripe_subscription_id) await deps.stripe.cancelNow(sub.stripe_subscription_id).catch(() => undefined);
        await cancel(deps, sub);
        report.canceled++;
        continue;
      }
      // Late accounts: try the unpaid invoice again each day, and remind the owner on the set days.
      if ((sub.status === "suspended" || sub.status === "read_only") && sub.stripe_subscription_id) {
        const r = await deps.stripe.retryOpenInvoice(sub.stripe_subscription_id);
        if (r !== "none") report.retried++;
        const reminder = lateReminderDue(sub, now);
        if (reminder !== null) {
          await tell(deps, sub.tenant_id, (name) => lateReminderEmail(name, LATE_DAYS - reminder));
          report.warned++;
        }
        continue;
      }
      // Good accounts: 7, 5 and 3 days before renewal, check the card and warn if it won't work.
      const mark = precheckDue(sub, now);
      if (mark && sub.stripe_customer_id && sub.current_period_end) {
        const card = await deps.stripe.cardCheck(sub.stripe_customer_id, sub.current_period_end);
        if (sub.stripe_subscription_id && (await deps.stripe.retryOpenInvoice(sub.stripe_subscription_id)) !== "none") report.retried++;
        if (!card.ok) {
          const renew = new Date(sub.current_period_end);
          await tell(deps, sub.tenant_id, (name) => cardWarningEmail(name, renew, mark, card.reason));
          report.warned++;
        }
        await deps.repo.update(sub.tenant_id, { precheck_mark: mark });
      }
    } catch {
      report.errors++;
    }
  }
  return report;
}

// ----------------------------------------------------------------- emails

const when = (d: Date) => new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(d);

export function welcomeEmail(i: { name: string; workspace: string; plan: PlanKey; link: string }): Mail {
  return {
    subject: "Welcome to Verexa HQ: set your password",
    action: { label: "Set my password", url: i.link },
    text: [
      `Hi ${i.name},`, "",
      `Your payment went through and ${i.workspace} is ready (${PLANS[i.plan].label}, ${dollars(PLANS[i.plan].priceCents)} per month).`, "",
      `Open this link to set your password and sign in (it works for ${INVITE_DAYS} days and only once):`, i.link, "",
      "You can manage your plan, update your card and see invoices any time from Billing inside your workspace.",
    ].join("\n"),
  };
}
export const paymentFailedEmail = (name: string): Mail => ({
  subject: "Action needed: your Verexa HQ payment didn't go through",
  text: `Hi ${name},\n\nWe couldn't collect your renewal payment, so your workspace is now read-only: you can look at everything but not change it, and no messages are sent. The Billing page still works. Update your card there and we'll collect the payment right away and restore everything.\n\nWe'll keep trying and send you reminders. If it isn't paid within ${LATE_DAYS} days the account is cancelled, and your data is kept for ${RETENTION_DAYS} days after that.\n`,
});
export const lateReminderEmail = (name: string, daysLeft: number): Mail => ({
  subject: daysLeft <= 3 ? "Final notice: your Verexa HQ account will be cancelled soon" : "Reminder: your Verexa HQ payment is still unpaid",
  text: `Hi ${name},\n\nYour renewal payment is still unpaid and your workspace is read-only. If it isn't paid in about ${daysLeft} day${daysLeft === 1 ? "" : "s"} the account is cancelled (your data is then kept for ${RETENTION_DAYS} days). Update your card from Billing and we'll collect the payment right away.\n`,
});
export const canceledEmail = (name: string, deleteOn: Date): Mail => ({
  subject: "Your Verexa HQ account has been cancelled",
  text: `Hi ${name},\n\nYour subscription has ended. We'll keep your data for ${RETENTION_DAYS} days (until ${when(deleteOn)}), then it is permanently deleted. You can come back any time before then from the Billing page, or pause instead for ${dollars(PAUSE_PLAN.priceCents)} a month to keep your data safe.\n`,
});
export const cardWarningEmail = (name: string, renewsOn: Date, daysOut: number, reason: string): Mail => ({
  subject: `Your card may not work for your Verexa HQ renewal on ${when(renewsOn)}`,
  text: `Hi ${name},\n\nYour plan renews in about ${daysOut} days (${when(renewsOn)}) and ${reason}. Please update your card from Billing so the payment goes through and your workspace doesn't become read-only.\n`,
});

export type { SubStatus };
