import { FormattedInput } from "@/components/forms/formatted-input";
import { requireAdmin } from "@/lib/admin";
import { Flash, PageTitle } from "@/components/admin/ui";
import { Modal } from "@/components/ui/modal";
import { dollars, invoiceTotal } from "@/lib/workspace/rules.ts";
import { billingSettings, feeProducts } from "@/lib/workspace/service.ts";
import type { FeeProduct } from "@/lib/workspace/types.ts";
import { workspaceLoad, workspaceRepo } from "@/lib/workspace/load";
import { addFeeProductAction, archiveFeeProductAction, saveBillingSettingsAction, saveFeeProductAction } from "../../workspace/actions";
import { WorkspaceSetup } from "../../workspace/setup";

const ROWS = 8;

function ProductForm({ kind, product }: { kind: "software" | "bank"; product?: FeeProduct }) {
  const lines = product?.lines ?? [];
  return (
    <form action={product ? saveFeeProductAction : addFeeProductAction} className="monarch-form">
      {product && <input type="hidden" name="id" value={product.id} />}
      <input type="hidden" name="kind" value={kind} />
      <label className="is-wide">Name *<input name="name" required maxLength={80} defaultValue={product?.name ?? ""} placeholder={kind === "software" ? "Drake, TaxSlayer, UltraTax…" : "Refund Advantage, Santa Barbara…"} /></label>
      <fieldset className="is-wide">
        <legend>Fees it charges</legend>
        {Array.from({ length: ROWS }, (_, n) => lines[n] ?? { label: "", amount_cents: 0 }).map((l, n) => (
          <span key={n} className="ni-line">
            <input name={`line_label_${n}`} defaultValue={l.label} placeholder="Description" aria-label={`Fee ${n + 1} description`} maxLength={120} />
            <FormattedInput kind="money" name={`line_amount_${n}`} defaultValue={l.label ? (l.amount_cents / 100).toFixed(2) : ""} placeholder="$0.00" aria-label={`Fee ${n + 1} amount`} />
          </span>
        ))}
      </fieldset>
      <div className="is-wide"><button className="monarch-primary">Save</button></div>
    </form>
  );
}

function Products({ kind, title, items }: { kind: "software" | "bank"; title: string; items: FeeProduct[] }) {
  return (
    <section className="monarch-panel" style={{ padding: 20 }}>
      <div className="cl-card-head"><h2>{title}</h2><Modal label={kind === "software" ? "Add software" : "Add bank product"} title={kind === "software" ? "Add tax software" : "Add bank product"} className="monarch-secondary"><ProductForm kind={kind} /></Modal></div>
      {items.length === 0 ? <p className="monarch-muted">None yet.</p> : (
        <ul className="cl-list">{items.map((p) => (
          <li key={p.id}>
            <span><b>{p.name}</b><small className="monarch-subcell">{p.lines.length} {p.lines.length === 1 ? "fee" : "fees"} · {dollars(invoiceTotal(p.lines))}</small></span>
            <span className="cl-card-actions">
              <Modal label="Edit" title={`Edit ${p.name}`} className="monarch-link"><ProductForm kind={kind} product={p} /></Modal>
              <form action={archiveFeeProductAction}><input type="hidden" name="id" value={p.id} /><button className="monarch-link is-danger">Remove</button></form>
            </span>
          </li>
        ))}</ul>
      )}
    </section>
  );
}

/** What goes on every invoice, and the tax software and bank products with the fees each one charges. */
export default async function BillingSettingsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const result = await workspaceLoad(async () => {
    const repo = workspaceRepo();
    return { settings: await billingSettings(repo), products: await feeProducts(repo) };
  });
  return (
    <>
      <PageTitle title="Invoice settings">What goes on your invoices, and the fees your tax software and bank products charge.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? <WorkspaceSetup message={result.message} /> : (() => {
        const { settings, products } = result.data;
        return (
          <>
            <form action={saveBillingSettingsAction} className="monarch-panel monarch-form" style={{ padding: 20 }}>
              <h2 className="is-wide">Invoice footer and sales tax</h2>
              <label className="is-wide">Refund policy<textarea name="refund_policy" rows={4} maxLength={4000} defaultValue={settings.refund_policy ?? ""} /></label>
              <label className="is-wide">Terms and conditions<textarea name="terms" rows={6} maxLength={8000} defaultValue={settings.terms ?? ""} /></label>
              <label>Sales tax (%)<input name="tax_percent" inputMode="decimal" maxLength={7} defaultValue={settings.tax_percent ? String(settings.tax_percent) : ""} placeholder="0" /></label>
              <div className="is-wide"><button className="monarch-primary">Save</button></div>
            </form>
            <Products kind="software" title="Tax software" items={products.filter((p) => p.kind === "software")} />
            <Products kind="bank" title="Bank products" items={products.filter((p) => p.kind === "bank")} />
          </>
        );
      })()}
    </>
  );
}
