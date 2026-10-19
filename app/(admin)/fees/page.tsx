import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { EmptyRow, Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { dollars, yearParam } from "@/lib/fees/engine.ts";
import { feesDeps } from "@/lib/fees/server";
import { overview } from "@/lib/fees/service.ts";
import { FeesNav, YearPicker } from "./parts";

export default async function FeesOverview({ searchParams }: { searchParams: Promise<{ year?: string; notice?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const year = yearParam(sp.year);
  const result = await load(() => overview(feesDeps(), year));
  return (
    <>
      <PageTitle title="Fees & Statements">What each office owes for its returns under your fee schedule, what&apos;s been collected through bank products or paid by the ERO, and the balance. Open an office for its statement.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      <FeesNav active="overview" />
      {!result.ok ? <SetupRequired message={result.message} /> : (() => {
        const { offices, unmatched, hasSchedule } = result.data;
        const sum = (k: "owed" | "collected" | "balance" | "returns") => offices.reduce((s, o) => s + o.totals[k], 0);
        return (
          <div className="efin-flow">
            {!hasSchedule && <div className="monarch-notice"><b>NO FEE SCHEDULE YET</b> Returns are charged from your fee schedule. <Link href="/fees/schedule">Set up your fees</Link> first. You can start from Monarch&apos;s template and change any amount.</div>}
            {unmatched > 0 && <div className="monarch-notice"><b>{unmatched} BANK {unmatched === 1 ? "ROW" : "ROWS"} TO LINK</b> Some bank rows didn&apos;t match a return. <Link href="/fees/bank">Link them</Link> so the money counts.</div>}
            <YearPicker year={year} action="/fees" />
            <div className="monarch-metrics">
              <div className="monarch-metric"><div>Fees owed · {sum("returns")} returns</div><strong>{dollars(sum("owed"))}</strong></div>
              <div className="monarch-metric"><div>Collected</div><strong>{dollars(sum("collected"))}</strong></div>
              <div className="monarch-metric"><div>Balance</div><strong>{dollars(sum("balance"))}</strong></div>
            </div>
            <section className="monarch-panel">
              <div className="monarch-panel-head">
                <div><h2>Offices · tax year {year}</h2><p>An office is a firm in My Service Bureau. Returns are recorded by hand or imported from your tax software.</p></div>
                <Link className="monarch-primary" href="/fees/import">Import returns</Link>
              </div>
              <div className="monarch-table-wrap"><table>
                <thead><tr><th>OFFICE</th><th>RETURNS</th><th>FEES OWED</th><th>COLLECTED</th><th>BALANCE</th><th>OWED BY ERO</th><th>FEES</th></tr></thead>
                <tbody>
                  {offices.length === 0 ? <EmptyRow colSpan={7}>No offices yet. Add a firm in My Service Bureau first.</EmptyRow> : offices.map(({ office, totals, hasOverride }) => (
                    <tr key={office.id}>
                      <td><Link href={`/fees/offices/${office.id}?year=${year}`}><b>{office.name}</b></Link>{office.archived && <div className="monarch-muted">Archived</div>}</td>
                      <td>{totals.returns}</td>
                      <td>{dollars(totals.owed)}</td>
                      <td>{dollars(totals.collected)}</td>
                      <td><b>{dollars(totals.balance)}</b></td>
                      <td>{totals.owedByEro ? dollars(totals.owedByEro) : "—"}</td>
                      <td>{hasOverride ? "Own amounts" : <span className="monarch-muted">Bureau schedule</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </section>
          </div>
        );
      })()}
    </>
  );
}
