import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { Badge, EmptyRow, Flash, load, PageTitle, SetupRequired, when } from "@/components/admin/ui";
import { ActionForm } from "../../../efin/action-form";
import { dollars, returnLine } from "@/lib/fees/engine.ts";
import { feesDeps } from "@/lib/fees/server";
import { archiveReturnAction, markPaidAction, reapplyFeesAction, restoreReturnAction, updateReturnAction } from "../../actions";
import { FeesNav, UUID } from "../../parts";

export default async function ReturnPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const deps = feesDeps();
  const result = await load(async () => {
    const ret = await deps.repo.getReturn(id);
    if (!ret) return null;
    const [fees, receipts, banks, offices, events] = await Promise.all([deps.repo.listFees([id]), deps.repo.listReceipts({ returnIds: [id] }), deps.repo.listBanks(), deps.repo.listOffices(), deps.repo.listEvents({ recordId: id, limit: 50 })]);
    return { line: returnLine(ret, fees, receipts), banks, office: offices.find((o) => o.id === ret.organization_id), events };
  });
  if (result.ok && !result.data) notFound();
  return (
    <>
      <PageTitle title={result.ok && result.data ? `Return ${result.data.line.ret.return_ref}` : "Return"} back={result.ok && result.data ? { href: `/fees/offices/${result.data.line.ret.organization_id}?year=${result.data.line.ret.tax_year}`, label: result.data.office?.name ?? "Office" } : { href: "/fees", label: "Fees & Statements" }}>The fees this return was charged, the money received for it, and its history.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      <FeesNav active="overview" />
      {!result.ok ? <SetupRequired message={result.message} /> : (() => {
        const { line: l, banks, events } = result.data!;
        const r = l.ret;
        const bankName = (b: string | null) => (b ? banks.find((x) => x.id === b)?.name ?? "Bank product" : "None");
        return (
          <div className="efin-flow">
            {r.archived_at && <div className="monarch-notice"><b>ARCHIVED</b> This return is left out of statements{r.archive_reason ? `: ${r.archive_reason}` : ""}.</div>}
            <div className="monarch-metrics">
              <div className="monarch-metric"><div>Fees</div><strong>{dollars(l.owed)}</strong></div>
              <div className="monarch-metric"><div>Collected</div><strong>{dollars(l.collected)}</strong></div>
              <div className="monarch-metric"><div>Balance · <Badge value={l.status} /></div><strong>{dollars(l.balance)}</strong></div>
            </div>
            <section className="monarch-panel">
              <div className="monarch-panel-head"><div><h2>Fees charged</h2><p>Fixed when the return was recorded. Re-apply them only if the office&apos;s fees should change for this return.</p></div></div>
              <div className="monarch-table-wrap"><table>
                <thead><tr><th>FEE</th><th>CHARGED ON</th><th>AMOUNT</th></tr></thead>
                <tbody>
                  {l.fees.length === 0 ? <EmptyRow colSpan={3}>No fees. The schedule was empty when this return was recorded.</EmptyRow> : l.fees.map((f) => (
                    <tr key={f.id}><td>{f.label}</td><td>{f.applies === "bank_product" ? "Bank product" : "Every return"}</td><td>{dollars(f.amount_cents)}</td></tr>
                  ))}
                </tbody>
              </table></div>
              <ActionForm action={reapplyFeesAction} className="efin-actions" confirm="Replace this return's fees with the office's current fees?">
                <input type="hidden" name="id" value={r.id} />
                <input name="reason" required minLength={3} maxLength={500} placeholder="Why (kept in the history)" aria-label="Reason" style={{ minWidth: 260 }} />
                <button className="monarch-secondary efin-small">Re-apply current fees</button>
              </ActionForm>
            </section>
            <section className="monarch-panel">
              <div className="monarch-panel-head"><div><h2>Money received</h2><p>Bank amounts come from bank imports. Payments by the ERO are recorded here.</p></div></div>
              <div className="monarch-table-wrap"><table>
                <thead><tr><th>DATE</th><th>FROM</th><th>BANK SAYS OWED</th><th>COLLECTED</th><th>REFERENCE</th></tr></thead>
                <tbody>
                  {l.receipts.length === 0 ? <EmptyRow colSpan={5}>Nothing received yet.</EmptyRow> : l.receipts.map((x) => (
                    <tr key={x.id}><td>{x.received_on ?? x.created_at.slice(0, 10)}</td><td>{x.kind === "bank" ? bankName(x.bank_option_id) : "Paid by ERO"}</td><td>{x.owed_cents === null ? "—" : dollars(x.owed_cents)}</td><td>{dollars(x.collected_cents)}</td><td>{x.reference ?? x.note ?? "—"}</td></tr>
                  ))}
                </tbody>
              </table></div>
              {l.balance > 0 && (
                <ActionForm action={markPaidAction} className="monarch-form" confirm="Record this payment? Recorded payments can't be changed.">
                  <input type="hidden" name="id" value={r.id} />
                  <label>Amount paid (leave blank for the full {dollars(l.balance)})<input name="amount" inputMode="decimal" /></label>
                  <label>Date paid<input name="date" type="date" /></label>
                  <label>Reference<input name="reference" maxLength={120} placeholder="e.g. check or transfer number" /></label>
                  <label>Note<input name="note" maxLength={500} /></label>
                  <div className="is-wide"><button className="monarch-primary">Mark paid</button></div>
                </ActionForm>
              )}
            </section>
            <section className="monarch-panel">
              <div className="monarch-panel-head"><div><h2>Details</h2><p>{r.source === "import" ? "Imported from a CSV" : "Entered by hand"} on {when(r.created_at)}. Changing the bank product re-charges bank fees while nothing has been collected.</p></div></div>
              <ActionForm action={updateReturnAction} className="monarch-form">
                <input type="hidden" name="id" value={r.id} />
                <label>Return reference<input name="return_ref" required maxLength={80} defaultValue={r.return_ref} /></label>
                <label>Taxpayer name<input name="taxpayer_name" required maxLength={200} defaultValue={r.taxpayer_name} /></label>
                <label>Tax year<input name="tax_year" required defaultValue={r.tax_year} inputMode="numeric" /></label>
                <label>Bank product<select name="bank_id" defaultValue={r.bank_option_id ?? ""}><option value="">None (owed by the ERO)</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
                <label>Filed date<input name="filed_on" type="date" defaultValue={r.filed_on ?? ""} /></label>
                <label>Funded date<input name="funded_on" type="date" defaultValue={r.funded_on ?? ""} /></label>
                <label className="is-wide">Notes<input name="notes" maxLength={2000} defaultValue={r.notes ?? ""} /></label>
                <div className="is-wide"><button className="monarch-primary">Save return</button></div>
              </ActionForm>
              <div className="efin-actions" style={{ padding: "0 20px 20px" }}>
                {r.archived_at ? (
                  <ActionForm action={restoreReturnAction}><input type="hidden" name="id" value={r.id} /><button className="monarch-secondary efin-small">Restore</button></ActionForm>
                ) : (
                  <ActionForm action={archiveReturnAction} className="efin-actions" confirm="Archive this return? It's left out of statements; money recorded for it is kept.">
                    <input type="hidden" name="id" value={r.id} />
                    <input name="reason" maxLength={500} placeholder="Reason (optional)" aria-label="Reason" />
                    <button className="monarch-secondary is-danger efin-small">Archive</button>
                  </ActionForm>
                )}
              </div>
            </section>
            <section className="monarch-panel">
              <div className="monarch-panel-head"><div><h2>History</h2></div><Link className="monarch-secondary efin-small" href="/fees/history">All fee history</Link></div>
              <ul className="fees-history">{events.length === 0 ? <li className="monarch-muted">No history yet.</li> : events.map((e) => <li key={e.id}><b>{e.action.replace(/_/g, " ")}</b> · {when(e.created_at)}{e.reason ? ` · ${e.reason}` : ""}</li>)}</ul>
            </section>
          </div>
        );
      })()}
    </>
  );
}
