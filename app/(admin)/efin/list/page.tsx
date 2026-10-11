import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { Badge, EmptyRow, Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { Icon } from "@/components/admin/icons";
import { maskEfin } from "@/lib/efin/rules.ts";
import { loadSnapshot } from "@/lib/efin/service";
import { EFIN_STATUSES } from "@/lib/efin/types.ts";
import { orgName, personName, Verified } from "../parts";

type Params = { q?: string; status?: string; org?: string; review?: string; notice?: string; error?: string };

export default async function EfinRegistry({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdmin();
  const sp = await searchParams;
  const result = await load(loadSnapshot);
  return (
    <>
      <PageTitle title="EROs & EFINs">Your EROs and their EFINs in one list, like contacts. Open one to see its office, team, assignments and renewals. Dates and verification are what you recorded here, not a live IRS status.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? (
        <SetupRequired message={result.message} />
      ) : (
        (() => {
          const s = result.data;
          const live = s.efins.filter((e) => !e.archived_at);
          const q = (sp.q ?? "").trim().toLowerCase();
          const rows = live.filter((e) => (!sp.status || e.internal_status === sp.status) && (!sp.org || e.organization_id === sp.org) && (!sp.review || s.assignments.some((a) => a.efin_id === e.id && a.state === "pending_review")) && (!q || `${e.efin_last4} ${orgName(s.orgs, e.organization_id)} ${personName(s.people, e.ero_person_id)}`.toLowerCase().includes(q)));
          return (
            <>
              <section className="monarch-panel">
                <div className="monarch-panel-head">
                  <div><h2>{sp.review ? "Assignments waiting for review" : "All EROs"}</h2><p>EFINs are shown masked. Open one to reveal the full number (the reveal is logged).</p></div>
                  <div className="efin-actions"><Link className="monarch-secondary" href="/efin/add">Add another EFIN</Link><Link className="monarch-primary" href="/efin/new"><Icon name="plus" size={16} /> Add an ERO</Link></div>
                </div>
                <form className="efin-filter" method="get" action="/efin/list">
                  <input name="q" defaultValue={sp.q ?? ""} placeholder="Search name, business or last 4" aria-label="Search EFINs" />
                  <select name="status" defaultValue={sp.status ?? ""} aria-label="Status"><option value="">All statuses</option>{EFIN_STATUSES.map((v) => <option key={v} value={v}>{v.replace(/_/g, " ")}</option>)}</select>
                  <select name="org" defaultValue={sp.org ?? ""} aria-label="Organization"><option value="">All businesses</option>{s.orgs.map((o) => <option key={o.id} value={o.id}>{o.legal_name}</option>)}</select>
                  <button className="monarch-secondary efin-small" type="submit">Filter</button>
                </form>
                <div className="monarch-table-wrap">
                  <table>
                    <thead><tr><th>ERO / BUSINESS</th><th>LOCATIONS</th><th>EFIN</th><th>STATUS</th><th>ASSIGNMENT</th><th>VERIFICATION</th><th>RENEWAL</th></tr></thead>
                    <tbody>
                      {rows.length === 0 ? (
                        <EmptyRow colSpan={7}>{live.length === 0 ? "No EROs yet. Add your first ERO to start tracking its EFIN, team and renewals." : "No EROs match those filters."}</EmptyRow>
                      ) : rows.map((e) => (
                        <tr key={e.id}>
                          <td><Link href={`/efin/${e.id}`}><b>{orgName(s.orgs, e.organization_id)}</b></Link><div className="monarch-muted">{personName(s.people, e.ero_person_id)}</div></td>
                          <td>{(() => { const ls = s.locations.filter((l) => l.organization_id === e.organization_id && !l.archived_at); return ls.length === 0 ? "—" : ls.length === 1 ? ls[0].name : `${ls.length} locations`; })()}</td>
                          <td className="efin-mask">{maskEfin(e.efin_last4)}</td>
                          <td><Badge value={e.internal_status === "pending_verification" ? "pending" : e.internal_status} /></td>
                          <td>{(() => { const a = s.assignments.find((x) => x.efin_id === e.id && x.role === "ero" && !["revoked", "expired"].includes(x.state)); return a ? <Badge value={a.state} /> : <span className="monarch-muted">None</span>; })()}</td>
                          <td><Verified value={e.external_status} /></td>
                          <td>{e.recorded_expiration ? <>{e.recorded_expiration}{!e.expiration_verified && <small className="monarch-muted"> (unverified)</small>}</> : <span className="monarch-muted">Not recorded</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          );
        })()
      )}
    </>
  );
}
