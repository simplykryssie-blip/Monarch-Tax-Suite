import { LOCATIONS, type Form8879, type VaultDocument } from "@/lib/compliance/types.ts";
import { defaultDueDate } from "@/lib/compliance/rules.ts";

// The 8879 record's fields, shared by the add form and the record's page.

export function Fields8879({ r, files, year }: { r?: Form8879; files: VaultDocument[]; year: number }) {
  return (
    <>
      <label>Tax year *<input name="tax_year" inputMode="numeric" required defaultValue={r?.tax_year ?? year} /></label>
      <label>Return reference *<input name="return_ref" required maxLength={80} defaultValue={r?.return_ref ?? ""} placeholder="The software's return or client ID" /></label>
      <label>Taxpayer name *<input name="taxpayer_name" required maxLength={200} defaultValue={r?.taxpayer_name ?? ""} /></label>
      <label>Signed 8879 on file since *<input name="signed_on" type="date" required defaultValue={r?.signed_on ?? ""} /></label>
      <label>Return due date (with extensions) *<input name="due_date" type="date" required defaultValue={r?.due_date ?? defaultDueDate(year, false)} /></label>
      <label>IRS accepted / received date<input name="received_date" type="date" defaultValue={r?.received_date ?? ""} /></label>
      <label>Where it&apos;s kept *
        <select name="location" required defaultValue={r?.location ?? "vault"}>{Object.entries(LOCATIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </label>
      <label>Note on where<input name="location_note" maxLength={300} defaultValue={r?.location_note ?? ""} placeholder="For example: cabinet 2, drawer B" /></label>
      <label className="is-wide">PDF in the vault (optional)
        <select name="document_id" defaultValue={r?.document_id ?? ""}>
          <option value="">No file attached</option>
          {files.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
        </select>
      </label>
      <p className="is-wide monarch-muted">Keep until: 3 years from the later of the due date and the IRS received date (Publication 1345). It&apos;s worked out when you save.</p>
    </>
  );
}
