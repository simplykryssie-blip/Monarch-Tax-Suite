import { ValidationError } from "../commerce/validation.ts";
import type { CrmSecrets } from "../crm/crypto.ts";
import { MONARCH_TENANT_ID } from "../tenants.ts";
import { isE164, TwilioApi, type AvailableNumber, type TwilioAccounts } from "../automation/twilio.ts";
import { PLATFORM } from "../platform-brand.ts";
import { secretAad } from "./route.ts";
import { checkRegistration, savedRegistration } from "./registration.ts";
import { advanceLocal, advanceTollFree } from "./carrier.ts";
import { creditPack, creditsLabel, isNumberType, NUMBER_PLANS, type NumberType } from "./pricing.ts";
import { addMonth, FORFEIT_DAYS, RETRY_DAYS, renewalStep } from "./renewal.ts";
import type { SmsAccount, SmsAccountsRepo } from "./types.ts";

// Self-serve texting for a tax office. The office does everything itself, in Settings → Text messaging:
//   1. chooses toll-free (recommended) or local, and answers the registration questions;
//   2. picks a number;
//   3. pays the one-time setup by card.
// Once Stripe confirms that payment (the amount, for this office), the app makes the office's Twilio subaccount and
// API key, buys the number into it and submits the carrier registration. Texts stay blocked until carriers approve.
// Credits are bought in packs by card; each month the number renews from credits (lib/sms/renewal.ts).

export type Payments = {
  /** A Stripe Checkout for one line item. Returns its id and the page to send the person to. */
  createCheckout(input: { item: string; unitCents: number; quantity: number; metadata: Record<string, string>; successUrl: string; cancelUrl: string; email: string | null }): Promise<{ id: string; url: string }>;
};
/** Tells the office about its texting (paused, released, forfeited, approved). Never throws. */
export type Notify = (subject: string, text: string) => Promise<void>;

export type SetupDeps = {
  tenantId: string;
  repo: SmsAccountsRepo;
  /** The owner's (parent) Twilio account, for subaccounts, number search, buying and releasing. */
  twilio: TwilioAccounts | null;
  parentSid: string | null;
  secrets: CrmSecrets | null;
  /** The platform's primary Twilio business profile; local (10DLC) registrations link to it. */
  primaryProfileSid: string | null;
  officeName: string;
  /** Where replies to an office's number are sent (STOP, START, HELP). Null outside production, so a test deployment never repoints a real number. */
  inboundUrl?: string | null;
  api?: (login: { username: string; password: string }) => TwilioApi;
  notify?: Notify;
  now?: () => Date;
};

const nowOf = (d: SetupDeps) => d.now?.() ?? new Date();
const today = (d: SetupDeps) => nowOf(d).toISOString().slice(0, 10);

function notMonarch(d: SetupDeps) {
  if (d.tenantId === MONARCH_TENANT_ID) throw new ValidationError("This office texts from the owner's own Twilio account, set in Vercel.");
}
function twilioReady(d: SetupDeps): { twilio: TwilioAccounts; secrets: CrmSecrets; parentSid: string } {
  if (!d.twilio || !d.parentSid) throw new ValidationError("Text messaging can't be set up yet: the platform's Twilio account isn't connected.");
  if (!d.secrets) throw new ValidationError("Text messaging can't be set up yet: MONARCH_ENCRYPTION_KEY is not configured.");
  return { twilio: d.twilio, secrets: d.secrets, parentSid: d.parentSid };
}

/** Local numbers need the platform's primary business profile for their registration; until then only toll-free. */
export const localAvailable = (d: Pick<SetupDeps, "primaryProfileSid">) => !!d.primaryProfileSid;

/** Where the office is in its setup, for its settings page. */
export function smsSetupStep(a: SmsAccount | null): "choose" | "number" | "pay" | "provisioning" | "registration" | "ready" | "paused" | "released" | "suspended" {
  if (!a) return "choose";
  if (a.status === "suspended") return "suspended";
  if (a.status === "released") return "released";
  if (a.status === "paused") return "paused";
  if (!a.setup_paid_at) {
    if (!a.number_type || !savedRegistration(a.registration, a.number_type)) return "choose";
    return a.chosen_number ? "pay" : "number";
  }
  if (a.provision_status !== "done") return "provisioning";
  return a.registration_status === "approved" ? "ready" : "registration";
}

