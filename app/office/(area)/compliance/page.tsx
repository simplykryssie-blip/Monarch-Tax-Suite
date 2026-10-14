import Link from "next/link";
import { Flash } from "@/components/admin/ui";
import { ActionForm } from "@/app/(admin)/efin/action-form";
import { PeopleAffected } from "@/components/office/people-affected";
import { latestAttestation, officeStatus } from "@/lib/compliance/service.ts";
import { officeAlerts, ptinSeason, todayIso } from "@/lib/compliance/rules.ts";
import { acknowledgeAction, renewalAction, startIncidentAction } from "./actions";
import { Alerts, ComplianceTabs, day, loadOr, Required, SetupNotice, stamp, compliancePage } from "./parts";

/** The Compliance Center's front page: the office's status, and what each team member does here. */
export default async function ComplianceHome({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { ctx, deps, may } = await compliancePage("compliance.home");
  const sp = await searchParams;
  const result = await loadOr(async () => {
    const [status, latest, renewals] = await Promise.all([
      officeStatus(deps, ctx.officeId), latestAttestation(deps, ctx.officeId), deps.repo.listRenewals(ctx.officeId, ptinSeason(todayIso()).renewalYear),
    ]);
    const acks = latest ? await deps.repo.listAcks(latest.id) : [];
    return { status, latest, mine: acks.find((a) => a.member_id === ctx.memberId) ?? null, renewal: renewals.find((r) => r.member_id === ctx.memberId) ?? null };
  });
  const season = ptinSeason(todayIso());
  return (
    <>
      <h1 className="office-h1">Compliance Center</h1>
      <ComplianceTabs may={may} active="/office/compliance" />
      <Flash notice={sp.notice} error={sp.error} />
      <p className="monarch-muted compliance-lede">A guide, not a gate. Where an IRS or FTC rule applies we say &ldquo;Required by&rdquo;; your office decides, and anything done against a rule is kept with its reason.</p>
      {!result.ok ? <SetupNotice message={result.message} /> : (
        <>
          <section className="monarch-panel" style={{ padding: 20 }}>
            <h2 style={{ marginTop: 0 }}>What needs attention</h2>
            <Alerts alerts={officeAlerts(result.data.status)} />
          </section>

          {ctx.memberId && (
            <section className="compliance-grid">
              <div className="monarch-panel" style={{ padding: 20 }}>
                <h2 style={{ marginTop: 0 }}>Your WISP acknowledgment</h2>
                {!result.data.latest ? <p className="monarch-muted">Your office hasn&apos;t attested its WISP yet. You&apos;ll be asked to acknowledge it once it has.</p>
                  : result.data.mine ? <p>You acknowledged the office WISP on {stamp(result.data.mine.acknowledged_at)}.</p>
                  : (
                    <ActionForm action={acknowledgeAction} className="compliance-stack">
                      <p><Required by="IRS" /> Every PTIN holder follows the office&apos;s written information security plan. <Link href="/office/compliance/wisp">Read the WISP</Link>, then confirm.</p>
                      <input type="hidden" name="attestation_id" value={result.data.latest.id} />
                      <label className="monarch-check"><input type="checkbox" required /> I have read {ctx.officeName}&apos;s WISP and I will follow it.</label>
                      <button className="monarch-primary">Acknowledge</button>
                    </ActionForm>
                  )}
              </div>
              <div className="monarch-panel" style={{ padding: 20 }}>
                <h2 style={{ marginTop: 0 }}>Your PTIN for {season.renewalYear}</h2>
                <p className="monarch-muted">Every PTIN expires December 31. Renewal is open October 16 – December 31{season.inSeason ? " — it's open now." : "."}</p>
                {result.data.renewal?.renewed ? <p>Renewed for {season.renewalYear} on {day(result.data.renewal.renewed_on)}.</p> : (
                  <ActionForm action={renewalAction} className="compliance-stack">
                    <input type="hidden" name="member_id" value={ctx.memberId} />
                    <input type="hidden" name="renewed" value="yes" />
                    <input type="hidden" name="back" value="/office/compliance" />
                    <label>Date renewed<input type="date" name="renewed_on" defaultValue={todayIso()} /></label>
                    {!result.data.mine && result.data.latest && <p className="compliance-note"><Required by="IRS" /> The PTIN renewal asks you to confirm your firm has a WISP. Acknowledge your office&apos;s WISP above.</p>}
                    {!result.data.latest && <p className="compliance-note"><Required by="IRS" /> The PTIN renewal asks you to confirm your firm has a WISP. Your office hasn&apos;t attested one yet.</p>}
                    <button className="monarch-secondary">I renewed my PTIN for {season.renewalYear}</button>
                  </ActionForm>
                )}
              </div>
            </section>
          )}

          <section className="monarch-panel" style={{ padding: 20 }}>
            <h2 style={{ marginTop: 0 }}>Report a security incident</h2>
            <p className="monarch-muted">A lost or stolen device, a phishing click, a misdirected email, a break-in, returns filed you didn&apos;t file. Report it right away; don&apos;t investigate alone or delete anything. Don&apos;t enter client names or SSNs here: counts and dates only.</p>
            <ActionForm action={startIncidentAction} className="monarch-form compliance-form">
              <label>What happened *<input name="title" required maxLength={200} placeholder="For example: laptop stolen from car" /></label>
              <label>Discovered on<input name="discovered_on" type="date" defaultValue={todayIso()} /></label>
              <PeopleAffected />
              <label>Was the information encrypted?
                <select name="info_encrypted" defaultValue="unknown"><option value="unknown">Not sure yet</option><option value="yes">Yes</option><option value="no">No</option></select>
              </label>
              <label className="is-wide">Details (no client names or SSNs)<textarea name="summary" rows={3} maxLength={4000} /></label>
              <div className="is-wide"><button className="monarch-primary">Report incident</button></div>
            </ActionForm>
          </section>

          <section className="monarch-panel compliance-efin" style={{ padding: 20 }}>
            <h2 style={{ marginTop: 0 }}>Your EFIN</h2>
            <p><Required by="IRS" /> Never share your EFIN, and never let anyone else use it to file returns. Each office and location files under its own EFIN. If you think yours has been used by someone else, report an incident above and contact IRS e-Help.</p>
          </section>
        </>
      )}
    </>
  );
}
