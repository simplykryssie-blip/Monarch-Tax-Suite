import { ActionForm } from "./action-form";
import { archiveEfinAction, archiveOrganizationAction, deleteEfinAction, deleteOrganizationAction, restoreEfinAction, restoreOrganizationAction, updateLocationAction, updateOrganizationAction, updatePersonAction } from "./actions";
import { Select } from "./parts";
import type { Snapshot } from "@/lib/efin/service";
import type { EfinRow, OrgRow } from "@/lib/efin/types";

const STRUCTURES = ["llc", "corporation", "s_corporation", "partnership", "sole_proprietorship", "nonprofit", "other"].map((v) => ({ value: v, label: v.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) }));
export const RELATIONSHIP_OPTIONS = [
  { value: "client", label: "Software / service client (no team or PTINs)" },
  { value: "partner", label: "Partner (I may manage some of their preparers)" },
  { value: "internal", label: "My own tax office (I manage its preparers)" },
  { value: "other", label: "Other" },
];

/** Edit, archive, restore and delete controls for an ERO (business) and, when given, one of its EFINs. */
export function EroAdmin({ s, org, efin, back, openSection }: { s: Snapshot; org: OrgRow; efin?: EfinRow; back: string; openSection?: string }) {
  const person = s.people.find((p) => p.id === (efin?.ero_person_id ?? org.administrator_person_id));
  const locations = s.locations.filter((l) => l.organization_id === org.id && !l.archived_at);
  const addr = org.primary_address ?? {};
  const efinCount = s.efins.filter((e) => e.organization_id === org.id).length;
  return (
    <>
      <details className="efin-edit" open={openSection === "firm"}>
        <summary>Edit ERO</summary>
        <div className="efin-edit-body">
        <ActionForm action={updateOrganizationAction} className="monarch-form">
          <input type="hidden" name="id" value={org.id} /><input type="hidden" name="back" value={back} />
          <label>Legal name<input name="legal_name" required maxLength={200} defaultValue={org.legal_name} /></label>
          <label>Doing business as<input name="dba_name" maxLength={200} defaultValue={org.dba_name ?? ""} /></label>
          <label>Business structure<Select name="business_structure" value={org.business_structure} empty="Not set" options={STRUCTURES} /></label>
          <label>EIN {org.ein_last4 && <small className="monarch-muted">(on file: ••-•••{org.ein_last4}; enter a new one only to replace it)</small>}<input name="ein" inputMode="numeric" autoComplete="off" maxLength={11} placeholder="12-3456789" /></label>
          <label>Relationship to you<Select name="relationship" value={org.relationship} options={RELATIONSHIP_OPTIONS} /></label>
          <label>Reason for changing the relationship<input name="reason" maxLength={1000} placeholder="Only needed if you change it" /></label>
          <label>Agreement<Select name="agreement_status" value={org.agreement_status} options={["pending", "active", "suspended", "ended"].map((v) => ({ value: v, label: v.replace(/^\w/, (c) => c.toUpperCase()) }))} /></label>
          <label>Street address<input name="line1" maxLength={200} defaultValue={addr.line1 ?? ""} /></label>
          <label>City<input name="city" maxLength={100} defaultValue={addr.city ?? ""} /></label>
          <label>State<input name="state" maxLength={2} defaultValue={addr.state ?? ""} /></label>
          <label>ZIP<input name="zip" maxLength={10} defaultValue={addr.zip ?? ""} /></label>
          <label className="is-wide">Notes<textarea name="notes" rows={2} maxLength={4000} defaultValue={org.notes ?? ""} /></label>
          <p className="efin-note is-wide" style={{ padding: 0 }}>Changing the relationship is recorded in the history. It never changes who can see anything.</p>
          <div className="is-wide"><button className="monarch-primary" type="submit">Save ERO</button></div>
        </ActionForm>
      </div>
      </details>

      {person && (
        <details className="efin-edit">
          <summary>ERO contact</summary>
          <div className="efin-edit-body">
          <ActionForm action={updatePersonAction} className="monarch-form">
            <input type="hidden" name="person_id" value={person.id} /><input type="hidden" name="back" value={back} />
            <label>Full name<input name="person_name" required maxLength={200} defaultValue={person.full_name} /></label>
            <label>Email<input name="person_email" type="email" maxLength={254} defaultValue={person.email ?? ""} /></label>
            <label>Phone<input name="person_phone" type="tel" maxLength={40} defaultValue={person.phone ?? ""} /></label>
            <div className="is-wide"><button className="monarch-primary" type="submit">Save contact</button></div>
          </ActionForm>
          </div>
        </details>
      )}

      <details className="efin-edit">
        <summary>Locations</summary>
        <div className="efin-edit-body">
          <p className="monarch-muted" style={{ margin: 0 }}>Rename, move the primary marker, or remove a location (it stays in the history).</p>
          {locations.length === 0 && <p className="monarch-muted">No locations yet.</p>}
          {locations.map((l) => (
            <ActionForm key={l.id} action={updateLocationAction} className="monarch-form">
              <input type="hidden" name="location_id" value={l.id} /><input type="hidden" name="back" value={back} />
              <label>Name<input name="name" required maxLength={200} defaultValue={l.name} /></label>
              <label>Street address<input name="line1" maxLength={200} defaultValue={l.address.line1 ?? ""} /></label>
              <label>City<input name="city" maxLength={100} defaultValue={l.address.city ?? ""} /></label>
              <label>State<input name="state" maxLength={2} defaultValue={l.address.state ?? ""} /></label>
              <label>ZIP<input name="zip" maxLength={10} defaultValue={l.address.zip ?? ""} /></label>
              <label className="monarch-check"><input type="checkbox" name="is_primary" defaultChecked={l.is_primary} /> Primary office</label>
              <label className="monarch-check"><input type="checkbox" name="remove" /> Remove this location</label>
              <div className="is-wide"><button className="monarch-secondary efin-small" type="submit">Save location</button></div>
            </ActionForm>
          ))}
        </div>
      </details>

      <details className="efin-edit" open={openSection === "more"}>
        <summary>Archive or delete</summary>
        <div className="efin-edit-body">
        <p className="monarch-muted">Archiving hides a record and stops reminders; it can be restored and keeps its history. Deleting is permanent and is allowed only for records that never went live in an assignment. The history log of the deletion is kept.</p>
        {efin && (
          <div style={{ display: "grid", gap: 14, marginBottom: 18 }}>
            <strong>EFIN ending {efin.efin_last4}</strong>
            {efin.archived_at ? (
              <ActionForm action={restoreEfinAction} className="efin-actions"><input type="hidden" name="id" value={efin.id} /><input type="hidden" name="back" value={back} /><button className="monarch-secondary efin-small" type="submit">Restore EFIN</button></ActionForm>
            ) : (
              <ActionForm action={archiveEfinAction} className="efin-actions">
                <input type="hidden" name="id" value={efin.id} /><input type="hidden" name="back" value={back} />
                <input type="text" name="reason" required minLength={5} maxLength={500} placeholder="Reason" aria-label="Reason" />
                <label className="efin-confirm"><input type="checkbox" name="confirm" /> Confirm</label>
                <button className="monarch-secondary efin-small" type="submit">Archive EFIN</button>
              </ActionForm>
            )}
            <ActionForm action={deleteEfinAction} className="efin-actions" confirm="Permanently delete this EFIN and its draft assignments, filing records and renewal tasks? This cannot be undone.">
              <input type="hidden" name="id" value={efin.id} /><input type="hidden" name="back" value={back} />
              <label className="efin-confirm"><input type="checkbox" name="confirm" /> I understand this is permanent</label>
              <button className="monarch-secondary is-danger efin-small" type="submit">Delete EFIN permanently</button>
            </ActionForm>
          </div>
        )}
        <div style={{ display: "grid", gap: 14 }}>
          <strong>{org.legal_name} (ERO){efinCount > 0 && <small className="monarch-muted"> · {efinCount} EFIN{efinCount === 1 ? "" : "s"}</small>}</strong>
          {org.archived_at ? (
            <ActionForm action={restoreOrganizationAction} className="efin-actions"><input type="hidden" name="organization_id" value={org.id} /><input type="hidden" name="back" value={back} /><button className="monarch-secondary efin-small" type="submit">Restore ERO</button></ActionForm>
          ) : (
            <ActionForm action={archiveOrganizationAction} className="efin-actions">
              <input type="hidden" name="organization_id" value={org.id} /><input type="hidden" name="back" value={back} />
              <input type="text" name="reason" minLength={5} maxLength={1000} placeholder="Reason" aria-label="Reason" />
              <label className="efin-confirm"><input type="checkbox" name="confirm" /> Confirm</label>
              <button className="monarch-secondary efin-small" type="submit">Archive ERO and its EFINs</button>
            </ActionForm>
          )}
          <ActionForm action={deleteOrganizationAction} className="efin-actions" confirm={`Permanently delete ${org.legal_name} with all its EFINs, locations and team? This cannot be undone.`}>
            <input type="hidden" name="organization_id" value={org.id} /><input type="hidden" name="back" value={back} />
            <label className="efin-confirm"><input type="checkbox" name="confirm" /> I understand this is permanent</label>
            <button className="monarch-secondary is-danger efin-small" type="submit">Delete ERO permanently</button>
          </ActionForm>
        </div>
        </div>
      </details>
    </>
  );
}