// ---------------------------------------------------------------- 1-2. choices before paying

/** Saves the number type and the registration answers. Starting again after a released number clears the old setup. */
export async function saveSetupChoices(d: SetupDeps, raw: Record<string, unknown>, actorId: string): Promise<SmsAccount> {
  notMonarch(d);
  const type = raw.number_type;
  if (!isNumberType(type)) throw new ValidationError("Choose a toll-free or a local number.");
  if (type === "local" && !localAvailable(d)) throw new ValidationError("Local numbers aren't available yet. Choose a toll-free number.");
  const registration = checkRegistration(raw, type);
  const account = await d.repo.get();
  if (account?.setup_paid_at && account.status !== "released") throw new ValidationError("Your number is already paid for. Its registration can't be changed here.");
  const fresh = {
    number_type: type, registration: registration as unknown as Record<string, unknown>,
    chosen_number: account?.number_type === type && account.status !== "released" ? account.chosen_number : null,
  };
  if (!account) return d.repo.insert({ ...fresh, status: "setting_up", registration_status: "not_started", created_by: actorId });
  if (account.status === "released") {
    return d.repo.update(account.id, {
      ...fresh, chosen_number: null, status: "setting_up", registration_status: "not_started", registration_sids: {}, registration_error: null,
      from_number: null, phone_number_sid: null, messaging_service_sid: null, setup_paid_at: null, provision_status: "none", provision_error: null,
      renews_on: null, renewal_failed_at: null, renewal_attempts: 0, released_at: null, forfeited_at: null,
    });
  }
  return d.repo.update(account.id, fresh);
}

export async function findNumbers(d: SetupDeps, areaCode: unknown): Promise<AvailableNumber[]> {
  notMonarch(d);
  const { twilio, parentSid } = twilioReady(d);
  const account = await d.repo.get();
  if (!account?.number_type) throw new ValidationError("Choose the kind of number first.");
  if (account.number_type === "toll_free") return twilio.searchNumbers(parentSid, { type: "toll_free" });
  const code = typeof areaCode === "string" ? areaCode.trim() : "";
  if (!/^[2-9]\d{2}$/.test(code)) throw new ValidationError("Enter a 3-digit US area code, for example 337.");
  return twilio.searchNumbers(parentSid, { type: "local", areaCode: code });
}

export async function chooseNumber(d: SetupDeps, number: unknown): Promise<SmsAccount> {
  notMonarch(d);
  const n = typeof number === "string" ? number.trim() : "";
  if (!isE164(n)) throw new ValidationError("Choose one of the numbers listed.");
  const account = await d.repo.get();
  if (!account?.number_type) throw new ValidationError("Choose the kind of number first.");
  if (account.setup_paid_at && account.status !== "released") throw new ValidationError("Your number is already paid for.");
  const tollFree = /^\+18(00|33|44|55|66|77|88)\d{7}$/.test(n);
  if ((account.number_type === "toll_free") !== tollFree) throw new ValidationError(`That isn't a ${account.number_type === "toll_free" ? "toll-free" : "local"} number. Choose one from the list.`);
  return d.repo.update(account.id, { chosen_number: n });
}

// ---------------------------------------------------------------- 3. paying

export async function startSetupCheckout(d: SetupDeps, payments: Payments, urls: { origin: string; email: string | null }, actorId: string): Promise<string> {
  notMonarch(d);
  twilioReady(d);
  const account = await d.repo.get();
  if (smsSetupStep(account) !== "pay" || !account?.number_type) throw new ValidationError("Finish the registration questions and choose a number first.");
  if (account.number_type === "local" && !localAvailable(d)) throw new ValidationError("Local numbers aren't available yet. Choose a toll-free number.");
  const plan = NUMBER_PLANS[account.number_type];
  const checkout = await d.repo.insertCheckout({ purpose: "setup", number_type: plan.type, packs: null, credits: null, amount_cents: plan.setupCents, created_by: actorId });
  const session = await payments.createCheckout({
    item: plan.setupItem, unitCents: plan.setupCents, quantity: 1, email: urls.email,
    metadata: { purpose: "sms_setup", tenant_id: d.tenantId, sms_checkout_id: checkout.id },
    successUrl: `${urls.origin}/settings/sms?checkout={CHECKOUT_SESSION_ID}`, cancelUrl: `${urls.origin}/settings/sms`,
  });
  await d.repo.updateCheckout(checkout.id, { stripe_session_id: session.id });
  return session.url;
}

