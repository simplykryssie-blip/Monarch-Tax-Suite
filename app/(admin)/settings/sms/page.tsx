import { FormattedInput } from "@/components/forms/formatted-input";
import Link from "next/link";
import { EmptyRow, Flash, PageTitle, when } from "@/components/admin/ui";
import { SubmitOnce } from "@/components/admin/submit-once";
import { appOrigin, imageStore, tenantDb } from "@/lib/admin";
import { platformTwilio, platformSendProblems, type AvailableNumber } from "@/lib/automation/twilio.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { SupabaseImagesRepo } from "@/lib/images/supabase-repo";
import { CREDIT_PACK, creditsLabel, dollars, MAX_PACKS, NUMBER_PLANS, type NumberType } from "@/lib/sms/pricing.ts";
import { BUSINESS_TYPES, JOB_POSITIONS, OPT_IN_TYPES, suggestedRegistration, VOLUMES } from "@/lib/sms/registration.ts";
import { findNumbers, localAvailable, smsSetupStep } from "@/lib/sms/service.ts";
import { fulfilSmsSession, smsAccount, smsSetupDeps, tenantSms } from "@/lib/sms/server";
import type { CreditKind } from "@/lib/sms/types.ts";
import { currentTenantId, MONARCH_TENANT_ID } from "@/lib/tenants.ts";
import { buySmsCreditsAction, checkSmsStatusAction, chooseSmsNumberAction, saveSmsSetupAction, startSmsSetupCheckoutAction } from "../actions";
import { storeStripeClient } from "@/lib/store-stripe/server";

const KIND: Record<CreditKind, string> = { purchase: "Credits bought", send: "Text sent", send_reversal: "Text not sent: credits returned", renewal: "Number, monthly", forfeit: "Forfeited after 30 days without renewal" };
const REGISTRATION = { not_started: "Not submitted yet", submitted: "Submitted: carriers are reviewing it", approved: "Approved: you can text clients", rejected: "Rejected" } as const;

