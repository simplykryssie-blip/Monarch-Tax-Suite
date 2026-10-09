import { createVersionAction, recordVersionChangeAction, setVersionStatusAction, updateVersionAction } from "@/app/(admin)/actions";
import { checkVersionPriceAction, createVersionPriceAction, linkVersionPriceAction } from "@/app/(admin)/product-actions";
import { publishBlockersForVersion } from "@/lib/commerce/stripe-verify.ts";
import { PriceFacts, VerificationBlock } from "./stripe-facts";
import { CALCULATOR_TAX_YEARS } from "@/lib/calculator/years";
import type { ProductVersion, VersionChange } from "@/lib/commerce/types.ts";
import { Badge, EmptyRow, label, money, when } from "./ui";

/** Stripe price workflow for one version: check → (link existing | create new) → publish, each step explicit. */
function VersionStripe({ productId, v, stripeReady }: { productId: string; v: ProductVersion; stripeReady: boolean }) {
  const s = v.stripe_verification;
  const hidden = (<><input type="hidden" name="product_id" value={productId} /><input type="hidden" name="id" value={v.id} /></>);
  const blockers = publishBlockersForVersion(v);
  return (
    <div className="sv-flow">
      <b>{v.label}: Stripe update price</b> · catalog price {money(v.update_price_cents)} one-time
      <VerificationBlock v={s} emptyText={v.stripe_update_price_id ? `Linked to ${v.stripe_update_price_id}, but not verified with Stripe yet.` : "No Stripe price linked yet."} />
      <form action={checkVersionPriceAction}>{hidden}<button className="monarch-secondary" disabled={!stripeReady}>Check Stripe price</button><span className="monarch-muted">Looks up the Annual Update product&apos;s prices. Changes nothing.</span></form>
      {(s?.state === "reuse_candidate" || s?.state === "ambiguous") && (s.candidates ?? []).map((c) => (
        <form key={c.id} action={linkVersionPriceAction}>
          {hidden}<input type="hidden" name="price_id" value={c.id} />
          <PriceFacts price={c} />
          <label className="monarch-check"><input type="checkbox" name="confirm" required /> Use this price for {v.label}</label>
          <button className="monarch-secondary" disabled={!stripeReady}>Link price</button>
        </form>
      ))}
      {s?.state === "create_required" && (
        <form action={createVersionPriceAction}>
          {hidden}
          <label className="monarch-check"><input type="checkbox" name="confirm" required /> Create a new {money(v.update_price_cents)} USD one-time price on the existing Annual Tax-Year Update product in Stripe ({s.mode} mode)</label>
          <button className="monarch-secondary" disabled={!stripeReady}>Create &amp; link price</button>
        </form>
      )}
      {v.status !== "available" && (
        <form action={setVersionStatusAction}>
          {hidden}<input type="hidden" name="status" value="available" />
          {blockers.length ? <span className="monarch-muted">Publish blocked: {blockers.join(" ")}</span> : (
            <>
              <label className="monarch-check"><input type="checkbox" name="confirm" required /> Publish {v.label}: customers can buy it for {money(v.update_price_cents)} via <code>{v.stripe_update_price_id}</code></label>
              <button className="monarch-primary">Publish version</button>
            </>
          )}
        </form>
      )}
    </div>
  );
}

