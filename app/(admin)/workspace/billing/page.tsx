import Link from "next/link";
import { Badge, EmptyRow, Flash, PageTitle } from "@/components/admin/ui";
import { PAYERS } from "@/lib/workspace/types.ts";
import { balance, dollars, invoiceView, totals, type InvoiceView } from "@/lib/workspace/rules.ts";
import { InvoiceLink, loadSheetContext } from "@/components/contacts/invoice-sheet";
import { PaymentPlan } from "@/components/contacts/payment-plan";
import { RecordPayment } from "@/components/contacts/record-payment";
import { paymentsFor } from "@/lib/workspace/receipts";
import { AutoSelect } from "@/components/contacts/auto-select";
import { NewInvoice } from "@/components/contacts/new-invoice";
import { todayIso, workspaceLoad, workspaceRepo } from "@/lib/workspace/load";
import { archiveInvoiceAction, invoiceStatusAction } from "../actions";
import { EditInvoice } from "@/components/contacts/edit-invoice";
import { WorkspaceSetup } from "../setup";

type ViewKey = InvoiceView | "all" | "archived";
const VIEWS: [ViewKey, string][] = [["all", "All"], ["draft", "Draft"], ["sent", "Sent"], ["overdue", "Overdue"], ["paid", "Paid"], ["void", "Void"], ["archived", "Archived"]];

