import { redirect } from "next/navigation";
import { requireOffice } from "@/lib/office/server";
import { can } from "@/lib/office/permissions.ts";
import { Badge, EmptyRow } from "@/components/admin/ui";
import { dollars, MONTHS, periodLabel, yearParam } from "@/lib/fees/engine.ts";
import { feesDeps } from "@/lib/fees/server";
import { statementFor } from "@/lib/fees/service.ts";

/** The office's own statement, read-only. Same numbers the bureau sees for this office. */
export default async function OfficeStatement({ searchParams }: { searchParams: Promise<{ year?: string; month?: string }> }) {
  const ctx = await requireOffice();
  if (!can(ctx.role, ctx.permissions, "fees.view")) redirect("/office");
  const sp = await searchParams;
  const year = yearParam(sp.year);
  const month = Number(sp.month) >= 1 && Number(sp.month) <= 12 ? Number(sp.month) : null;
  const deps = feesDeps(ctx.tenantId);
  const [s, banks] = await Promise.all([statementFor(deps, ctx.office.id, { taxYear: year, month }), deps.repo.listBanks()]);
  const bankName = (b: string | null) => (b ? banks.find((x) => x.id === b)?.name ?? "Bank product" : "None");
  const qs = `year=${year}${month ? `&month=${month}` : ""}`;
  return (
    <>
      <h1 className="office-h1">Fees &amp; statement</h1>
      <form method="get" className="efin-filter">
        <label className="fees-inline">Tax year<input name="year" defaultValue={year} inputMode="numeric" className="fees-order" /></label>
        <label className="fees-inline">Period<select name="month" defaultValue={month ? String(month) : ""}><option value="">Whole season</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
        <button className="monarch-secondary efin-small">Show</button>
        <a className="monarch-secondary efin-small" href={`/office/statement/download?${qs}&format=pdf`}>PDF</a>
        <a className="monarch-secondary efin-small" href={`/office/statement/download?${qs}&format=csv`}>CSV</a>
      </form>
      <div className="monarch-metrics">
        <div className="monarch-metric"><div>Fees owed · {s.totals.returns} returns</div><strong>{dollars(s.totals.owed)}</strong></div>
        <div className="monarch-metric"><div>Collected</div><strong>{dollars(s.totals.collected)}</strong></div>
        <div className="monarch-metric"><div>Balance{s.totals.owedByEro ? ` · ${dollars(s.totals.owedByEro)} owed by you` : ""}</div><strong>{dollars(s.totals.balance)}</strong></div>
      </div>
      <section className="monarch-panel">
        <div className="monarch-panel-head"><div><h2>{periodLabel(s.period)}</h2><p>{s.byFee.map((f) => `${f.label} ${dollars(f.amount)}`).join(" · ") || "No fees in this period."}</p></div></div>
        <div className="monarch-table-wrap"><table>
          <thead><tr><th>RETURN</th><th>TAXPAYER</th><th>FILED</th><th>BANK PRODUCT</th><th>FEES</th><th>COLLECTED</th><th>BALANCE</th><th>STATUS</th></tr></thead>
          <tbody>
            {s.lines.length === 0 ? <EmptyRow colSpan={8}>No returns in this period.</EmptyRow> : s.lines.map((l) => (
              <tr key={l.ret.id}><td><b>{l.ret.return_ref}</b></td><td>{l.ret.taxpayer_name}</td><td>{l.ret.filed_on ?? "—"}</td><td>{bankName(l.ret.bank_option_id)}</td><td>{dollars(l.owed)}</td><td>{dollars(l.collected)}</td><td><b>{dollars(l.balance)}</b></td><td><Badge value={l.status} /></td></tr>
            ))}
          </tbody>
        </table></div>
      </section>
    </>
  );
}
