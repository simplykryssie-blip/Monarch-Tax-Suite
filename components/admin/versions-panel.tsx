import { createVersionAction, recordVersionChangeAction, setVersionStatusAction, updateVersionAction } from "@/app/(admin)/actions";
import { CALCULATOR_TAX_YEARS } from "@/lib/calculator/years";
import type { ProductVersion, VersionChange } from "@/lib/commerce/types.ts";
import { Badge, EmptyRow, label, money, when } from "./ui";

export function VersionsPanel({ productId, versions, changes }: { productId: string; versions: ProductVersion[]; changes: Record<string, VersionChange[]> }) {
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
                <td>{v.stripe_update_price_id ? <code>{v.stripe_update_price_id}</code> : "Not linked"}</td>
                <td>
                  <div className="monarch-inline-actions">
                    {v.status !== "available" && (
                      <form action={setVersionStatusAction}><input type="hidden" name="product_id" value={productId} /><input type="hidden" name="id" value={v.id} /><input type="hidden" name="status" value="available" /><button className="monarch-secondary">Make available</button></form>
                    )}
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

      {versions.map((v) => (
        <details key={v.id} className="monarch-details">
          <summary>{v.label}: edit, changes &amp; bug fixes ({(changes[v.id] ?? []).length})</summary>
          <form action={updateVersionAction} className="monarch-form">
            <input type="hidden" name="product_id" value={productId} /><input type="hidden" name="id" value={v.id} />
            <label>Label<input name="label" maxLength={80} defaultValue={v.label} /></label>
            <label>Release date<input name="release_date" type="date" defaultValue={v.release_date ?? ""} /></label>
            <label>Update price (one-time)<input name="update_price" required inputMode="decimal" defaultValue={(v.update_price_cents / 100).toFixed(2)} /></label>
            <label>Stripe one-time price ID for this update<input name="stripe_update_price_id" defaultValue={v.stripe_update_price_id ?? ""} placeholder="price_…" /></label>
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
        <label className="is-wide">Stripe one-time price ID (optional)<input name="stripe_update_price_id" placeholder="price_…" /></label>
        <div className="is-wide"><button className="monarch-secondary" type="submit">Add version (draft)</button></div>
      </form>
    </section>
  );
}
