import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { Badge, EmptyRow, Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { Icon } from "@/components/admin/icons";
import { complianceExceptions } from "@/lib/efin/exceptions.ts";
import { daysUntil, maskEfin, todayIso } from "@/lib/efin/rules.ts";
import { loadSnapshot } from "@/lib/efin/service";
import { EFIN_STATUSES } from "@/lib/efin/types.ts";
import { Kpi, orgName, personName, Verified } from "./parts";

type Params = { q?: string; status?: string; org?: string; notice?: string; error?: string };

export default async function EfinRegistry({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdmin();
  const sp = await searchParams;
  const result = await load(loadSnapshot);
  const today = todayIso();
  return (
    <>
      <PageTitle title="EFIN Management">Your EFIN registry: who each EFIN belongs to, who is assigned to it, and when it needs attention. Dates and verification are what you recorded here, not a live IRS status.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? (
        <SetupRequired message={result.message} />
      ) : (
        (() => {
          const s = result.data;
          const live = s.efins.filter((e) => !e.archived_at);
          const exceptions = complianceExceptions({ ...s, today });
          const soon = live.filter((e) => e.recorded_expiration && e.expiration_verified && daysUntil(e.recorded_expiration, today) >= 0 && daysUntil(e.recorded_expiration, today) <= 60);
          const q = (sp.q ?? "").trim().toLowerCase();
          const rows = live.filter((e) => (!sp.status || e.internal_status === sp.status) && (!sp.org || e.organization_id === sp.org) && (!q || `${e.efin_last4} ${orgName(s.orgs, e.organization_id)} ${personName(s.people, e.ero_person_id)}`.toLowerCase().includes(q)));
          return (
            <>
              <div className="mt-kpis">
                <Kpi href="/efin" icon="licenses" title="EFINs on record" value={live.length} sub={`${live.filter((e) => e.internal_status === "active").length} active`} />
                <Kpi href="/efin/renewals" icon="bell" title="Renewals within 60 days" value={soon.length} sub="From verified dates only" />
                <Kpi href="/efin/assignments" icon="user" title="Assignments to review" value={s.assignments.filter((a) => a.state === "pending_review").length} sub="Waiting on an administrator" />
                <Kpi href="/efin/renewals#exceptions" icon="support" title="Compliance exceptions" value={exceptions.length} sub={`${exceptions.filter((x) => x.severity === "high").length} high priority`} />
              </div>
              <section className="monarch-panel">
                <div className="monarch-panel-head">
                  <div><h2>Registry</h2><p>EFINs are shown masked. Open one to reveal the full number (the reveal is logged).</p></div>
                  <Link className="monarch-primary" href="/efin/new"><Icon name="plus" size={16} /> Add EFIN</Link>
                </div>
                <form className="efin-filter" method="get">
                  <input name="q" defaultValue={sp.q ?? ""} placeholder="Search last 4, organization or ERO" aria-label="Search EFINs" />
                  <select name="status" defaultValue={sp.status ?? ""} aria-label="Status"><option value="">All statuses</option>{EFIN_STATUSES.map((v) => <option key={v} value={v}>{v.replace(/_/g, " ")}</option>)}</select>
                  <select name="org" defaultValue={sp.org ?? ""} aria-label="Organization"><option value="">All organizations</option>{s.orgs.map((o) => <option key={o.id} value={o.id}>{o.legal_name}</option>)}</select>
                  <button className="monarch-secondary efin-small" type="submit">Filter</button>
                </form>
                <div className="monarch-table-wrap">
                  <table>
                    <thead><tr><th>EFIN</th><th>ORGANIZATION</th><th>ERO</th><th>STATUS</th><th>VERIFICATION</th><th>RENEWAL</th></tr></thead>
                    <tbody>
                      {rows.length === 0 ? (
                        <EmptyRow colSpan={6}>{live.length === 0 ? "No EFINs recorded yet. Add the first one to start tracking it." : "No EFINs match those filters."}</EmptyRow>
                      ) : rows.map((e) => (
                        <tr key={e.id}>
                          <td><Link href={`/efin/${e.id}`} className="efin-mask">{maskEfin(e.efin_last4)}</Link></td>
                          <td>{orgName(s.orgs, e.organization_id)}</td>
                          <td>{personName(s.people, e.ero_person_id)}</td>
                          <td><Badge value={e.internal_status === "pending_verification" ? "pending" : e.internal_status} /></td>
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