export async function startCreditsCheckout(d: SetupDeps, payments: Payments, packs: unknown, urls: { origin: string; email: string | null }, actorId: string): Promise<string> {
  notMonarch(d);
  let pack;
  try {
    pack = creditPack(packs);
  } catch (e) {
    throw new ValidationError(e instanceof Error ? e.message : "Choose how many packs.");
  }
  const checkout = await d.repo.insertCheckout({ purpose: "credits", number_type: null, packs: pack.packs, credits: pack.credits, amount_cents: pack.cents, created_by: actorId });
  const session = await payments.createCheckout({
    item: pack.item, unitCents: pack.cents / pack.packs, quantity: pack.packs, email: urls.email,
    metadata: { purpose: "sms_credits", tenant_id: d.tenantId, sms_checkout_id: checkout.id },
    successUrl: `${urls.origin}/settings/sms?checkout={CHECKOUT_SESSION_ID}`, cancelUrl: `${urls.origin}/settings/sms`,
  });
  await d.repo.updateCheckout(checkout.id, { stripe_session_id: session.id });
  return session.url;
}

/** A Stripe Checkout Session, as the webhook or Stripe's API returns it. */
export type PaidSession = { id: string; status?: string | null; payment_status: string; amount_total: number | null; currency: string | null; metadata: Record<string, string> | null };

/**
 * Honours a paid checkout, once. Used by the Stripe webhook and when the office comes back from Checkout. Nothing is
 * issued unless Stripe says it is paid, for this office, for exactly the amount recorded when the checkout started.
 */
export async function fulfilSmsCheckout(d: SetupDeps, session: PaidSession): Promise<"credited" | "provisioned" | "already" | "not_paid"> {
  if (session.payment_status !== "paid" || (session.status && session.status !== "complete")) return "not_paid";
  if (session.metadata?.tenant_id !== d.tenantId) throw new Error("This checkout belongs to another account.");
  const checkout = await d.repo.findCheckout(session.id);
  if (!checkout || checkout.id !== session.metadata?.sms_checkout_id) throw new Error("No text messaging checkout matches this payment.");
  if (session.amount_total !== checkout.amount_cents || (session.currency ?? "").toLowerCase() !== checkout.currency) throw new Error(`The amount paid doesn't match this checkout (${session.amount_total} vs ${checkout.amount_cents}).`);
  if (checkout.purpose === "credits") {
    const already = checkout.status === "paid";
    await d.repo.creditPurchase(session.id);
    // A paused number renews as soon as there are credits for it.
    await resumeIfPaused(d).catch(() => undefined);
    return already ? "already" : "credited";
  }
  const account = await d.repo.get();
  if (!account) throw new Error("No texting setup to pay for.");
  if (checkout.status === "paid" && account.setup_paid_at) return "already";
  await d.repo.updateCheckout(checkout.id, { status: "paid", paid_at: nowOf(d).toISOString() });
  await d.repo.update(account.id, { setup_paid_at: nowOf(d).toISOString(), provision_status: "provisioning", provision_error: null });
  await provision(d).catch(() => undefined); // recorded on the account; the daily sweep and the settings page retry it
  return "provisioned";
}

// ---------------------------------------------------------------- after payment: number and registration

