import Link from "next/link";
import { EmptyRow, Flash } from "@/components/admin/ui";
import { ftcDuty, LIAISON_URL, openSteps, todayIso } from "@/lib/compliance/rules.ts";
import { ComplianceTabs, compliancePage, day, loadOr, SetupNotice } from "../parts";

/** Security incidents: everyone can see the office's list and report one; those with incident response work them. */
export default async function Incidents({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { ctx, deps, may } = await compliancePage("compliance.home");
  const sp = await searchParams;
  const result = await loadOr(async () => ({ incidents: await deps.repo.listIncidents(ctx.officeId), settings: await deps.repo.getSettings(ctx.officeId) }));
  const today = todayIso();
  return (
    <>
      <h1 className="office-h1">Incident response</h1>
      <ComplianceTabs may={may} active="/office/compliance/incidents" />
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? <SetupNotice message={result.message} /> : (
        <>
          <section className="monarch-panel" style={{ padding: 20 }}>
            <p>Report a new incident from the <Link href="/office/compliance">Compliance overview</Link>. The checklist follows the incident response section of your WISP.</p>
            <p><b>Your IRS Stakeholder Liaison:</b> {result.data.settings?.liaison_name ? <>{result.data.settings.liaison_name}{result.data.settings.liaison_phone ? ` · ${result.data.settings.liaison_phone}` : ""}{result.data.settings.liaison_email ? ` · ${result.data.settings.liaison_email}` : ""}</> : <span className="monarch-muted">not saved yet{may("compliance.manage") ? <> (<Link href="/office/compliance/settings">add it in Settings</Link>)</> : ""}</span>}. <a href={LIAISON_URL} target="_blank" rel="noreferrer">Find yours on the IRS list by state</a>.</p>
          </section>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>Incidents</h2></div></div>
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>INCIDENT</th><th>DISCOVERED</th><th>PEOPLE</th><th>STATUS</th><th>FTC</th></tr></thead>
              <tbody>
                {result.data.incidents.length === 0 ? <EmptyRow colSpan={5}>No incidents recorded.</EmptyRow> : result.data.incidents.map((i) => {
                  const ftc = ftcDuty(i, today);
                  const left = openSteps(i, today).length;
                  return (
                    <tr key={i.id}>
                      <td><Link href={`/office/compliance/incidents/${i.id}`}><b>{i.title}</b></Link><small className="monarch-subcell">Reported by {i.reported_by_name ?? "—"}</small></td>
                      <td>{day(i.discovered_on)}</td>
                      <td>{i.people_affected ?? "Not known"}</td>
                      <td>{i.status === "open" ? `Open · ${left} step${left === 1 ? "" : "s"} left` : "Closed"}</td>
                      <td>{!ftc.applies ? "—" : ftc.done ? `Notified ${day(i.ftc_notified_on)}` : ftc.overdue ? <b className="is-danger">Past deadline ({day(ftc.deadline)})</b> : `Due by ${day(ftc.deadline)}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          </section>
        </>
      )}
    </>
  );
}
