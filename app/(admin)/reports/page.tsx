import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { PageTitle } from "@/components/admin/ui";
import { currentTier } from "@/lib/tier-server";
import { allows } from "@/lib/tier.ts";
import { leadsDeps } from "@/lib/leads/server";
import { buildReport } from "@/lib/reports/model.ts";
import { boardStages, workspaceLoad, workspaceRepo } from "@/lib/workspace/load";
import { WorkspaceSetup } from "../workspace/setup";
import { dollars } from "@/lib/workspace/rules.ts";

const money = (cents: number) => dollars(cents);

/** Reports: how the season is going, from the office's own returns, invoices, clients and leads. Read-only. */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const tier = await currentTier();
  const result = await workspaceLoad(async () => {
    const repo = workspaceRepo();
    const [returns, invoices, clients, stages, leads] = await Promise.all([
      repo.listReturns({}), repo.listInvoices({}), repo.listClients({ includeArchived: false }), boardStages(),
      allows(tier, "leads") ? leadsDeps().repo.listLeads({ limit: 5000 }).catch(() => null) : Promise.resolve(null),
    ]);
    return { returns, invoices, clients, stages, leads };
  });
  if (!result.ok) return <WorkspaceSetup message={result.message} />;
  const { returns, invoices, clients, stages, leads } = result.data;
  const years = [...new Set([...returns.map((r) => r.tax_year), ...invoices.map((i) => i.tax_year)])].sort((a, b) => b - a);
  const requested = Number(sp.year);
  const year = years.includes(requested) ? requested : years[0] ?? new Date().getUTCFullYear() - 1;
  const r = buildReport({ year, returns, invoices, clients, leads: leads ? leads.map((l) => ({ source: l.source, status: l.status, created_at: l.created_at })) : null, stages });
  const peak = Math.max(1, ...r.months.map((m) => Math.max(m.invoiced, m.collected)));

  return (
    <>
      <PageTitle title="Reports">{`How the ${year} season is going. These are read-only; open Work, Billing or Contacts to change anything.`}</PageTitle>
      <div className="monarch-page-actions">
        <nav className="subtabs" aria-label="Tax year">
          {(years.includes(year) ? years : [year, ...years]).map((y) => <Link key={y} href={`/reports?year=${y}`} className={"subtab" + (y === year ? " is-on" : "")} aria-current={y === year ? "page" : undefined}>{y}</Link>)}
        </nav>
      </div>

      <div className="monarch-metrics">
        <div className="monarch-metric"><div>Returns</div><strong>{r.returnCount}</strong></div>
        <div className="monarch-metric"><div>Invoiced (sent and paid)</div><strong>{money(r.fees.invoiced)}</strong></div>
        <div className="monarch-metric"><div>Collected</div><strong>{money(r.fees.collected)}</strong></div>
        <div className="monarch-metric"><div>Still owed to you</div><strong>{money(r.fees.outstanding)}</strong></div>
      </div>

      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Returns by stage</h2>
        {r.returnCount === 0 ? <p className="monarch-muted">{`No ${year} returns yet.`}</p> : (
          <div className="monarch-table-wrap"><table><thead><tr><th>STAGE</th><th>RETURNS</th></tr></thead><tbody>{r.byStage.map((s) => <tr key={s.name}><td>{s.name}</td><td>{s.count}</td></tr>)}</tbody></table></div>
        )}
      </section>

      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>E-file and results</h2>
        <div className="monarch-table-wrap"><table><thead><tr><th>E-FILE STATUS</th><th>RETURNS</th></tr></thead><tbody>{r.byEfile.map((e) => <tr key={e.key}><td>{e.label}</td><td>{e.count}</td></tr>)}</tbody></table></div>
        <p className="monarch-muted">Invoices still in draft are not counted in the money figures.</p>
        <p className="monarch-muted">Federal results entered on returns: refunds {money(r.federal.refunds)} · amounts owed {money(r.federal.owed)}.</p>
      </section>

      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>{`Month by month in ${year + 1}`}</h2>
        <div className="monarch-table-wrap">
          <table>
            <thead><tr><th>MONTH</th><th>INVOICED</th><th>COLLECTED</th><th>NEW CLIENTS</th>{leads && <th>NEW LEADS</th>}</tr></thead>
            <tbody>
              {r.months.map((m) => (
                <tr key={m.month}>
                  <td>{m.month}</td>
                  <td>{money(m.invoiced)}<span aria-hidden="true" style={{ display: "block", height: 4, width: `${Math.round((m.invoiced / peak) * 100)}%`, background: "var(--accent, #7a5a1e)", borderRadius: 2 }} /></td>
                  <td>{money(m.collected)}</td>
                  <td>{m.newClients}</td>
                  {leads && <td>{m.newLeads}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="monarch-muted">{`A tax year is worked the next calendar year, so these are the months of ${year + 1}. Money is counted by the month an invoice was issued and the month it was paid.`}</p>
      </section>

      {leads && (
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>{`Where leads came from in ${year + 1}`}</h2>
          {r.leadSources.length === 0 ? <p className="monarch-muted">{`No leads in ${year + 1}.`}</p> : (
            <div className="monarch-table-wrap"><table><thead><tr><th>SOURCE</th><th>LEADS</th></tr></thead><tbody>{r.leadSources.map((s) => <tr key={s.source}><td>{s.source}</td><td>{s.count}</td></tr>)}</tbody></table></div>
          )}
        </section>
      )}
    </>
  );
}