export function VersionsPanel({ productId, versions, changes, stripeReady = false }: { productId: string; versions: ProductVersion[]; changes: Record<string, VersionChange[]>; stripeReady?: boolean }) {
  return (
    <section className="monarch-panel monarch-pad">
      <h2 className="monarch-h2">Tax-year versions &amp; annual updates</h2>
      <p className="monarch-muted">
        The first purchase licenses the newest available version. Customers may buy a newer tax-year version as a one-time update; bug fixes for a
        version they own are included. Calculator code currently contains tax years: {CALCULATOR_TAX_YEARS.join(", ")}.
      </p>
      <div className="monarch-table-wrap">
        <table>
          <thead><tr><th>VERSION</th><th>STATUS</th><th>RELEASE DATE</th><th>UPDATE PRICE</th><th>STRIPE UPDATE PRICE</th><th></th></tr></thead>
          <tbody>
            {versions.length === 0 ? <EmptyRow colSpan={6}>No versions yet.</EmptyRow> : versions.map((v) => (
              <tr key={v.id}>
                <td><b>{v.label}</b><small className="monarch-subcell">Tax year {v.tax_year}</small></td>
                <td><Badge value={v.status} /></td>
                <td>{v.release_date ?? "—"}</td>
                <td>{money(v.update_price_cents)} one-time</td>
                <td>{v.stripe_update_price_id ? <code>{v.stripe_update_price_id}</code> : "Not linked"}<small className="monarch-subcell">{v.stripe_verification?.state === "linked_verified" ? `Stripe-verified (${v.stripe_verification.mode})` : "Not verified"}</small></td>
                <td>
                  <div className="monarch-inline-actions">
                    {v.status !== "available" && <span className="monarch-muted">Publish below after verifying its Stripe price</span>}
                    {v.status === "available" && (
                      <form action={setVersionStatusAction}><input type="hidden" name="product_id" value={productId} /><input type="hidden" name="id" value={v.id} /><input type="hidden" name="status" value="retired" /><button className="monarch-secondary">Stop selling</button></form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {versions.map((v) => <VersionStripe key={`s-${v.id}`} productId={productId} v={v} stripeReady={stripeReady} />)}

      {versions.map((v) => (
        <details key={v.id} className="monarch-details">
          <summary>{v.label}: edit, changes &amp; bug fixes ({(changes[v.id] ?? []).length})</summary>
          <form action={updateVersionAction} className="monarch-form">
            <input type="hidden" name="product_id" value={productId} /><input type="hidden" name="id" value={v.id} />
            <label>Label<input name="label" maxLength={80} defaultValue={v.label} /></label>
            <label>Release date<input name="release_date" type="date" defaultValue={v.release_date ?? ""} /></label>
            <label>Update price (one-time)<input name="update_price" required inputMode="decimal" defaultValue={(v.update_price_cents / 100).toFixed(2)} /></label>
            <div className="is-wide"><button className="monarch-secondary" type="submit">Save version</button></div>
          </form>
          <form action={recordVersionChangeAction} className="monarch-inline-form">
            <input type="hidden" name="product_id" value={productId} /><input type="hidden" name="id" value={v.id} />
            <select name="kind" defaultValue="maintenance"><option value="maintenance">Bug fix / correction (included)</option><option value="release">Release note</option></select>
            <input name="summary" required maxLength={1000} placeholder="What changed?" />
            <button className="monarch-secondary">Record change</button>
          </form>
          <div className="monarch-table-wrap">
            <table>
              <thead><tr><th>WHEN</th><th>TYPE</th><th>CHANGE</th></tr></thead>
              <tbody>
                {(changes[v.id] ?? []).length === 0 ? <EmptyRow colSpan={3}>No changes recorded.</EmptyRow> : (changes[v.id] ?? []).map((c) => (
                  <tr key={c.id}><td>{when(c.created_at)}</td><td>{c.kind === "maintenance" ? "Bug fix (included)" : label(c.kind)}</td><td className="monarch-wrap">{c.summary}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}

      <form action={createVersionAction} className="monarch-form monarch-add-version">
        <input type="hidden" name="product_id" value={productId} />
        <label>New tax year<input name="tax_year" required inputMode="numeric" placeholder="2027" /></label>
        <label>Label (optional)<input name="label" maxLength={80} placeholder="2027 Tax Year" /></label>
        <label>Release date (optional)<input name="release_date" type="date" /></label>
        <label>Update price<input name="update_price" inputMode="decimal" defaultValue="50.00" /></label>
        <div className="is-wide"><button className="monarch-secondary" type="submit">Add version (draft)</button></div>
      </form>
    </section>
  );
}
