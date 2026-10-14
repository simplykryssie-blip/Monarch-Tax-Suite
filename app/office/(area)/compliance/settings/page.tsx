import { Flash } from "@/components/admin/ui";
import { ActionForm } from "@/app/(admin)/efin/action-form";
import { LIAISON_URL, settingsOf } from "@/lib/compliance/rules.ts";
import { saveSettingsAction } from "../actions";
import { ComplianceTabs, compliancePage, loadOr, SetupNotice } from "../parts";

/** The office's own schedule and reminder timing, and its IRS Stakeholder Liaison. */
export default async function Settings({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { ctx, deps, may } = await compliancePage("compliance.manage");
  const sp = await searchParams;
  const result = await loadOr(() => deps.repo.getSettings(ctx.officeId));
  const s = result.ok ? result.data : null;
  const v = settingsOf(s);
  return (
    <>
      <h1 className="office-h1">Compliance settings</h1>
      <ComplianceTabs may={may} active="/office/compliance/settings" />
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? <SetupNotice message={result.message} /> : (
        <ActionForm action={saveSettingsAction} className="monarch-panel monarch-form compliance-form" >
          <h2 className="is-wide" style={{ margin: 0 }}>Reminders</h2>
          <label>WISP review every (months)<input name="review_months" inputMode="numeric" defaultValue={v.review_months} /></label>
          <label>WISP reminders (days before the review)<input name="review_reminder_days" defaultValue={v.review_reminder_days.join(", ")} placeholder="30, 7" /></label>
          <label>Flag 8879s this many days before retention ends<input name="retention_alert_days" inputMode="numeric" defaultValue={v.retention_alert_days} /></label>
          <label>PTIN reminders during renewal season, every (days)<input name="ptin_reminder_every_days" inputMode="numeric" defaultValue={v.ptin_reminder_every_days} /></label>
          <p className="is-wide monarch-muted">The IRS expects a WISP review at least once a year; a longer schedule is your office&apos;s decision. Reminders appear on the office dashboard and are emailed: WISP reviews to your EROs, PTIN renewals to each team member who hasn&apos;t recorded one.</p>
          <h2 className="is-wide" style={{ margin: "8px 0 0" }}>Your IRS Stakeholder Liaison</h2>
          <p className="is-wide monarch-muted">Report a data breach to your area&apos;s liaison without delay. <a href={LIAISON_URL} target="_blank" rel="noreferrer">Find yours on the IRS list by state</a>, then save the contact here so it&apos;s ready on every incident.</p>
          <label>Name<input name="liaison_name" maxLength={120} defaultValue={s?.liaison_name ?? ""} /></label>
          <label>Phone<input name="liaison_phone" maxLength={40} defaultValue={s?.liaison_phone ?? ""} /></label>
          <label>Email<input name="liaison_email" type="email" maxLength={254} defaultValue={s?.liaison_email ?? ""} /></label>
          <label>Notes<input name="liaison_notes" maxLength={500} defaultValue={s?.liaison_notes ?? ""} /></label>
          <div className="is-wide"><button className="monarch-primary">Save settings</button></div>
        </ActionForm>
      )}
    </>
  );
}
