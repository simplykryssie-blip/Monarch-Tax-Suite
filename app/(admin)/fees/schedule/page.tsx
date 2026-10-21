import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { EmptyRow, Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { ActionForm } from "../../efin/action-form";
import { dollars, MONARCH_TEMPLATE } from "@/lib/fees/engine.ts";
import { feesDeps } from "@/lib/fees/server";
import { scheduleFor } from "@/lib/fees/service.ts";
import { addLineAction, loadTemplateAction, removeLineAction, updateLineAction } from "../actions";
import { FeesNav } from "../parts";

export default async function FeeSchedulePage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const deps = feesDeps();
  const result = await load(async () => ({ schedule: await scheduleFor(deps, null), banks: await deps.repo.listBanks() }));
  return (
    <>
      <PageTitle title="Fee schedule" back={{ href: "/fees", label: "Fees & Statements" }}>Your bureau&apos;s fees, charged on each return. Every office uses these unless you set its own amounts on the office&apos;s page. A return keeps the fees it was charged when it was recorded, so changing an amount here doesn&apos;t rewrite past statements.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      <FeesNav active="schedule" />
      {!result.ok ? <SetupRequired message={result.message} /> : (() => {
        const { schedule, banks } = result.data;
        const lines = schedule.defaults;
        const bankName = (id: string | null) => (id ? banks.find((b) => b.id === id)?.name ?? "Bank" : "Any bank");
        const every = lines.filter((l) => l.applies === "every_return").reduce((s, l) => s + l.amount_cents, 0);
        return (
          <div className="efin-flow">
            {lines.length === 0 && (
              <section className="monarch-panel">
                <div className="monarch-panel-head"><div><h2>Start from a template</h2><p>A typical price list: {MONARCH_TEMPLATE.map((t) => `${t.label.toLowerCase()} ${dollars(t.amount_cents)}`).join(", ")}: {dollars(MONARCH_TEMPLATE.reduce((s, t) => s + t.amount_cents, 0))} on every return. It&apos;s only a starting point; change or remove any line after loading it.</p></div></div>
                <ActionForm action={loadTemplateAction} className="efin-actions"><button className="monarch-primary efin-small">Load the starter template</button></ActionForm>
              </section>
            )}
            <section className="monarch-panel">
              <div className="monarch-panel-head"><div><h2>Line items</h2><p>{lines.length ? `${dollars(every)} on every return, plus bank-product fees on returns with a bank product.` : "No fees yet."}</p></div></div>
              <div className="monarch-table-wrap"><table>
                <thead><tr><th>FEE</th><th>AMOUNT</th><th>CHARGED ON</th><th>ORDER</th><th></th></tr></thead>
                <tbody>
                  {lines.length === 0 ? <EmptyRow colSpan={5}>No fee lines yet. Load the template above or add a line below.</EmptyRow> : lines.map((l) => (
                    <tr key={l.id}>
                      <td colSpan={4}>
                        <ActionForm action={updateLineAction} className="fees-line-form">
                          <input type="hidden" name="id" value={l.id} />
                          <input name="label" defaultValue={l.label} required maxLength={120} aria-label="Fee name" />
                          <input name="amount" defaultValue={(l.amount_cents / 100).toFixed(2)} required inputMode="decimal" aria-label="Amount in dollars" className="fees-amount" />
                          <select name="applies" defaultValue={l.applies} aria-label="Charged on"><option value="every_return">Every return</option><option value="bank_product">Bank-product returns</option></select>
                          <select name="bank_id" defaultValue={l.bank_option_id ?? ""} aria-label="Bank"><option value="">Any bank</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                          <input name="sort_order" defaultValue={l.sort_order} inputMode="numeric" aria-label="Order" className="fees-order" />
                          <button className="monarch-secondary efin-small">Save</button>
                        </ActionForm>
                        {l.applies === "bank_product" && <div className="monarch-muted">Bank product: {bankName(l.bank_option_id)}</div>}
                      </td>
                      <td>
                        <ActionForm action={removeLineAction} confirm={`Remove "${l.label}"? Returns already recorded keep their fees.`}>
                          <input type="hidden" name="id" value={l.id} />
                          <button className="monarch-secondary is-danger efin-small">Remove</button>
                        </ActionForm>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </section>
            <section className="monarch-panel">
              <div className="monarch-panel-head"><div><h2>Add a fee line</h2><p>For a bank product fee, choose &quot;Bank-product returns&quot; and the bank. Each bank can have its own fee. Banks come from <Link href="/bureau/settings">Software &amp; banking</Link>.</p></div></div>
              <ActionForm action={addLineAction} className="monarch-form">
                <label>Fee name<input name="label" required maxLength={120} placeholder="e.g. Bank product fee" /></label>
                <label>Amount (dollars)<input name="amount" required inputMode="decimal" placeholder="e.g. 39.95" /></label>
                <label>Charged on<select name="applies" defaultValue="every_return"><option value="every_return">Every return</option><option value="bank_product">Bank-product returns only</option></select></label>
                <label>Bank (bank-product fees)<select name="bank_id" defaultValue=""><option value="">Any bank</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
                <div className="is-wide"><button className="monarch-primary">Add fee line</button></div>
              </ActionForm>
            </section>
          </div>
        );
      })()}
    </>
  );
}
