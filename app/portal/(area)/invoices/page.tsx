import { isOverdue, owed } from "@/lib/portal/invoices.ts";
import { requirePortal } from "@/lib/portal/server";

const usd = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export default async function PortalInvoices() {
  const ctx = await requirePortal();
  const invoices = await ctx.reader.invoices();
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <h1 className="office-h1">Invoices</h1>
      {invoices.length === 0 ? (
        <section className="monarch-panel" style={{ padding: 20 }}><p className="monarch-muted">No invoices yet. When {ctx.office.name} sends you one, it will be here.</p></section>
      ) : invoices.map((i) => (
        <section key={i.id} className="monarch-panel" style={{ padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>{i.number} <span className="monarch-muted">· {i.tax_year}</span></h2>
          <p style={{ margin: "0 0 8px" }}>
            <b>{i.status === "paid" ? "Paid" : isOverdue(i, today) ? "Overdue" : "Due"}</b>
            {i.status === "paid" ? (i.paid_on ? ` on ${i.paid_on}` : "") : i.due_on ? ` ${i.due_on}` : ""}
          </p>
          <div className="monarch-table-wrap">
            <table className="monarch-table">
              <tbody>
                {i.lines.map((l, n) => <tr key={n}><td>{l.label}</td><td style={{ textAlign: "right" }}>{usd(l.amount_cents)}</td></tr>)}
                <tr><td><b>Total</b></td><td style={{ textAlign: "right" }}><b>{usd(i.total_cents)}</b></td></tr>
                {i.paid_cents > 0 && <tr><td>Paid</td><td style={{ textAlign: "right" }}>−{usd(i.paid_cents)}</td></tr>}
                {owed(i) > 0 && <tr><td><b>Balance</b></td><td style={{ textAlign: "right" }}><b>{usd(owed(i))}</b></td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
