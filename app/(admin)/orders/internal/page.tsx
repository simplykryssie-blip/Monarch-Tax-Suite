import { commerceRepo, requireAdmin } from "@/lib/admin";
import { createInternalLicenseAction } from "../../actions";
import { PLATFORM_GUIDES, PLATFORM_ORDER } from "@/lib/commerce/platforms.ts";
import { Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";

export default async function InternalLicensePage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const result = await load(() => commerceRepo().listProducts());
  return (
    <>
      <PageTitle title="Internal license (no payment)" back={{ href: "/orders", label: "Orders" }}>
        For your own sites and partners. This is not a sale: no payment is taken and none is recorded. It creates a $0 order labelled as internal, a pending license and an installation request.
      </PageTitle>
      <Flash {...await searchParams} />
      {!result.ok ? (
        <SetupRequired message={result.message} />
      ) : (
        <section className="monarch-panel monarch-pad">
          <div className="monarch-notice">
            <b>NEXT STEPS</b>
            After saving you land on the license page: press <b>Issue key</b> (the key is shown once; copy it then), and authorize the domain. Real customer purchases must still be recorded from a real Stripe payment (Reconcile a past purchase).
          </div>
          <form action={createInternalLicenseAction} className="monarch-form">
            <label>Customer name<input name="full_name" required maxLength={120} /></label>
            <label>Customer email<input name="email" type="email" required maxLength={254} /></label>
            <label>Telephone (kept in the order notes)<input name="phone" type="tel" maxLength={30} /></label>
            <label>Product
              <select name="product_id" required>
                {result.data.filter((p) => p.status !== "archived" && p.access_type === "license").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label>Domain where it will run (the exact site hosting the embed)<input name="domain" required maxLength={253} placeholder="example.com" /></label>
            <label>Platform
              <select name="platform" required defaultValue="gohighlevel">
                {PLATFORM_ORDER.map((p) => <option key={p} value={p}>{PLATFORM_GUIDES[p].label}</option>)}
              </select>
            </label>
            <label>Website or funnel URL (optional)<input name="website_url" maxLength={500} placeholder="https://…" /></label>
            <label className="is-wide">Why this license is free (for the record)<input name="reason" required maxLength={300} placeholder="Owner's own GoHighLevel account" /></label>
            <label className="monarch-check is-wide">
              <input type="checkbox" name="confirm" required /> I understand this creates a $0 internal license, not a sale, and records no payment.
            </label>
            <div className="is-wide"><button className="monarch-primary" type="submit">Create internal license</button></div>
          </form>
        </section>
      )}
    </>
  );
}
