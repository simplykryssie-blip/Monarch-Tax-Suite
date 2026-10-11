import { ActionForm } from "./action-form";
import { createEfinAction } from "./actions";
import { Select, VERIFY_OPTIONS } from "./parts";
import type { Snapshot } from "@/lib/efin/service";
import type { OrgRow } from "@/lib/efin/types";

/** Records another EFIN for an ERO. With `org` the ERO is fixed (used on the ERO's own page); without it you pick one. */
export function AddEfinForm({ s, org, back }: { s: Snapshot; org?: OrgRow; back?: string }) {
  const orgs = s.orgs.filter((o) => !o.archived_at);
  const locations = s.locations.filter((l) => !l.archived_at && (!org || l.organization_id === org.id));
  const roleIds = org ? new Set(s.roles.filter((r) => r.organization_id === org.id && r.status === "active").map((r) => r.person_id)) : null;
  const people = s.people.filter((p) => !p.archived_at && (!roleIds || roleIds.has(p.id)));
  return (
    <ActionForm action={createEfinAction} className="monarch-form">
      {org ? <input type="hidden" name="organization_id" value={org.id} /> : null}
      {back ? <input type="hidden" name="back" value={back} /> : null}
      <label>EFIN (six digits)<input name="efin" required inputMode="numeric" autoComplete="off" maxLength={8} placeholder="123456" /></label>
      {!org && <label>ERO<Select name="organization_id" required options={orgs.map((o) => ({ value: o.id, label: o.legal_name }))} /></label>}
      <label>Filing office<Select name="location_id" empty="Not set" options={locations.map((l) => ({ value: l.id, label: org ? l.name : `${orgs.find((o) => o.id === l.organization_id)?.legal_name ?? ""} — ${l.name}` }))} /></label>
      <label>ERO or Responsible Official<Select name="ero_person_id" empty="Not assigned yet" options={people.map((p) => ({ value: p.id, label: p.full_name }))} /></label>
      <label>How was this EFIN confirmed?<Select name="external_status" value="unverified" options={VERIFY_OPTIONS} /></label>
      <label>Source of that confirmation<input name="verification_source" maxLength={300} placeholder="e.g. IRS acceptance letter dated…" /></label>
      <label>Renewal / expiration date on record<input name="recorded_expiration" type="date" /></label>
      <label>Tax year<input name="tax_year" type="number" min={2000} max={2100} /></label>
      <label className="monarch-check is-wide"><input type="checkbox" name="expiration_verified" /> I verified this date from a source. Reminders only run from verified dates.</label>
      <label className="is-wide">Notes<textarea name="notes" rows={2} maxLength={4000} /></label>
      <div className="is-wide"><button className="monarch-primary" type="submit">Save EFIN</button></div>
    </ActionForm>
  );
}
