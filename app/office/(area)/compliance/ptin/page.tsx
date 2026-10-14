import { Flash } from "@/components/admin/ui";
import { ActionForm } from "@/app/(admin)/efin/action-form";
import { latestAttestation } from "@/lib/compliance/service.ts";
import { ptinSeason, todayIso } from "@/lib/compliance/rules.ts";
import { renewalAction } from "../actions";
import { ComplianceTabs, compliancePage, day, loadOr, Required, SetupNotice } from "../parts";

/** PTIN renewal for the team: "renewed for [year]: yes/no + date". Full PTIN management arrives with Piece 4. */
export default async function PtinPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { ctx, deps, may } = await compliancePage("compliance.home");
  const sp = await searchParams;
  const season = ptinSeason(todayIso());
  const manage = may("compliance.manage");
  const result = await loadOr(async () => {
    const [team, renewals, latest] = await Promise.all([deps.repo.listTeam(ctx.officeId), deps.repo.listRenewals(ctx.officeId, season.renewalYear), latestAttestation(deps, ctx.officeId)]);
    return { team: team.filter((m) => m.status === "active" && (manage || m.id === ctx.memberId)), renewals, latest };
  });
  return (
    <>
      <h1 className="office-h1">PTIN renewal</h1>
      <ComplianceTabs may={may} active="/office/compliance/ptin" />
      <Flash notice={sp.notice} error={sp.error} />
      <p className="compliance-lede"><Required by="IRS" /> Every PTIN expires December 31 and is renewed each year from October 16. {season.inSeason ? `Renewal for ${season.renewalYear} is open now; reminders go only to team members who haven't recorded it.` : `Showing ${season.renewalYear}. Renewal for ${season.renewalYear + 1} opens October 16.`}</p>
      {!result.ok ? <SetupNotice message={result.message} /> : (
        <>
          {season.inSeason && (
            <p className="monarch-alert"><Required by="IRS" /> The PTIN renewal asks each preparer to confirm their firm has a written information security plan. {result.data.latest ? "Your office's WISP is attested; make sure everyone has acknowledged it." : manage ? "Your office hasn't attested its WISP yet — do that in the WISP tab." : "Your office hasn't attested its WISP yet."}</p>
          )}
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>Renewed for {season.renewalYear}</h2></div></div>
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>TEAM MEMBER</th><th>RENEWED</th><th>RECORD</th></tr></thead>
              <tbody>{result.data.team.map((m) => {
                const r = result.data.renewals.find((x) => x.member_id === m.id);
                return (
                  <tr key={m.id}>
                    <td><b>{m.full_name}</b><small className="monarch-subcell">{m.role === "ero" ? "ERO" : "Preparer"}</small></td>
                    <td>{r?.renewed ? `Yes · ${day(r.renewed_on)}` : <span className="monarch-muted">Not recorded</span>}</td>
                    <td>
                      <ActionForm action={renewalAction} className="compliance-step-form">
                        <input type="hidden" name="member_id" value={m.id} />
                        <select name="renewed" defaultValue="yes" aria-label="Renewed"><option value="yes">Renewed</option><option value="no">Not yet</option></select>
                        <input type="date" name="renewed_on" defaultValue={r?.renewed_on ?? todayIso()} aria-label="Date renewed" />
                        <button className="monarch-secondary efin-small">Save</button>
                      </ActionForm>
                    </td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          </section>
        </>
      )}
    </>
  );
}