/** Billing: every invoice, filterable by status, with revenue totals and the bank-statement import. */
export default async function BillingPage({ searchParams }: { searchParams: Promise<{ status?: string; year?: string; payer?: string; notice?: string; error?: string }> }) {
  const sp = await searchParams;
  const today = todayIso();
  const sheetCtx = await loadSheetContext();
  const result = await workspaceLoad(async () => {
    const repo = workspaceRepo();
    const [invoices, clients] = await Promise.all([repo.listInvoices(), repo.listClients({ includeArchived: true })]);
    const paid = await paymentsFor(repo, invoices.filter((i) => i.paid_cents > 0).map((i) => i.id));
    const plans = await repo.listInstallments(invoices.map((i) => i.id)).catch(() => []);
    return { invoices, clients, paid, plans };
  });
  return (
    <>
      <PageTitle title="Billing">Invoices for the returns you prepare. Import your bank statement to match payments to invoices automatically, then review each one before it is applied.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? <WorkspaceSetup message={result.message} /> : (() => {
        const { invoices, clients, paid, plans } = result.data;
        const names = new Map(clients.map((c) => [c.id, c.full_name]));
        const thisTaxYear = new Date().getUTCFullYear() - 1;
        // Every year that has an invoice, plus the last four tax years, so a new season is there before its first invoice.
        const years = [...new Set([...invoices.map((i) => i.tax_year), ...Array.from({ length: 5 }, (_, n) => thisTaxYear - n)])].sort((a, b) => b - a);
        const year = years.includes(Number(sp.year)) ? Number(sp.year) : null;
        const status = VIEWS.some(([k]) => k === sp.status) ? (sp.status as ViewKey) : "all";
        const payer = sp.payer === "bank_product" || sp.payer === "self" ? sp.payer : null;
        const inYear = invoices.filter((i) => (!year || i.tax_year === year) && (!payer || i.payer === payer));
        const live = inYear.filter((i) => !i.archived_at);
        const archivedList = inYear.filter((i) => i.archived_at);
        const shown = status === "archived" ? archivedList : live.filter((i) => status === "all" || invoiceView(i, today) === status);
        const t = totals(live, today);
        const count = (k: ViewKey) => (k === "archived" ? archivedList.length : live.filter((i) => k === "all" || invoiceView(i, today) === k).length);
        const link = (k: string) => `/workspace/billing?${new URLSearchParams({ ...(year ? { year: String(year) } : {}), ...(payer ? { payer } : {}), ...(k !== "all" ? { status: k } : {}) })}`;
        const active = clients.filter((c) => !c.archived_at);
        return (
          <>
            <div className="cl-head-actions"><NewInvoice back="/workspace/billing" year={new Date().getUTCFullYear() - 1} clients={active.map((c) => ({ id: c.id, name: c.full_name }))} disabled={active.length === 0} /></div>
            <div className="monarch-metrics">
              {[["Invoiced", dollars(t.invoiced)], ["Collected", dollars(t.collected)], ["Outstanding", dollars(t.outstanding)], ["Overdue", dollars(t.overdue)]].map(([l, v]) => <div className="monarch-metric" key={l}><div>{l}</div><strong>{v}</strong></div>)}
            </div>
            <section className="monarch-panel">
              <div className="monarch-panel-head">
                <div className="cl-tabs" style={{ margin: 0, border: 0 }}>{VIEWS.map(([k, label]) => <Link key={k} href={link(k)} className={k === status ? "is-on" : undefined}>{label} ({count(k)})</Link>)}</div>
                <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <form method="get" className="monarch-inline-form">{status !== "all" && <input type="hidden" name="status" value={status} />}<AutoSelect name="payer" label="Paid by" defaultValue={payer ?? ""} options={[{ value: "", label: "Everyone" }, { value: "bank_product", label: "Bank product" }, { value: "self", label: "Out of pocket" }]} /><AutoSelect name="year" label="Tax year" defaultValue={year ? String(year) : ""} options={[{ value: "", label: "All years" }, ...years.map((y) => ({ value: String(y), label: String(y) }))]} /></form>
                  <Link className="monarch-primary" href="/workspace/billing/import">Import bank payments</Link>
                </span>
              </div>
              <div className="monarch-table-wrap"><table>
                <thead><tr><th>INVOICE</th><th>CLIENT</th><th>YEAR</th><th>TOTAL</th><th>PAID</th><th>BALANCE</th><th>STATUS</th><th>PAYMENT TYPE</th><th></th></tr></thead>
                <tbody>
                  {shown.length === 0 ? <EmptyRow colSpan={9}>{invoices.length === 0 ? "No invoices yet. Create one below, or from a client's Billing tab." : "No invoices match."}</EmptyRow> : shown.map((i) => (
                    <tr key={i.id}>
                      <td><b><InvoiceLink invoice={i} clientName={names.get(i.client_id) ?? "Client"} ctx={sheetCtx} payments={paid.filter((p) => p.invoice_id === i.id)} plan={plans.filter((p) => p.invoice_id === i.id)} /></b><small className="monarch-subcell">issued {i.issued_on}{i.due_on ? ` · due ${i.due_on}` : ""}</small></td>
                      <td><Link href={`/workspace/clients/${i.client_id}?tab=billing`}>{names.get(i.client_id) ?? "Unknown"}</Link></td>
                      <td>{i.tax_year}</td><td>{dollars(i.total_cents)}</td><td>{dollars(i.paid_cents)}</td><td>{i.status === "void" ? "—" : dollars(balance(i))}</td>
                      <td><Badge value={invoiceView(i, today)} /></td>
                      <td>{i.payer ? PAYERS[i.payer] : "—"}</td>
                      <td>
                        <form action={invoiceStatusAction} className="monarch-inline-form" style={{ flexWrap: "wrap" }}>
                          <input type="hidden" name="id" value={i.id} />
                          {i.status === "draft" && <button name="do" value="send" className="monarch-link">Send to client</button>}
                          
                        </form>
                        {i.status !== "paid" && i.status !== "void" && <RecordPayment invoice={i} back="/workspace/billing" today={today} />}
                        <EditInvoice invoice={i} back="/workspace/billing" />
                        {i.status !== "void" && i.paid_cents === 0 && <form action={invoiceStatusAction}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="back" value="/workspace/billing" /><button name="do" value="void" className="monarch-link is-danger">Void</button></form>}
                        {i.status === "void" && <form action={archiveInvoiceAction}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="back" value="/workspace/billing" /><input type="hidden" name="archive" value={i.archived_at ? "no" : "yes"} /><button className="monarch-link">{i.archived_at ? "Restore" : "Archive"}</button></form>}
                        <PaymentPlan invoice={i} plan={plans.filter((p) => p.invoice_id === i.id)} back="/workspace/billing" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </section>
          </>
        );
      })()}
    </>
  );
}