/** Comes back from Stripe Checkout: Stripe is asked directly whether it's paid, then it's honoured (once). */
async function confirmReturn(sessionId: string | undefined): Promise<{ notice?: string; error?: string }> {
  if (!sessionId || !/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(sessionId)) return {};
  const stripe = await storeStripeClient();
  if (!stripe) return {};
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.metadata?.tenant_id !== currentTenantId()) return { error: "That payment isn't for this account." };
    const r = await fulfilSmsSession(session as never);
    if (r === "not_paid") return { error: "Stripe hasn't confirmed this payment yet. Refresh in a minute." };
    return { notice: session.metadata?.purpose === "sms_credits" ? "Payment received. Your credits have been added." : "Payment received. Your number is being set up and your registration submitted." };
  } catch (e) {
    console.error(`sms return: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
    return { error: "We couldn't confirm that payment yet. If you were charged, it's applied automatically within a few minutes." };
  }
}

/** This office's own texting: number, carrier registration, prepaid credits. Everything is done here, by the office. */
export default async function SmsSettingsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string; area?: string; checkout?: string; type?: string }> }) {
  const sp = await searchParams;
  const tenantId = currentTenantId();
  const returned = await confirmReturn(sp.checkout);
  const { route, repo } = await tenantSms(tenantId);
  const account = await smsAccount(repo);

  // Tenant #1 texts from the owner's own Twilio account (Vercel) and pays Twilio directly.
  if (tenantId === MONARCH_TENANT_ID && !account) {
    const p = platformTwilio(process.env);
    return (
      <>
        <PageTitle title="Text messaging">This office texts from the owner&apos;s own Twilio account. Twilio bills that account directly, so no credits are used.</PageTitle>
        <Flash notice={sp.notice} error={sp.error} />
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2>{route.ok ? "Connected" : "Not connected yet"}</h2>
          {route.ok
            ? <p>Texts go out from {p.messagingServiceSid ? "your Twilio messaging service" : p.from}. Staff can text a client from the client&apos;s Messages tab.</p>
            : <p className="monarch-muted">Text messaging isn&apos;t turned on for this account yet. It is set up by the platform administrator, and nothing is needed from you here.</p>}
          <details className="monarch-muted">
            <summary>For the platform administrator</summary>
            {!route.ok && <p>{platformSendProblems(p).join(" ")}</p>}
            <p>Set in the server settings: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN (or TWILIO_API_KEY with TWILIO_API_SECRET), and TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID. This account is also the parent of every other office&apos;s texting account.</p>
          </details>
        </section>
      </>
    );
  }

  const d = await smsSetupDeps(tenantId);
  const step = smsSetupStep(account);
  const [balance, ledger, images] = await Promise.all([repo.balance().catch(() => 0), repo.ledger(40).catch(() => []), new SupabaseImagesRepo(tenantDb()).list(60).catch(() => [])]);
  const store = imageStore(await appOrigin());
  const choosing = step === "choose" || step === "released" || (step === "number" && sp.type === "edit") || (step === "pay" && sp.type === "edit");
  const type: NumberType = (account?.number_type as NumberType | null) ?? (localAvailable(d) && sp.type === "local" ? "local" : "toll_free");
  const reg = { ...suggestedRegistration(d.officeName), ...(account?.registration ?? {}) } as Record<string, string>;
  const plan = account?.number_type ? NUMBER_PLANS[account.number_type] : null;

  let numbers: AvailableNumber[] = [];
  let searchError: string | null = null;
  if (step === "number" && (account?.number_type === "toll_free" || sp.area)) {
    try {
      numbers = await findNumbers(d, sp.area);
      if (!numbers.length) searchError = account?.number_type === "local" ? `No numbers are free in area code ${sp.area}. Try a nearby one.` : "No toll-free numbers are free right now. Try again in a little while.";
    } catch (e) {
      searchError = e instanceof ValidationError ? e.message : "Numbers could not be searched. Please try again.";
    }
  }

  return (
    <>
      <PageTitle title="Text messaging">Text your clients from your office&apos;s own number. You set it up here yourself: choose a number, register it with carriers, and pay by card. Texts use prepaid credits.</PageTitle>
      <Flash notice={returned.notice ?? sp.notice} error={returned.error ?? sp.error} />

      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2>Status</h2>
        <dl className="monarch-dl">
          <dt>Number</dt><dd>{account?.from_number ? `${account.from_number} (${plan?.label.toLowerCase()})` : account?.chosen_number && !account.setup_paid_at ? `${account.chosen_number}, held until you pay` : "None yet"}</dd>
          <dt>Carrier registration</dt><dd>{account?.setup_paid_at ? REGISTRATION[account.registration_status] : "Starts once the setup is paid"}{account?.registration_error && account.registration_status !== "approved" ? ` · ${account.registration_error}` : ""}</dd>
          <dt>Texting</dt><dd>{route.ok ? <b>On</b> : route.problem}</dd>
          {account?.renews_on && (account.status === "active" || account.status === "paused") && <><dt>Next renewal</dt><dd>{when(`${account.renews_on}T12:00:00Z`)}: {plan ? creditsLabel(plan.monthlyCredits) : ""} from your credits</dd></>}
          <dt>Credits</dt><dd><b>{creditsLabel(Math.max(0, balance))}</b></dd>
        </dl>
        {account?.status === "paused" && <p className="monarch-alert is-error">Texting is paused: this month&apos;s renewal needs {plan ? creditsLabel(plan.monthlyCredits) : "more credits"}. Buy credits below and it resumes right away. If it can&apos;t be renewed within 7 days, the number is released; 30 days after the renewal date, any credits left are forfeited.</p>}
        {account?.status === "released" && <p className="monarch-alert is-error">Your number was released after its renewal failed.{account.forfeited_at ? " Remaining credits were forfeited." : " Set up a number again within 30 days of the missed renewal to keep your credits."}</p>}
        {(step === "provisioning" || step === "registration") && (
          <form action={checkSmsStatusAction} style={{ marginTop: 8 }}>
            {account?.provision_status === "error" && <p className="monarch-alert is-error">Setup hasn&apos;t finished: {account.provision_error}. It&apos;s tried again automatically every day.</p>}
            <SubmitOnce className="monarch-secondary" busy="Checking…">{step === "provisioning" ? "Finish setup now" : "Check registration status now"}</SubmitOnce>
            <small className="monarch-muted" style={{ marginLeft: 8 }}>{plan?.approval}</small>
          </form>
        )}
      </section>

      {choosing && (
        <form action={saveSmsSetupAction} className="monarch-panel monarch-form" style={{ padding: 20 }}>
          <h2 className="is-wide">1. Choose your number and register it</h2>
          <div className="is-wide mf-after">
            {(Object.values(NUMBER_PLANS)).map((p) => {
              const off = p.type === "local" && !localAvailable(d);
              return (
                <div key={p.type} className="mf-choice">
                  <label className="monarch-check"><input type="radio" name="number_type" value={p.type} defaultChecked={type === p.type} disabled={off} /> <b>{p.label}{p.recommended ? " (recommended)" : ""}</b></label>
                  <small className="monarch-muted">{p.summary} {p.approval}</small>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }}>
                    <li><b>{dollars(p.setupCents)}</b> one time, by card: {p.setupItem.toLowerCase()}</li>
                    <li><b>{creditsLabel(p.monthlyCredits)}</b> a month ({dollars(p.monthlyCents)}), from your credits: {p.monthlyItem.toLowerCase()}</li>
                  </ul>
                  {off && <small className="monarch-muted">Not available yet.</small>}
                </div>
              );
            })}
          </div>

          <h3 className="is-wide" style={{ margin: "8px 0 0" }}>Your business (exactly as on your IRS EIN letter)</h3>
          <label>Legal business name *<input name="legal_name" required maxLength={120} defaultValue={reg.legal_name} /></label>
          <label>Doing business as (optional)<input name="dba_name" maxLength={120} defaultValue={reg.dba_name ?? ""} /></label>
          <label>Business type *<select name="business_type" defaultValue={reg.business_type}>{BUSINESS_TYPES.map((b) => <option key={b}>{b}</option>)}</select></label>
          <label>EIN *<FormattedInput kind="ein" name="ein" required placeholder="12-3456789" defaultValue={reg.ein} /></label>
          <label className="is-wide">Website * <small className="monarch-muted">Carriers check that it&apos;s live and matches your business.</small><input name="website" required maxLength={300} placeholder="https://www.yourfirm.com" defaultValue={reg.website} /></label>
          <label className="is-wide">Street address *<input name="street" required maxLength={200} defaultValue={reg.street} /></label>
          <label>City *<input name="city" required maxLength={100} defaultValue={reg.city} /></label>
          <span style={{ display: "flex", gap: 8 }}><label style={{ flex: 1 }}>State *<input name="state" required maxLength={2} placeholder="LA" defaultValue={reg.state} /></label><label style={{ flex: 2 }}>ZIP *<input name="postal_code" required maxLength={10} defaultValue={reg.postal_code} /></label></span>

          <h3 className="is-wide" style={{ margin: "8px 0 0" }}>Who carriers can contact</h3>
          <label>First name *<input name="contact_first_name" required maxLength={60} defaultValue={reg.contact_first_name} /></label>
          <label>Last name *<input name="contact_last_name" required maxLength={60} defaultValue={reg.contact_last_name} /></label>
          <label>Email *<input name="contact_email" type="email" required maxLength={254} defaultValue={reg.contact_email} /></label>
          <label>Phone *<input name="contact_phone" type="tel" required maxLength={30} defaultValue={reg.contact_phone} /></label>
          <label>Title<input name="contact_title" maxLength={60} placeholder="Owner" defaultValue={reg.contact_title} /></label>
          <label>Position<select name="contact_position" defaultValue={reg.contact_position}>{JOB_POSITIONS.map((p) => <option key={p}>{p}</option>)}</select></label>

          <h3 className="is-wide" style={{ margin: "8px 0 0" }}>How clients agree to your texts</h3>
          <label className="is-wide">Where they agree *<select name="opt_in_type" defaultValue={reg.opt_in_type}>{Object.entries(OPT_IN_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="is-wide">Describe it *<textarea name="opt_in_description" required rows={3} maxLength={1000} defaultValue={reg.opt_in_description} /><small className="monarch-muted">Say where they agree, what the wording says, and that they can reply STOP.</small></label>
          <div className="is-wide" style={{ display: "grid", gap: 6 }}>
            <span className="field-label">A picture of where they agree * <small className="monarch-muted">(a photo or screenshot of the checkbox on your form). <Link href="/settings/images">Upload one to your Images</Link>, then choose it here.</small></span>
            {images.length === 0 ? <p className="monarch-muted">You have no pictures yet.</p> : (
              <div className="img-pick" role="radiogroup" aria-label="Picture of where clients agree">
                {images.map((img) => {
                  const url = store.publicUrl(img.storage_path);
                  // eslint-disable-next-line @next/next/no-img-element
                  return <label key={img.id} title={img.file_name}><img src={url} alt={img.alt_text ?? ""} /><span><input type="radio" name="opt_in_image_url" value={url} defaultChecked={reg.opt_in_image_url === url} required /> {img.file_name.slice(0, 18)}</span></label>;
                })}
              </div>
            )}
          </div>
          <label className="is-wide">Sample message 1 *<textarea name="sample_1" required rows={2} maxLength={320} defaultValue={reg.sample_1} /></label>
          <label className="is-wide">Sample message 2 {type === "local" ? "*" : "(local numbers)"}<textarea name="sample_2" rows={2} maxLength={320} defaultValue={reg.sample_2} /><small className="monarch-muted">Real messages you would send. Each names your office and says how to opt out.</small></label>
          <label>Texts a month, roughly *<select name="monthly_volume" defaultValue={reg.monthly_volume}>{VOLUMES.map((v) => <option key={v} value={v}>Up to {v}</option>)}</select></label>
          <div className="is-wide"><SubmitOnce className="monarch-primary" busy="Saving…">Save and continue</SubmitOnce></div>
        </form>
      )}

      {!choosing && step === "number" && (
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2>2. Choose your number</h2>
          {account?.number_type === "local" && <form method="get" className="monarch-inline-form"><input name="area" defaultValue={sp.area ?? ""} inputMode="numeric" maxLength={3} placeholder="Area code, e.g. 337" aria-label="Area code" required /><button className="monarch-secondary">Find numbers</button></form>}
          {searchError && <p className="field-error" role="alert">{searchError}</p>}
          {numbers.length > 0 && (
            <div className="monarch-table-wrap"><table><tbody>
              {numbers.map((n) => (
                <tr key={n.phoneNumber}><td><b>{n.friendlyName}</b><small className="monarch-subcell">{[n.locality, n.region].filter(Boolean).join(", ")}</small></td>
                  <td><form action={chooseSmsNumberAction}><input type="hidden" name="number" value={n.phoneNumber} /><SubmitOnce className="monarch-primary" busy="Saving…">Choose this number</SubmitOnce></form></td></tr>
              ))}
            </tbody></table></div>
          )}
          <p><Link href="/settings/sms?type=edit">Change the number type or registration answers</Link></p>
        </section>
      )}

      {!choosing && step === "pay" && plan && (
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2>3. Pay and submit</h2>
          <p>{plan.setupItem}: <b>{dollars(plan.setupCents)}</b>, one time, by card. Your number <b>{account?.chosen_number}</b> is then bought for your office and your registration is sent to carriers. After that, the number renews monthly for {creditsLabel(plan.monthlyCredits)} from your credits.</p>
          <form action={startSmsSetupCheckoutAction}><SubmitOnce className="monarch-primary" busy="Opening checkout…">{`Pay ${dollars(plan.setupCents)}`}</SubmitOnce></form>
          <p><Link href="/settings/sms?type=edit">Change the number type or registration answers</Link></p>
        </section>
      )}

      <section className="monarch-panel">
        <div className="monarch-panel-head"><div><h2>Text credits</h2><p>One credit sends one text segment (160 characters). Your number&apos;s monthly renewal also comes out of credits. Credits can&apos;t be transferred or refunded.</p></div></div>
        <form action={buySmsCreditsAction} className="monarch-inline-form" style={{ padding: "0 20px 12px", flexWrap: "wrap" }}>
          <label className="monarch-muted">Packs of {creditsLabel(CREDIT_PACK.credits)} for {dollars(CREDIT_PACK.cents)}:
            <select name="packs" defaultValue="1" style={{ marginLeft: 8 }}>{Array.from({ length: MAX_PACKS }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} ({creditsLabel(n * CREDIT_PACK.credits)}, {dollars(n * CREDIT_PACK.cents)})</option>)}</select>
          </label>
          <SubmitOnce className="monarch-primary" busy="Opening checkout…">Buy credits</SubmitOnce>
        </form>
        <div className="monarch-table-wrap"><table>
          <thead><tr><th>WHEN</th><th>WHAT</th><th>CREDITS</th></tr></thead>
          <tbody>
            {ledger.length === 0 ? <EmptyRow colSpan={3}>No credits yet.</EmptyRow> : ledger.map((e) => (
              <tr key={e.id}><td>{when(e.created_at)}</td><td>{KIND[e.kind]}{e.kind === "renewal" && e.note ? ` · ${e.note}` : ""}</td><td>{e.delta > 0 ? `+${e.delta.toLocaleString("en-US")}` : e.delta.toLocaleString("en-US")}</td></tr>
            ))}
          </tbody>
        </table></div>
      </section>
    </>
  );
}
