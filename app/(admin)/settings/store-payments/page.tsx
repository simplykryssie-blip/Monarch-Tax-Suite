import { appOrigin } from "@/lib/admin";
import { Flash, PageTitle } from "@/components/admin/ui";
import { requireSection } from "@/lib/tier-server";
import { describeKey } from "@/lib/store-stripe/keys.ts";
import { loadStoreStripe } from "@/lib/store-stripe/server";
import { checkStoreKeysAction, removeStoreKeysAction, saveStoreKeysAction } from "./actions";

/** The workspace's storefront Stripe keys: which are set and where from. The keys themselves are never shown. */
export default async function StorePaymentsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireSection("store");
  const { notice, error } = await searchParams;
  const st = await loadStoreStripe();
  const hookUrl = `${(await appOrigin()).replace(/\/$/, "")}/api/stripe/webhook`;
  return (
    <>
      <PageTitle title="Store payments">The Stripe account your store sells through (products, licenses, WISP plans). Your keys are saved encrypted and never shown again.</PageTitle>
      <Flash notice={notice} error={error} />
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Where things stand</h2>
        <ul>
          <li>{describeKey("Secret key", st.secretKeySource, st.secretKeyHint, st.mode)}</li>
          <li>{describeKey("Webhook signing secret", st.webhookSecretSource, st.webhookSecretHint, null)}</li>
        </ul>
        <form action={checkStoreKeysAction}><button className="monarch-secondary" disabled={!st.stripe}>Check the connection</button></form>
      </section>
      <section className="monarch-panel" style={{ padding: 20, marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Save or replace your keys</h2>
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
