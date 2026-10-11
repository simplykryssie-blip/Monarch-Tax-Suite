import { ActionForm } from "../action-form";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { loadSnapshot } from "@/lib/efin/service";
import { createEfinAction } from "../actions";
import { Select, VERIFY_OPTIONS } from "../parts";

export default async function NewEfin({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const result = await load(loadSnapshot);
  return (
    <>
      <PageTitle title="Add another EFIN" back={{ href: "/efin/list", label: "EROs & EFINs" }}>For an ERO already in your list. The number is encrypted when saved. Only the last four digits are kept readable. Recording an EFIN here does not apply for, renew or verify it with the IRS.</PageTitle>
      <Flash {...await searchParams} />
      {!result.ok ? <SetupRequired message={result.message} /> : result.data.orgs.length === 0 ? (
        <div className="monarch-notice"><b>FIRST STEP</b> Add the ERO this EFIN belongs to by choosing <Link href="/efin/new">Add an ERO</Link>.</div>
      ) : (
        <section className="monarch-panel monarch-pad">
          <ActionForm action={createEfinAction} className="monarch-form">
            <label>EFIN (six digits)<input name="efin" required inputMode="numeric" autoComplete="off" maxLength={8} placeholder="123456" /></label>
            <label>ERO / organization<Select name="organization_id" required options={result.data.orgs.filter((o) => !o.archived_at).map((o) => ({ value: o.id, label: o.legal_name }))} /></label>
            <label>Office<Select name="location_id" empty="Not set" options={result.data.locations.map((l) => ({ value: l.id, label: `${result.data.orgs.find((o) => o.id === l.organization_id)?.legal_name ?? ""} — ${l.name}` }))} /></label>
            <label>ERO or Responsible Official<Select name="ero_person_id" empty="Not assigned yet" options={result.data.people.filter((p) => !p.archived_at).map((p) => ({ value: p.id, label: p.full_name }))} /></label>
            <label>How was this EFIN confirmed?<Select name="external_status" value="unverified" options={VERIFY_OPTIONS} /></label>
            <label>Source of that confirmation<input name="verification_source" maxLength={300} placeholder="e.g. IRS acceptance letter dated…" /></label>
            <label>Renewal / expiration date on record<input name="recorded_expiration" type="date" /></label>
            <label>Tax year<input name="tax_year" type="number" min={2000} max={2100} /></label>
            <label className="monarch-check is-wide"><input type="checkbox" name="expiration_verified" /> I verified this date from a source. Reminders only run from verified dates.</label>
            <label className="is-wide">Notes<textarea name="notes" rows={3} maxLength={4000} /></label>
            <div className="is-wide"><button className="monarch-primary" type="submit">Save EFIN</button></div>
          </ActionForm>
        </section>
      )}
    </>
  );
}
