import { requireAdmin } from "@/lib/admin";
import { Flash, PageTitle } from "@/components/admin/ui";
import { billingProblems, dollars } from "@/lib/billing/plans.ts";
import { planStatus } from "@/lib/billing/setup.ts";
import { billingSetupPort, billingStripe } from "@/lib/billing/stripe-port";
import { setUpBillingAction } from "./actions";

export default async function BillingSetupPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const { notice, error } = await searchParams;
  const problems = billingProblems(process.env);
  const s = billingStripe();
  let rows: Awaited<ReturnType<typeof planStatus>> = [];
  let loadError: string | null = null;
  if (s) {
    try {
      rows = await planStatus(billingSetupPort(s.stripe));
    } catch (e) {
      loadError = e instanceof Error && /api key/i.test(e.message) ? "Stripe rejected the billing key. Save a fresh secret key for this environment and redeploy." : "Couldn't read the plans from Stripe.";
    }
  }
  const missing = rows.filter((r) => !r.exists).length;
  return (
    <>
      <PageTitle title="Billing setup">One-time setup of the subscription plans in Verexa HQ&apos;s Stripe account. Safe to run again: it only creates what is missing.</PageTitle>
      <Flash notice={notice} error={error} />
      <section className="monarch-panel" style={{ padding: 20 }}>
        {problems.length > 0 && (<><p>Billing isn&apos;t fully configured on this deployment:</p><ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></>)}
        {loadError && <p className="monarch-alert is-error" role="alert">{loadError}</p>}
        {s && !loadError && (
          <>
            <p>Stripe <b>{s.livemode ? "LIVE" : "test"}</b> mode.</p>
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>PLAN</th><th>PRICE</th><th>STATUS</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.lookupKey}><td>{r.label.replace(/^Verexa HQ: /, "")}</td><td>{dollars(r.wanted)}/mo</td><td>{!r.exists ? "Missing" : r.found === r.wanted ? "Ready" : `Exists at ${r.found === null ? "an unknown amount" : dollars(r.found)}: needs attention`}</td></tr>
              ))}</tbody>
            </table></div>
            <form action={setUpBillingAction} style={{ marginTop: 16 }}>
              {s.livemode && <label className="monarch-check"><input type="checkbox" name="live" /> <span>I understand this creates the plans in my LIVE Stripe account.</span></label>}
              <button className="monarch-primary">{missing ? `Create ${missing} missing plan${missing === 1 ? "" : "s"} and portal settings` : "Check portal settings again"}</button>
            </form>
            <p className="monarch-muted">Next: add the webhook endpoint <code>/api/stripe/billing-webhook</code> in Stripe for checkout.session.completed, invoice.paid, invoice.payment_failed, customer.subscription.updated and customer.subscription.deleted, and save its signing secret as STRIPE_BILLING_WEBHOOK_SECRET.</p>
          </>
        )}
      </section>
    </>
  );
}
