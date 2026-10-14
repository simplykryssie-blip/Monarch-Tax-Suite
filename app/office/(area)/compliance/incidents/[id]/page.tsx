import { notFound } from "next/navigation";
import { Flash } from "@/components/admin/ui";
import { ActionForm } from "@/app/(admin)/efin/action-form";
import { PeopleAffected } from "@/components/office/people-affected";
import { FTC_NOTICE, FTC_THRESHOLD, ftcDuty, INCIDENT_STEPS, LIAISON_URL, openSteps, todayIso } from "@/lib/compliance/rules.ts";
import { UUID } from "@/lib/compliance/service.ts";
import { closeIncidentAction, reopenIncidentAction, stepAction, updateIncidentAction } from "../../actions";
import { ComplianceTabs, compliancePage, day, loadOr, Required, SetupNotice, stamp } from "../../parts";

/** One incident, worked through its checklist. Each step records who did it, when, and a note. */
export default async function IncidentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { ctx, deps, may } = await compliancePage("compliance.home");
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID.test(id)) notFound();
  const result = await loadOr(async () => {
    const inc = await deps.repo.getIncident(id);
    if (!inc || inc.organization_id !== ctx.officeId) return null;
    const [settings, events] = await Promise.all([deps.repo.getSettings(ctx.officeId), deps.repo.listEvents(ctx.officeId, { entity: "incident", recordId: id })]);
    return { inc, settings, events };
  });
  if (!result.ok) return <SetupNotice message={result.message} />;
  if (!result.data) notFound();
  const { inc, settings, events } = result.data;
  const work = may("compliance.incidents");
  const today = todayIso();
  const ftc = ftcDuty(inc, today);
  const left = openSteps(inc, today);
  return (
    <>
      <h1 className="office-h1">{inc.title}</h1>
      <ComplianceTabs may={may} active="/office/compliance/incidents" />
      <Flash notice={sp.notice} error={sp.error} />
      <section className={`monarch-panel compliance-ftc${(inc.people_affected ?? 0) >= FTC_THRESHOLD && !ftc.done ? " is-on" : ""}`} style={{ padding: 20 }}>
        {(inc.people_affected ?? 0) >= FTC_THRESHOLD ? <p className="monarch-alert is-error" role="alert">{FTC_NOTICE}</p> : <p><Required by="FTC" /> {FTC_NOTICE}</p>}
        {ftc.applies ? (ftc.done ? <p>FTC notified on {day(inc.ftc_notified_on)}.</p> : <p><b>This incident meets the rule.</b> Notify the FTC by {day(ftc.deadline)}{ftc.overdue ? " — that date has passed" : ` (${ftc.daysLeft} days left)`}.</p>)
          : <p className="monarch-muted">{inc.people_affected === null ? "Record how many people were affected to see whether it applies." : inc.info_encrypted === "yes" ? "The information was encrypted, so the FTC notice doesn't apply." : "Fewer than 500 people, so the FTC notice doesn't apply."}</p>}
      </section>

      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Details</h2>
        <p className="monarch-muted">Discovered {day(inc.discovered_on)} · reported by {inc.reported_by_name ?? "—"} on {stamp(inc.created_at)} · {inc.status === "open" ? "open" : `closed ${stamp(inc.closed_at)}`}. No client names or SSNs here: counts and dates only.</p>
        {work ? (
          <ActionForm action={updateIncidentAction} className="monarch-form compliance-form">
            <input type="hidden" name="id" value={inc.id} />
            <label>What happened<input name="title" maxLength={200} defaultValue={inc.title} /></label>
            <label>Discovered on<input name="discovered_on" type="date" defaultValue={inc.discovered_on} /></label>
            <PeopleAffected defaultValue={inc.people_affected === null ? "" : String(inc.people_affected)} />
            <label>Was the information encrypted?<select name="info_encrypted" defaultValue={inc.info_encrypted}><option value="unknown">Not sure yet</option><option value="yes">Yes</option><option value="no">No</option></select></label>
            <label>IRS Stakeholder Liaison notified on<input name="irs_notified_on" type="date" defaultValue={inc.irs_notified_on ?? ""} /></label>
            <label>FTC notified on<input name="ftc_notified_on" type="date" defaultValue={inc.ftc_notified_on ?? ""} /></label>
            <label className="is-wide">Details (no client names or SSNs)<textarea name="summary" rows={3} maxLength={4000} defaultValue={inc.summary ?? ""} /></label>
            <div className="is-wide"><button className="monarch-primary">Save details</button></div>
          </ActionForm>
        ) : (
          <p>{inc.summary ?? "No details yet."} People affected: {inc.people_affected ?? "not known"}.</p>
        )}
      </section>

      <section className="monarch-panel">
        <div className="monarch-panel-head"><div><h2>Checklist</h2><p>{left.length ? `${left.length} step${left.length === 1 ? "" : "s"} left` : "Every step is recorded."}</p></div></div>
        <ol className="compliance-steps">
          {INCIDENT_STEPS.filter((s) => s.when !== "ftc" || ftc.applies).map((s) => {
            const done = inc.steps[s.key];
            return (
              <li key={s.key} className={done ? (done.skipped ? "is-skipped" : "is-done") : undefined}>
                <div>
                  <b>{s.title}</b> {s.rule && <Required by={s.rule} />}
                  <p>{s.detail}</p>
                  {s.key === "irs" && <p><a href={LIAISON_URL} target="_blank" rel="noreferrer">IRS Stakeholder Liaison contacts by state</a>{settings?.liaison_name ? ` · Yours: ${settings.liaison_name}${settings.liaison_phone ? `, ${settings.liaison_phone}` : ""}${settings.liaison_email ? `, ${settings.liaison_email}` : ""}` : ""}</p>}
                  {done && <p className="monarch-muted">{done.skipped ? "Marked not needed" : "Done"} by {done.by_name}, {stamp(done.done_at)}{done.note ? ` — ${done.note}` : ""}</p>}
                </div>
                {work && inc.status === "open" && (
                  done ? (
                    <ActionForm action={stepAction}><input type="hidden" name="id" value={inc.id} /><input type="hidden" name="step" value={s.key} /><input type="hidden" name="state" value="clear" /><button className="monarch-secondary efin-small">Undo</button></ActionForm>
                  ) : (
                    <ActionForm action={stepAction} className="compliance-step-form">
                      <input type="hidden" name="id" value={inc.id} /><input type="hidden" name="step" value={s.key} />
                      <input name="note" maxLength={500} placeholder="Note (optional)" aria-label={`Note for ${s.title}`} />
                      <select name="state" defaultValue="done" aria-label={`Outcome for ${s.title}`}><option value="done">Done</option><option value="skip">Not needed</option></select>
                      <button className="monarch-primary efin-small">Record</button>
                    </ActionForm>
                  )
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {work && (
        <section className="monarch-panel" style={{ padding: 20 }}>
          {inc.status === "open" ? (
            <ActionForm action={closeIncidentAction} className="compliance-stack">
              <input type="hidden" name="id" value={inc.id} />
              <h2 style={{ margin: 0 }}>Close the incident</h2>
              {(left.length > 0 || (ftc.applies && !ftc.done)) && <p className="monarch-alert is-error">{ftc.applies && !ftc.done ? "Required by FTC: the FTC notice isn't recorded. " : ""}{left.length ? `${left.length} checklist step${left.length === 1 ? " is" : "s are"} still open. ` : ""}You can still close it; give a reason, which is kept in the history.</p>}
              <label>{left.length || (ftc.applies && !ftc.done) ? "Reason (required)" : "Closing note (optional)"}<textarea name="reason" rows={2} maxLength={1000} required={left.length > 0 || (ftc.applies && !ftc.done)} /></label>
              <button className="monarch-secondary">Close incident</button>
            </ActionForm>
          ) : (
            <ActionForm action={reopenIncidentAction}><input type="hidden" name="id" value={inc.id} /><button className="monarch-secondary">Reopen</button></ActionForm>
          )}
        </section>
      )}

      <section className="monarch-panel">
        <div className="monarch-panel-head"><div><h2>History</h2></div></div>
        <ul className="fees-history">{events.map((e) => <li key={e.id}><b>{e.action.replace(/_/g, " ")}</b>{typeof e.detail.title === "string" && e.action.startsWith("step") ? `: ${e.detail.title}` : ""} · {e.actor_name ?? ""} · {stamp(e.created_at)}{e.reason ? ` · Reason: ${e.reason}` : ""}</li>)}</ul>
      </section>
    </>
  );
}
