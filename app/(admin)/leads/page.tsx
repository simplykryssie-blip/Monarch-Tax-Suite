import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { EmptyRow, Flash, PageTitle } from "@/components/admin/ui";
import { filterFrom } from "@/lib/leads/service.ts";
import { leadsDeps } from "@/lib/leads/server";
import { LEAD_SOURCES, LEAD_STATUSES, SOURCE_KEYS, STATUS_KEYS } from "@/lib/leads/types.ts";
import { day, leadsLoad, LeadsSetupRequired, sourceLabel, StatusBadge } from "./parts";

type SP = { q?: string; source?: string; status?: string; from?: string; to?: string; notice?: string; error?: string };

/** Every prospect in one list, with search and filters by source, status and the date they came in. */
export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireAdmin();
  const sp = await searchParams;
  const filter = filterFrom(sp);
  const result = await leadsLoad(() => leadsDeps().repo.listLeads({ ...filter, limit: 500 }));
  const query = new URLSearchParams(Object.entries(filter).filter(([, v]) => v !== undefined) as [string, string][]).toString();
  const filtered = Boolean(query);
  return (
    <>
      <PageTitle title="Leads">Every prospect in one place, whatever brought them in. The free WISP audit adds leads on its own; add others by hand or import a spreadsheet.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? <LeadsSetupRequired message={result.message} /> : (
        <section className="monarch-panel">
          <div className="monarch-panel-head">
            <h2>{filtered ? "Matching leads" : "All leads"}</h2>
            <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link className="monarch-primary" href="/leads/new">Add lead</Link>
              <Link className="monarch-secondary" href="/leads/import">Import CSV</Link>
              <a className="monarch-secondary" href={`/leads/export${query ? `?${query}` : ""}`}>Export CSV</a>
            </span>
          </div>
          <form method="get" className="monarch-inline-form leads-filters" style={{ padding: "0 20px 16px", flexWrap: "wrap" }}>
            <input name="q" type="search" placeholder="Search name, email or firm" defaultValue={filter.q ?? ""} aria-label="Search" maxLength={100} />
            <select name="source" defaultValue={filter.source ?? ""} aria-label="Source">
              <option value="">Any source</option>
              {SOURCE_KEYS.map((s) => <option key={s} value={s}>{LEAD_SOURCES[s]}</option>)}
            </select>
            <select name="status" defaultValue={filter.status ?? ""} aria-label="Status">
              <option value="">Any status</option>
              {STATUS_KEYS.map((s) => <option key={s} value={s}>{LEAD_STATUSES[s]}</option>)}
            </select>
            <label>From <input name="from" type="date" defaultValue={filter.from ?? ""} /></label>
            <label>To <input name="to" type="date" defaultValue={filter.to ?? ""} /></label>
            <button className="monarch-secondary">Filter</button>
            {filtered && <Link href="/leads">Clear</Link>}
          </form>
          <div style={{ padding: "0 20px 12px" }} className="monarch-muted">
            {result.data.length}{result.data.length === 500 ? "+" : ""} {result.data.length === 1 ? "lead" : "leads"}
            {STATUS_KEYS.map((s) => { const n = result.data.filter((l) => l.status === s).length; return n ? ` · ${n} ${LEAD_STATUSES[s].toLowerCase()}` : ""; }).join("")}
          </div>
          <div className="monarch-table-wrap">
            <table>
              <thead><tr><th>LEAD</th><th>FIRM</th><th>SOURCE</th><th>STATUS</th><th>AUDIT SCORE</th><th>CREATED</th><th>LAST CONTACTED</th></tr></thead>
              <tbody>
                {result.data.length === 0 ? (
                  <EmptyRow colSpan={7}>{filtered ? "No leads match these filters." : "No leads yet. They'll appear here as visitors finish the WISP audit, or add one above."}</EmptyRow>
                ) : result.data.map((l) => (
                  <tr key={l.id}>
                    <td><Link href={`/leads/${l.id}`}><b>{l.full_name}</b></Link><small className="monarch-subcell">{l.email}{l.phone ? ` · ${l.phone}` : ""}</small></td>
                    <td>{l.firm_name ?? "—"}</td>
                    <td>{sourceLabel(l.source)}</td>
                    <td><StatusBadge status={l.status} /></td>
                    <td>{l.audit_score === null ? "—" : <><b>{l.audit_score}</b>/100</>}</td>
                    <td>{day(l.created_at)}</td>
                    <td>{day(l.last_contacted_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