async function ensureSubaccount(d: SetupDeps, account: SmsAccount): Promise<SmsAccount> {
  const { twilio, secrets } = twilioReady(d);
  const label = `${PLATFORM.name} tenant ${d.tenantId.slice(0, 8)} ${d.officeName}`.replace(/[^\w .&'-]/g, "").slice(0, 64);
  let a = account;
  if (!a.subaccount_sid) {
    const sub = await twilio.createSubaccount(label);
    a = await d.repo.update(a.id, { subaccount_sid: sub.sid });
  }
  if (!a.api_key_sid || !a.api_key_secret_encrypted) {
    const key = await twilio.createApiKey(a.subaccount_sid!, `${label} sending`);
    a = await d.repo.update(a.id, { api_key_sid: key.sid, api_key_secret_encrypted: secrets.encrypt(key.secret, secretAad(d.tenantId)) });
  }
  return a;
}

/** Buys the chosen number (or, if it was taken meanwhile, another of the same kind) and submits the registration. */
export async function provision(d: SetupDeps): Promise<SmsAccount> {
  notMonarch(d);
  let a = await d.repo.get();
  if (!a?.setup_paid_at || !a.number_type) throw new ValidationError("The setup hasn't been paid for.");
  if (a.provision_status === "done") return a;
  try {
    const { twilio, parentSid } = twilioReady(d);
    a = await ensureSubaccount(d, a);
    if (!a.from_number) {
      let bought;
      try {
        bought = await twilio.buyNumber(a.subaccount_sid!, a.chosen_number!, d.inboundUrl);
      } catch {
        const area = a.number_type === "local" ? a.chosen_number!.slice(2, 5) : undefined;
        const other = (await twilio.searchNumbers(parentSid, { type: a.number_type!, areaCode: area }))[0];
        if (!other) throw new Error(`The number you chose was taken, and no other ${a.number_type === "local" ? `number in area code ${area}` : "toll-free number"} is free right now.`);
        bought = await twilio.buyNumber(a.subaccount_sid!, other.phoneNumber, d.inboundUrl);
      }
      a = await d.repo.update(a.id, { from_number: bought.phoneNumber, phone_number_sid: bought.sid });
    }
    // The setup payment covers the first month; renewals from credits start a month later.
    a = await d.repo.update(a.id, { status: "active", provision_status: "done", provision_error: null, renews_on: a.renews_on ?? addMonth(today(d)) });
  } catch (e) {
    return d.repo.update(a.id, { provision_status: "error", provision_error: (e instanceof Error ? e.message : "Setup failed.").slice(0, 500) });
  }
  return advanceRegistration(d);
}

/** Submits the carrier registration, or reads its status back. Texts are allowed only once it's approved. */
export async function advanceRegistration(d: SetupDeps): Promise<SmsAccount> {
  const a = await d.repo.get();
  if (!a || a.provision_status !== "done" || !a.number_type || !a.phone_number_sid || a.registration_status === "approved" || a.registration_status === "rejected") return a!;
  const registration = savedRegistration(a.registration, a.number_type);
  if (!registration || !a.api_key_sid || !a.api_key_secret_encrypted || !d.secrets) return d.repo.update(a.id, { registration_error: "The registration answers or the texting key are missing." });
  const api = (d.api ?? ((l) => new TwilioApi(l)))({ username: a.api_key_sid, password: d.secrets.decrypt(a.api_key_secret_encrypted, secretAad(d.tenantId)) });
  const ctx = { api, tenantId: d.tenantId, subaccountSid: a.subaccount_sid!, phoneNumberSid: a.phone_number_sid, registration, primaryProfileSid: d.primaryProfileSid, officeName: d.officeName };
  const sids = { ...a.registration_sids };
  try {
    const r = a.number_type === "toll_free" ? await advanceTollFree(ctx, sids) : await advanceLocal(ctx, sids);
    const updated = await d.repo.update(a.id, { registration_sids: r.sids, registration_status: r.status, registration_error: r.error, ...(r.messagingServiceSid ? { messaging_service_sid: r.messagingServiceSid } : {}) });
    if (r.status !== a.registration_status && (r.status === "approved" || r.status === "rejected")) {
      await d.notify?.(r.status === "approved" ? "Texting is approved" : "Texting registration was rejected",
        r.status === "approved" ? `Carriers approved your texting registration. You can now text clients from ${a.from_number}.` : `Carriers rejected your texting registration: ${r.error ?? "no reason given"}. Contact support to resubmit.`);
    }
    return updated;
  } catch (e) {
    // Progress made before the failure is kept, so the next try carries on from there.
    return d.repo.update(a.id, { registration_sids: sids, registration_status: a.registration_status === "not_started" && Object.keys(sids).length ? "submitted" : a.registration_status, registration_error: (e instanceof Error ? e.message : "Registration failed.").slice(0, 500) });
  }
}

// ---------------------------------------------------------------- monthly renewal

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const plusDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86_400_000).toISOString();

/** Runs today's renewal step for this office: charge, retry, release or forfeit. Returns what it did. */
export async function runRenewal(d: SetupDeps): Promise<"none" | "renewed" | "paused" | "retry_failed" | "released" | "forfeited"> {
  const a = await d.repo.get();
  if (!a || !a.number_type || d.tenantId === MONARCH_TENANT_ID) return "none";
  const step = renewalStep(a, nowOf(d));
  if (step.do === "none") return "none";
  if (step.do === "forfeit") {
    const lost = await d.repo.forfeit(`forfeit:${step.period}`);
    await d.repo.update(a.id, { forfeited_at: nowOf(d).toISOString() });
    if (lost > 0) await d.notify?.("Text credits forfeited", `${creditsLabel(lost)} were forfeited: your texting number wasn't renewed within ${FORFEIT_DAYS} days.`);
    return "forfeited";
  }
  return charge(d, a, step.attempt, step.period);
}

async function charge(d: SetupDeps, a: SmsAccount, attempt: 1 | 2 | 3, period: string) {
  const plan = NUMBER_PLANS[a.number_type as NumberType];
  const now = nowOf(d).toISOString();
  if (await d.repo.chargeRenewal(plan.monthlyCredits, period, plan.monthlyItem)) {
    const wasPaused = a.status === "paused";
    await d.repo.update(a.id, { status: "active", renews_on: addMonth(a.renews_on!), renewal_failed_at: null, renewal_attempts: 0 });
    if (wasPaused) await d.notify?.("Texting resumed", `Your ${plan.label.toLowerCase()} was renewed from your credits and texting is back on.`);
    return "renewed" as const;
  }
  const have = await d.repo.balance();
  const firstFail = a.renewal_failed_at ?? now;
  if (attempt < 3) {
    await d.repo.update(a.id, { status: "paused", renewal_failed_at: firstFail, renewal_attempts: attempt });
    if (attempt === 1) {
      await d.notify?.("Texting paused: buy credits to keep your number",
        `This month's ${plan.monthlyItem.toLowerCase()} needs ${creditsLabel(plan.monthlyCredits)} and you have ${creditsLabel(Math.max(0, have))}, so texting is paused. Buy credits in Settings → Text messaging and it resumes right away. We'll try again on ${fmt(plusDays(firstFail, RETRY_DAYS[0]))} and ${fmt(plusDays(firstFail, RETRY_DAYS[1]))}; if it still can't be renewed then, the number is released.`);
    }
    return attempt === 1 ? ("paused" as const) : ("retry_failed" as const);
  }
  // The last try failed: the number goes back to the carrier.
  try {
    if (a.subaccount_sid && a.phone_number_sid && d.twilio) await d.twilio.releaseNumber(a.subaccount_sid, a.phone_number_sid);
  } catch (e) {
    await d.repo.update(a.id, { renewal_attempts: 3, provision_error: (e instanceof Error ? e.message : "Release failed").slice(0, 500) });
    throw e;
  }
  await d.repo.update(a.id, { status: "released", released_at: now, renewal_attempts: 3, from_number: null, phone_number_sid: null });
  await d.notify?.("Your texting number was released",
    `Your number ${a.from_number ?? ""} was released because its renewal couldn't be taken from your credits. Credits left in your account are forfeited on ${fmt(plusDays(`${period}T00:00:00Z`, FORFEIT_DAYS))} unless you set up texting again before then.`);
  return "released" as const;
}

/**
 * After credits are bought: a paused number is renewed straight away. If the credits still don't cover it, nothing
 * changes: the scheduled retries (day 3, day 7) stay as they were.
 */
export async function resumeIfPaused(d: SetupDeps): Promise<boolean> {
  const a = await d.repo.get();
  if (!a || a.status !== "paused" || !a.renews_on || !a.number_type) return false;
  const plan = NUMBER_PLANS[a.number_type];
  if (!(await d.repo.chargeRenewal(plan.monthlyCredits, a.renews_on.slice(0, 10), plan.monthlyItem))) return false;
  await d.repo.update(a.id, { status: "active", renews_on: addMonth(a.renews_on), renewal_failed_at: null, renewal_attempts: 0 });
  await d.notify?.("Texting resumed", `Your ${plan.label.toLowerCase()} was renewed from your credits and texting is back on.`);
  return true;
}

/** Makes sure an office's number sends incoming texts to the platform. Numbers bought now already do; this covers older ones. */
export async function ensureInbound(d: SetupDeps): Promise<boolean> {
  if (!d.inboundUrl || !d.twilio) return false;
  const a = await d.repo.get();
  if (!a?.subaccount_sid || !a.phone_number_sid || a.provision_status !== "done" || a.status === "released") return false;
  await d.twilio.setNumberInbound(a.subaccount_sid, a.phone_number_sid, d.inboundUrl);
  return true;
}
