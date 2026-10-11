import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { Badge, EmptyRow, Flash, label, load, PageTitle, SetupRequired, when } from "@/components/admin/ui";
import { Donut } from "@/components/admin/charts";
import { Icon } from "@/components/admin/icons";
import { BUCKET_LABEL, bucketFor, EXPIRING_WINDOW_DAYS, statusBreakdown, type StatusBucket } from "@/lib/efin/metrics.ts";
import { complianceExceptions } from "@/lib/efin/exceptions.ts";
import { daysUntil, maskEfin, todayIso } from "@/lib/efin/rules.ts";
import { loadAudit, loadSnapshot } from "@/lib/efin/service";
import { Kpi, orgName, Verified } from "./parts";

// One colour per status, in the brand palette: ink, gold, deep gold, light gold, grey. Every slice is also listed in text.
const COLOR: Record<StatusBucket, string> = { active: "#111111", expiring: "#c8a24a", review: "#8a6a1c", pending: "#e3d3a1", inactive: "#bdbdbd" };

export default async function EfinDashboard({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const result = await load(async () => ({ snap: await loadSnapshot(), activity: await loadAudit({ limit: 6 }) }));
  const today = todayIso();
  return (
    <>
      <PageTitle title="EFIN Management">Manage your EROs, their EFINs, locations, team and renewals in one place. Everything shown is what you recorded, with how it was verified, not a live IRS status.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? (
        <SetupRequired message={result.message} module="efin" />
      ) : (
        (() => {
          const { snap: s, activity } = result.data;
          const live = s.efins.filter((e) => !e.archived_at);
          const breakdown = statusBreakdown(live, today);
          const exceptions = complianceExceptions({ ...s, today });
          const expiring = live.filter((e) => e.recorded_expiration && e.expiration_verified && daysUntil(e.recorded_expiration, today) >= 0 && daysUntil(e.recorded_expiration, today) <= EXPIRING_WINDOW_DAYS).sort((a, b) => (a.recorded_expiration as string).localeCompare(b.recorded_expiration as string));
          const clientOrgs = new Set(s.orgs.filter((o) => o.relationship === "client").map((o) => o.id));
          const activeRoles = s.roles.filter((r) => r.status === "active" && !clientOrgs.has(r.organization_id));
          const pros = new Set(activeRoles.map((r) => r.person_id)).size;
          const locations = s.locations.filter((l) => !l.archived_at && s.orgs.some((o) => o.id === l.organization_id && !o.archived_at));
          const review = s.assignments.filter((a) => a.state === "pending_review").length;
          const recent = [...live].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 8);
          const slices = (Object.keys(BUCKET_LABEL) as StatusBucket[]).map((k) => ({ label: BUCKET_LABEL[k], value: breakdown[k], color: COLOR[k] }));
          const filings = s.filings.filter((f) => !f.archived_at && live.some((e) => e.id === f.efin_id)).slice(0, 6);
          return (
            <>
              <div className="mt-kpis">
                <Kpi href="/efin/list" icon="licenses" title="Total EFINs" value={live.length} sub={`${live.filter((e) => e.internal_status === "active").length} active`} />
                <Kpi href="/efin/list" icon="user" title="Tax professionals" value={pros} sub="Your office and partners" />
                <Kpi href="/efin/list" icon="office" title="Locations" value={locations.length} sub="Across all EROs" />
                <Kpi href="/efin/renewals" icon="bell" title="Expiring soon" value={expiring.length} sub={`Within ${EXPIRING_WINDOW_DAYS} days, verified dates`} />
              </div>

              <div className="efin-dash">
                <div>
                  <section className="monarch-panel">
                    <div className="monarch-panel-head">
                      <div><h2>EFIN overview</h2><p>Most recently added. EFINs are masked.</p></div>
                      <Link className="mt-card-link" href="/efin/list">View all</Link>
                    </div>
                    <div className="monarch-table-wrap"><table>
                      <thead><tr><th>EFIN</th><th>BUSINESS</th><th>LOCATIONS</th><th>STATUS</th><th>EXPIRATION</th></tr></thead>
                      <tbody>{recent.length === 0 ? <EmptyRow colSpan={5}>No EROs yet. Add your first ERO to see it here.</EmptyRow> : recent.map((e) => {
                        const b = bucketFor(e, today);
                        const count = s.locations.filter((l) => l.organization_id === e.organization_id && !l.archived_at).length;
                        return (
                          <tr key={e.id}>
                            <td><Link href={`/efin/${e.id}`} className="efin-mask">{maskEfin(e.efin_last4)}</Link></td>
                            <td>{orgName(s.orgs, e.organization_id)}</td><td>{count || "—"}</td>
                            <td>{b === "active" ? <Badge value="active" /> : b === "expiring" ? <span className="monarch-badge pending">Expiring soon</span> : b === "review" ? <span className="monarch-badge failed">Needs review</span> : b === "pending" ? <Badge value="pending" /> : <Badge value="inactive" />}</td>
                            <td>{e.recorded_expiration ?? <span className="monarch-muted">Not recorded</span>}</td>
                          </tr>
                        );
                      })}</tbody>
                    </table></div>
                  </section>

                  <section className="monarch-panel">
                    <div className="monarch-panel-head"><div><h2>Recent activity</h2><p>The latest recorded changes.</p></div><Link className="mt-card-link" href="/efin/history">View all</Link></div>
                    <div className="monarch-table-wrap"><table>
                      <thead><tr><th>WHEN</th><th>WHO</th><th>EVENT</th></tr></thead>
                      <tbody>{activity.length === 0 ? <EmptyRow colSpan={3}>No activity yet.</EmptyRow> : activity.map((h) => <tr key={h.id}><td>{when(h.occurred_at)}</td><td>{h.actor_email ?? "System"}</td><td><b>{label(h.event_type.replace(/\./g, " "))}</b></td></tr>)}</tbody>
                    </table></div>
                  </section>

                  <section className="monarch-panel">
                    <div className="monarch-panel-head"><div><h2>Filing software</h2><p>Which software each EFIN files through, and how that was confirmed. Not synced with any provider.</p></div></div>
                    <div className="monarch-table-wrap"><table>
                      <thead><tr><th>EFIN</th><th>PROVIDER</th><th>TAX YEAR</th><th>AUTHORIZATION</th></tr></thead>
                      <tbody>{filings.length === 0 ? <EmptyRow colSpan={4}>No filing software recorded yet. Add it from an ERO&apos;s Filing Relationships tab.</EmptyRow> : filings.map((f) => {
                        const e = live.find((x) => x.id === f.efin_id);
                        return <tr key={f.id}><td><Link href={`/efin/${f.efin_id}?tab=filing`} className="efin-mask">{maskEfin(e?.efin_last4)}</Link></td><td><b>{f.software_provider}</b></td><td>{f.tax_year ?? "—"}</td><td><Verified value={f.external_auth_status} /></td></tr>;
                      })}</tbody>
                    </table></div>
                  </section>
                </div>

                <div>
                  <section className="monarch-panel">
                    <div className="monarch-panel-head"><div><h2>Status breakdown</h2><p>From recorded and verified dates.</p></div></div>
                    <Donut slices={slices} centre={String(live.length)} caption="Total EFINs" />
                  </section>

                  <section className="monarch-panel">
                    <div className="monarch-panel-head"><div><h2>Upcoming renewals</h2><p>Verified dates only.</p></div><Link className="mt-card-link" href="/efin/renewals">View all</Link></div>
                    <div className="monarch-table-wrap"><table>
                      <thead><tr><th>EFIN</th><th>BUSINESS</th><th>DUE</th></tr></thead>
                      <tbody>{expiring.length === 0 ? <EmptyRow colSpan={3}>Nothing is due in the next {EXPIRING_WINDOW_DAYS} days.</EmptyRow> : expiring.slice(0, 5).map((e) => <tr key={e.id}><td><Link href={`/efin/${e.id}?tab=renewals`} className="efin-mask">{maskEfin(e.efin_last4)}</Link></td><td>{orgName(s.orgs, e.organization_id)}</td><td>{e.recorded_expiration} <small className="monarch-muted">{daysUntil(e.recorded_expiration as string, today)}d</small></td></tr>)}</tbody>
                    </table></div>
                  </section>

                  <section className="monarch-panel">
                    <div className="monarch-panel-head"><div><h2>Quick actions</h2></div></div>
                    <div className="efin-qa">
                      <Link href="/efin/new"><Icon name="plus" size={20} /> Add an ERO</Link>
                      <Link href="/efin/list"><Icon name="licenses" size={20} /> All EROs &amp; EFINs</Link>
                      <Link href="/efin/list?review=1"><Icon name="check" size={20} /> {review} to review</Link>
                      <Link href="/efin/renewals#exceptions"><Icon name="support" size={20} /> {exceptions.length} exceptions</Link>
                    </div>
                  </section>
                </div>
              </div>
            </>
          );
        })()
      )}
    </>
  );
}
