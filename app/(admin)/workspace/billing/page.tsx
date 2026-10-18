import Link from "next/link";
import { Badge, EmptyRow, Flash, PageTitle } from "@/components/admin/ui";
import { balance, defaultInvoiceLines, dollars, invoiceView, totals, type InvoiceView } from "@/lib/workspace/rules.ts";
import { todayIso, workspaceLoad, workspaceRepo } from "@/lib/workspace/load";
import { createInvoiceAction, invoiceStatusAction } from "../actions";
import { WorkspaceSetup } from "../setup";

const VIEWS: [InvoiceView | "all", string][] = [["all", "All"], ["draft", "Draft"], ["sent", "Sent"], ["overdue", "Overdue"], ["paid", "Paid"], ["void", "Void"]];

/** Billing: every invoice, filterable by status, with revenue totals and the bank-statement import. */
export default async function BillingPage({ searchParams }: { searchParams: Promise<{ status?: string; year?: string; notice?: string; error?: string }> }) {
  const sp = await searchParams;
  const today = todayIso();
  const result = await workspaceLoad(async () => {
    const repo = workspaceRepo();
    const [invoices, clients] = await Promise.all([repo.listInvoices(), repo.listClients({ includeArchived: true })]);
    return { invoices, clients };
  });
  return (
    <>
      <PageTitle title="Billing">Invoices for the returns you prepare. Import your bank statement to match payments to invoices automatically, then review each one before it is applied.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? <WorkspaceSetup message={result.message} /> : (() => {
        const { invoices, clients } = result.data;
        const names = new Map(clients.map((c) => [c.id, c.full_name]));
        const years = [...new Set(invoices.map((i) => i.tax_year))].sort((a, b) => b - a);
        const year = years.includes(Number(sp.year)) ? Number(sp.year) : null;
        const status = VIEWS.some(([k]) => k === sp.status) ? (sp.status as InvoiceView | "all") : "all";
        const inYear = invoices.filter((i) => !year || i.tax_year === year);
        const shown = inYear.filter((i) => status === "all" || invoiceView(i, today) === status);
        const t = totals(inYear, today);
        const count = (k: InvoiceView | "all") => inYear.filter((i) => k === "all" || invoiceView(i, today) === k).length;
        const link = (k: string) => `/workspace/billing?${new URLSearchParams({ ...(year ? { year: String(year) } : {}), ...(k !== "all" ? { status: k } : {}) })}`;
        const active = clients.filter((c) => !c.archived_at);
        return (
          <>
            <div className="monarch-metrics">
              {[["Invoiced", dollars(t.invoiced)], ["Collected", dollars(t.collected)], ["Outstanding", dollars(t.outstanding)], ["Overdue", dollars(t.overdue)]].map(([l, v]) => <div className="monarch-metric" key={l}><div>{l}</div><strong>{v}</strong></div>)}
            </div>
            <section className="monarch-panel">
              <div className="monarch-panel-head">
                <div className="cl-tabs" style={{ margin: 0, border: 0 }}>{VIEWS.map(([k, label]) => <Link key={k} href={link(k)} className={k === status ? "is-on" : undefined}>{label} ({count(k)})</Link>)}</div>
                <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <form method="get" className="monarch-inline-form">{status !== "all" && <input type="hidden" name="status" value={status} />}<select name="year" defaultValue={year ? String(year) : ""} aria-label="Tax year"><option value="">All years</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select><button className="monarch-secondary">Filter</button></form>
                  <Link className="monarch-primary" href="/workspace/billing/import">Import bank payments</Link>
                </span>
              </div>
              <div className="monarch-table-wrap"><table>
                <thead><tr><th>INVOICE</th><th>CLIENT</th><th>YEAR</th><th>TOTAL</th><th>PAID</th><th>BALANCE</th><th>STATUS</th><th></th></tr></thead>
                <tbody>
                  {shown.length === 0 ? <EmptyRow colSpan={8}>{invoices.length === 0 ? "No invoices yet. Create one below, or from a client's Billing tab." : "No invoices match."}</EmptyRow> : shown.map((i) => (
                    <tr key={i.id}>
                      <td><b>{i.number}</b><small className="monarch-subcell">issued {i.issued_on}{i.due_on ? ` · due ${i.due_on}` : ""}</small></td>
                      <td><Link href={`/workspace/clients/${i.client_id}?tab=billing`}>{names.get(i.client_id) ?? "Unknown"}</Link></td>
                      <td>{i.tax_year}</td><td>{dollars(i.total_cents)}</td><td>{dollars(i.paid_cents)}</td><td>{i.status === "void" ? "—" : dollars(balance(i))}</td>
                      <td><Badge value={invoiceView(i, today)} /></td>
                      <td>
                        <form action={invoiceStatusAction} className="monarch-inline-form" style={{ flexWrap: "wrap" }}>
                          <input type="hidden" name="id" value={i.id} />
                          {i.status === "draft" && <button name="do" value="send" className="monarch-link">Send to client</button>}
                          {i.status !== "paid" && i.status !== "void" && <><input name="amount" aria-label="Amount received" size={9} defaultValue={(balance(i) / 100).toFixed(2)} /><button name="do" value="pay" className="monarch-link">Record payment</button></>}
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </section>
            <form action={createInvoiceAction} id="new-invoice" className="monarch-panel monarch-form" style={{ padding: 20 }}>
              <h2 className="is-wide">New invoice</h2>
              <label>Client *<select name="client_id" required defaultValue=""><option value="" disabled>{active.length ? "Choose a client…" : "Add a client first"}</option>{active.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}</select></label>
              <label>Tax year *<input name="tax_year" required inputMode="numeric" maxLength={4} defaultValue={new Date().getUTCFullYear() - 1} /></label>
              <label>Due date<input name="due_on" type="date" /></label>
              <label>Status<select name="status" defaultValue="sent"><option value="sent">Sent</option><option value="draft">Draft</option></select></label>
              <fieldset className="is-wide"><legend>Lines (the $223 breakdown; change any amount)</legend>
                {defaultInvoiceLines().concat([{ label: "", amount_cents: 0 }, { label: "", amount_cents: 0 }]).map((l, n) => (
                  <span key={n} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                    <input name={`line_label_${n}`} defaultValue={l.label} placeholder="Description" aria-label={`Line ${n + 1} description`} maxLength={120} />
                    <input name={`line_amount_${n}`} defaultValue={l.label ? (l.amount_cents / 100).toFixed(2) : ""} placeholder="Amount" aria-label={`Line ${n + 1} amount`} size={10} />
                  </span>
                ))}
              </fieldset>
              <div className="is-wide"><button className="monarch-primary" disabled={active.length === 0}>Create invoice</button></div>
            </form>
          </>
        );
      })()}
    </>
  );
}
