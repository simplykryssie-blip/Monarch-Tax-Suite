import { EmptyRow, Flash, PageTitle, when } from "@/components/admin/ui";
import { SubmitOnce } from "@/components/admin/submit-once";
import { platformTwilio, platformSendProblems, type AvailableNumber } from "@/lib/automation/twilio.ts";
import { findNumbers, MIN_CREDITS_FOR_NUMBER, smsSetupStep } from "@/lib/sms/service.ts";
import { smsAccount, smsSetupDeps, tenantSms } from "@/lib/sms/server";
import { currentTenantId, MONARCH_TENANT_ID } from "@/lib/tenants.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { buySmsNumberAction, setupSmsAction } from "../actions";

const KIND = { purchase: "Bought", grant: "Added", send: "Text sent", refund: "Given back (text not sent)" } as const;
const REGISTRATION = { not_started: "Not started", submitted: "Submitted, waiting for carriers", approved: "Approved", rejected: "Rejected: contact support" } as const;

/** This office's own texting: its Twilio account, number, carrier registration and prepaid credits. */
export default async function SmsSettingsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string; area?: string }> }) {
  const { notice, error, area } = await searchParams;
  const tenantId = currentTenantId();
  const { route, repo } = await tenantSms(tenantId);
  const account = await smsAccount(repo);

  // Tenant #1 texts from the owner's own Twilio account (Vercel) and pays Twilio directly.
  if (tenantId === MONARCH_TENANT_ID && !account) {
    const problems = platformSendProblems(platformTwilio(process.env));
    const from = platformTwilio(process.env);
    return (
      <>
        <PageTitle title="Text messaging">This office texts from the owner&apos;s own Twilio account. Twilio bills that account directly, so no text credits are used.</PageTitle>
        <Flash notice={notice} error={error} />
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2>{route.ok ? "Connected" : "Not connected yet"}</h2>
          {route.ok
            ? <p>Texts go out from {from.messagingServiceSid ? "your Twilio messaging service" : from.from}. Staff can text a client from the client&apos;s Messages tab.</p>
            : <p className="monarch-muted">{problems.join(" ")}</p>}
          <p className="monarch-muted">These are set in Vercel (server-side): TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN or TWILIO_API_KEY with TWILIO_API_SECRET, and TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID. The same account is the parent of every other office&apos;s texting subaccount. US carriers only deliver texts from a registered number (A2P 10DLC or toll-free verification).</p>
        </section>
      </>
    );
  }

  const step = smsSetupStep(account);
  const [balance, ledger] = await Promise.all([repo.balance().catch(() => 0), repo.ledger(30).catch(() => [])]);
  let numbers: AvailableNumber[] = [];
  let searchError: string | null = null;
  if (step === "number" && area) {
    try {
      numbers = await findNumbers(smsSetupDeps(tenantId), area);
      if (!numbers.length) searchError = `No numbers are free in area code ${area}. Try a nearby one.`;
    } catch (e) {
      searchError = e instanceof ValidationError ? e.message : "Numbers could not be searched. Please try again.";
    }
  }
  return (
    <>
      <PageTitle title="Text messaging">Your office texts clients from its own number, on its own Twilio account. Texts use prepaid credits: one credit per message segment (160 characters).</PageTitle>
      <Flash notice={notice} error={error} />
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2>1. Your texting account</h2>
        {step === "start" ? (
          <form action={setupSmsAction}><p className="monarch-muted">Makes a Twilio account for your office alone. Nobody else&apos;s texts or numbers share it.</p><SubmitOnce className="monarch-primary" busy="Setting up…">Set up text messaging</SubmitOnce></form>
        ) : step === "suspended" ? <p>Text messaging is paused for this office. Contact support.</p> : <p>Set up{account?.created_at ? ` ${when(account.created_at)}` : ""}.</p>}
      </section>
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2>2. Your number</h2>
        {account?.from_number ? <p>You text from <b>{account.from_number}</b>.</p> : step !== "number" ? <p className="monarch-muted">Set up your texting account first.</p> : balance < MIN_CREDITS_FOR_NUMBER ? <p className="monarch-muted">Buy text credits (step 4) before choosing a number.</p> : (
          <>
            <form method="get" className="monarch-inline-form"><input name="area" defaultValue={area ?? ""} inputMode="numeric" maxLength={3} placeholder="Area code, e.g. 337" aria-label="Area code" required /><button className="monarch-secondary">Find numbers</button></form>
            {searchError && <p className="field-error" role="alert">{searchError}</p>}
            {numbers.length > 0 && (
              <div className="monarch-table-wrap"><table><tbody>
                {numbers.map((n) => (
                  <tr key={n.phoneNumber}><td><b>{n.friendlyName}</b><small className="monarch-subcell">{[n.locality, n.region].filter(Boolean).join(", ")}</small></td>
                    <td><form action={buySmsNumberAction}><input type="hidden" name="number" value={n.phoneNumber} /><SubmitOnce className="monarch-primary" busy="Buying…">Use this number</SubmitOnce></form></td></tr>
                ))}
              </tbody></table></div>
            )}
          </>
        )}
      </section>
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2>3. Carrier registration</h2>
        <p>{REGISTRATION[account?.registration_status ?? "not_started"]}</p>
        <p className="monarch-muted">US carriers only deliver business texts from a registered number (A2P 10DLC): your business&apos;s legal name, EIN, website and how clients agree to receive texts. Approval usually takes 2 to 4 weeks. Texts can be sent once it&apos;s approved.</p>
      </section>
      <section className="monarch-panel">
        <div className="monarch-panel-head"><div><h2>4. Text credits</h2><p><b>{balance}</b> credit{balance === 1 ? "" : "s"} left. One credit sends one message segment; a text that isn&apos;t delivered to the carrier gives its credits back.</p></div></div>
        <p className="monarch-muted" style={{ padding: "0 20px" }}>Buying credits online isn&apos;t available yet. Contact support to add credits.</p>
        <div className="monarch-table-wrap"><table>
          <thead><tr><th>WHEN</th><th>WHAT</th><th>CREDITS</th></tr></thead>
          <tbody>
            {ledger.length === 0 ? <EmptyRow colSpan={3}>No credits yet.</EmptyRow> : ledger.map((e) => <tr key={e.id}><td>{when(e.created_at)}</td><td>{KIND[e.kind]}{e.note ? ` · ${e.note}` : ""}</td><td>{e.delta > 0 ? `+${e.delta}` : e.delta}</td></tr>)}
          </tbody>
        </table></div>
      </section>
    </>
  );
}
