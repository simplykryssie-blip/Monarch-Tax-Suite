import { appOrigin } from "@/lib/admin";
import { connectProblems } from "@/lib/connect/config.ts";
import { connectDeps } from "@/lib/connect/server";
import { currentTenantId } from "@/lib/tenants.ts";
import { Flash, PageTitle } from "@/components/admin/ui";
import { requireSection } from "@/lib/tier-server";
import { describeKey } from "@/lib/store-stripe/keys.ts";
import { loadStoreStripe } from "@/lib/store-stripe/server";
import { checkStoreKeysAction, connectStoreStripeAction, disconnectStoreStripeAction, refreshStoreConnectionAction, removeStoreKeysAction, saveStoreKeysAction } from "./actions";

/** The workspace's storefront Stripe keys: which are set and where from. The keys themselves are never shown. */
export default async function StorePaymentsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireSection("store");
  const { notice, error } = await searchParams;
  const st = await loadStoreStripe();
  const platformReady = Boolean(connectDeps(currentTenantId()));
  const conn = st.connection && st.connection.status === "connected" ? st.connection : null;
  const hookUrl = `${(await appOrigin()).replace(/\/$/, "")}/api/stripe/webhook`;
  return (
    <>
      <PageTitle title="Store payments">The Stripe account your store sells through (products, licenses, WISP plans). Connect your Stripe account with one click, or save your own keys. Keys are saved encrypted and never shown again.</PageTitle>
      <Flash notice={notice} error={error} />
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Where things stand</h2>
        <p className="monarch-muted" style={{ marginTop: 0 }}>Order used: your connected Stripe account, then keys saved here, then (Monarch only) the server&apos;s environment settings.</p>
        <ul>
          <li>{describeKey("Secret key", st.secretKeySource, st.secretKeyHint, st.mode)}</li>
          <li>{describeKey("Webhook signing secret", st.webhookSecretSource, st.webhookSecretHint, null)}</li>
        </ul>
        {st.connectionNote && <p role="status"><b>{st.connectionNote}</b></p>}
        <form action={checkStoreKeysAction}><button className="monarch-secondary" disabled={!st.stripe}>Check the connection</button></form>
      </section>
      <section className="monarch-panel" style={{ padding: 20, marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Connect your Stripe account</h2>
        {!platformReady && (
          <>
            <p>Connecting isn&apos;t turned on for this deployment yet. The platform administrator needs to add:</p>
            <ul>{connectProblems(process.env).map((p) => <li key={p}>{p}</li>)}</ul>
            <p className="monarch-muted">You can still use your own keys below.</p>
          </>
        )}
        {platformReady && !conn && (
          <>
            <p>{st.connection ? "Your Stripe account was disconnected. " : ""}You&apos;ll sign in to Stripe and approve the connection. No keys to copy. Your store and your clients&apos; invoice payments then use this account, and the money goes straight to you. You can disconnect at any time.</p>
            <form action={connectStoreStripeAction}><button className="monarch-primary">Connect Stripe</button></form>
          </>
        )}
        {platformReady && conn && (
          <>
            <ul>
              <li>Account: {conn.accountId} ({conn.livemode ? "live" : "test"})</li>
              <li>Can take payments: {conn.chargesEnabled ? "yes" : "not yet. Finish setup in your Stripe dashboard, then refresh."}</li>
              <li>In use by the store: {st.connectedAccount ? "yes" : "no (see the note above)"}</li>
            </ul>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <form action={refreshStoreConnectionAction}><button className="monarch-secondary">Refresh from Stripe</button></form>
              <form action={disconnectStoreStripeAction} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <label><input type="checkbox" name="confirm" /> Disconnect this account</label>
                <button className="monarch-secondary">Disconnect</button>
              </form>
            </div>
          </>
        )}
      </section>
      <section className="monarch-panel" style={{ padding: 20, marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Or use your own keys</h2>
        <p className="monarch-muted" style={{ marginTop: 0 }}>The fallback. Used only when no Stripe account is connected, or the connected one can&apos;t take payments.</p>
        <form action={saveStoreKeysAction} autoComplete="off">
          <label className="field-label">Stripe secret key<input type="password" name="secret_key" autoComplete="off" placeholder="sk_live_… or rk_live_…" /></label>
          <label className="field-label">Webhook signing secret<input type="password" name="webhook_secret" autoComplete="off" placeholder="whsec_…" /></label>
          <p className="monarch-muted">Leave a box empty to keep what is saved. In Stripe, add a webhook that points at <code>{hookUrl}</code> and copy its signing secret here.</p>
          <button className="monarch-primary">Save</button>
        </form>
      </section>
      {(st.secretKeySource === "settings" || st.webhookSecretSource === "settings") && (
        <section className="monarch-panel" style={{ padding: 20, marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Remove the saved keys</h2>
          <form action={removeStoreKeysAction}>
            <label><input type="checkbox" name="confirm" /> I want to remove the keys saved here. The store stops taking payments unless the server still has keys.</label>
            <div style={{ marginTop: 8 }}><button className="monarch-secondary">Remove</button></div>
          </form>
        </section>
      )}
    </>
  );
}
