import { requireAdmin } from "@/lib/admin";
import { connectProblems } from "@/lib/connect/config.ts";
import { canTakePayments } from "@/lib/connect/service.ts";
import { connectDeps } from "@/lib/connect/server";
import { currentTenantId } from "@/lib/tenants.ts";
import { Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { connectStripeAction, disconnectStripeAction, refreshStripeAction } from "./actions";

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const { notice, error } = await searchParams;
  const problems = connectProblems(process.env);
  const deps = problems.length ? null : connectDeps(currentTenantId());
  const result = await load(async () => (deps ? deps.repo.getConnection() : null));
  const conn = result.ok ? result.data : null;
  const ready = deps ? canTakePayments(conn, deps.stripe.livemode) : false;
  return (
    <>
      <PageTitle title="Payments">Let clients pay invoices online. Payments go straight to your own Stripe account; the platform never holds your money and takes no fee.</PageTitle>
      <Flash notice={notice} error={error} />
      {!result.ok ? <SetupRequired message={result.message} /> : (
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Stripe</h2>
          {problems.length > 0 && (
            <>
              <p>Online payments aren&apos;t turned on for this deployment yet. The platform administrator needs to add:</p>
              <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            </>
          )}
          {deps && (!conn || conn.status !== "connected") && (
            <>
              <p>{conn ? "Your Stripe account was disconnected." : "No Stripe account is connected."} Connect yours to let clients pay invoices from their portal. You&apos;ll sign in to Stripe and approve the connection; you can disconnect at any time.</p>
              <form action={connectStripeAction}><button className="monarch-primary">Connect Stripe</button></form>
              <p className="monarch-muted">This deployment uses Stripe {deps.stripe.livemode ? "live" : "test"} mode, so connect a {deps.stripe.livemode ? "live" : "test"} account.</p>
            </>
          )}
          {deps && conn && conn.status === "connected" && (
            <>
              <p><b>{ready ? "Connected. Clients can pay invoices online." : "Connected, but not ready to take payments."}</b></p>
              <ul>
                <li>Account: {conn.stripe_account_id} ({conn.livemode ? "live" : "test"})</li>
                <li>Can take payments: {conn.charges_enabled ? "yes" : "not yet. Finish setup in your Stripe dashboard, then refresh."}</li>
                <li>Payouts to your bank: {conn.payouts_enabled ? "on" : "not yet"}</li>
              </ul>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <form action={refreshStripeAction}><button className="monarch-secondary">Refresh from Stripe</button></form>
                <form action={disconnectStripeAction}><button className="monarch-secondary">Disconnect</button></form>
              </div>
              <p className="monarch-muted" style={{ marginTop: 10 }}>Refunds and disputes are handled in your own Stripe dashboard. Invoices you are paid for another way (cash, check, bank transfer) are still recorded under Billing.</p>
            </>
          )}
        </section>
      )}
    </>
  );
}
