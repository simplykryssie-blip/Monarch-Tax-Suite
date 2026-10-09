import { commerceRepo, requireAdmin, stripeClient } from "@/lib/admin";
import { reconcilePurchaseAction } from "../../actions";
import { PLATFORM_GUIDES, PLATFORM_ORDER } from "@/lib/commerce/platforms.ts";
import { Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";

export default async function ReconcilePage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const result = await load(() => commerceRepo().listProducts());
  const stripeConfigured = stripeClient() !== null;
  return (
    <>
      <PageTitle title="Reconcile a purchase" back={{ href: "/orders", label: "Orders" }}>
        Record a purchase that was paid before automatic Stripe fulfillment existed. This creates the customer, order, pending license, and installation request.
      </PageTitle>
      <Flash {...await searchParams} />
      {!result.ok ? (
        <SetupRequired message={result.message} />
      ) : (
        <section className="monarch-panel monarch-pad">
          <div className="monarch-notice">
            <b>VERIFICATION</b>
            {stripeConfigured
              ? "The payment intent will be checked live in Stripe: it must have succeeded, and the amount, currency and customer email must match."
              : "Stripe is not connected (no STRIPE_SECRET_KEY), so this cannot be checked automatically. Open the payment in your Stripe dashboard and confirm it succeeded, the amount, and the customer email before submitting."}
          </div>
          <form action={reconcilePurchaseAction} className="monarch-form">
            <label>Customer email<input name="email" type="email" required maxLength={254} /></label>
            <label>Customer name (as on the order)<input name="full_name" maxLength={120} /></label>
            <label>Stripe payment intent ID<input name="payment_intent_id" required pattern="pi_[A-Za-z0-9]+" placeholder="pi_…" /></label>
            <label>Product
              <select name="product_id" required>
                {result.data.filter((p) => p.status !== "archived").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label>Amount paid<input name="amount" required inputMode="decimal" placeholder="75.00" /></label>
            <label>Currency<input name="currency" defaultValue="usd" maxLength={3} /></label>
            <label>Installation type
              <select name="installation_type" defaultValue="done_for_you">
                <option value="done_for_you">Done For You</option>
                <option value="self_service">Self-service</option>
              </select>
            </label>
            <label>Platform
              <select name="platform" required defaultValue="">
                <option value="" disabled>Choose a platform</option>
                {PLATFORM_ORDER.map((p) => <option key={p} value={p}>{PLATFORM_GUIDES[p].label}</option>)}
              </select>
            </label>
            <label>Platform name (if Other)<input name="platform_other" maxLength={80} /></label>
            <label>Website or funnel URL (if known)<input name="website_url" maxLength={500} placeholder="https://…" /></label>
            <label>Domain where it will run (if known)<input name="target_location" maxLength={253} placeholder="example.com" /></label>
            <label className="is-wide">Internal notes<textarea name="notes" rows={3} maxLength={4000} /></label>
            {!stripeConfigured && (
              <label className="monarch-check is-wide">
                <input type="checkbox" name="attest" required /> I verified this payment in the Stripe dashboard: it succeeded, and the amount and customer email match.
              </label>
            )}
            <div className="is-wide"><button className="monarch-primary" type="submit">Reconcile purchase</button></div>
          </form>
        </section>
      )}
    </>
  );
}
