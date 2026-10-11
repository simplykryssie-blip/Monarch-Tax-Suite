import { ActionForm } from "../action-form";
import { requireAdmin } from "@/lib/admin";
import { Flash, PageTitle } from "@/components/admin/ui";
import { onboardEroAction } from "../actions";
import { Select, VERIFY_OPTIONS } from "../parts";
import { ShowWhen } from "../show-when";

const RELATIONSHIPS = [
  { value: "client", label: "Software / service client (no team or PTINs)" },
  { value: "partner", label: "Partner (I may manage some of their preparers)" },
  { value: "internal", label: "My own tax office (I manage its preparers)" },
  { value: "other", label: "Other" },
];
const STRUCTURES = ["llc", "corporation", "s_corporation", "partnership", "sole_proprietorship", "nonprofit", "other"].map((v) => ({ value: v, label: v.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) }));

export default async function AddEro({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  return (
    <>
      <PageTitle title="Add an ERO" back={{ href: "/efin/list", label: "EROs & EFINs" }}>Everything for a new ERO in one place. It is saved together or not at all. Sensitive numbers are encrypted when saved, and only the last four digits stay readable.</PageTitle>
      <Flash {...await searchParams} />
      <div className="efin-flow">
      <ActionForm action={onboardEroAction}>
        <section className="monarch-panel monarch-pad">
          <h2 style={{ marginTop: 0 }}>1. Business</h2>
          <div className="monarch-form">
            <label>Legal name<input name="legal_name" required maxLength={200} /></label>
            <label>Doing business as<input name="dba_name" maxLength={200} /></label>
            <label>Business structure<Select name="business_structure" empty="Not set" options={STRUCTURES} /></label>
            <label>EIN<input name="ein" inputMode="numeric" autoComplete="off" maxLength={11} placeholder="12-3456789" /></label>
            <label>Relationship to you<Select name="relationship" value="client" options={RELATIONSHIPS} /></label>
            <label>Agreement<Select name="agreement_status" value="pending" options={["pending", "active", "suspended", "ended"].map((v) => ({ value: v, label: v.replace(/^\w/, (c) => c.toUpperCase()) }))} /></label>
          </div>
        </section>
        <section className="monarch-panel monarch-pad">
          <h2 style={{ marginTop: 0 }}>2. Office locations</h2>
          <div className="monarch-form">
            <label>Office name<input name="office_name" maxLength={200} defaultValue="Main office" /></label>
            <label>Street address<input name="line1" maxLength={200} /></label>
            <label>City<input name="city" maxLength={100} /></label>
            <label>State<input name="state" maxLength={2} /></label>
            <label>ZIP<input name="zip" maxLength={10} /></label>
          </div>
          <details style={{ marginTop: 18 }}>
            <summary style={{ cursor: "pointer", fontWeight: 650 }}>This ERO has more locations</summary>
            <p className="monarch-muted">Add up to five more now, or add them later from the ERO&apos;s page. Leave unused rows blank.</p>
            {[0, 1, 2, 3, 4].map((i) => (
              <div className="monarch-form" key={i} style={{ marginBottom: 12 }}>
                <label>Location {i + 2} name<input name={`extra_name_${i}`} maxLength={200} /></label>
                <label>Street address<input name={`extra_line1_${i}`} maxLength={200} /></label>
                <label>City<input name={`extra_city_${i}`} maxLength={100} /></label>
                <label>State<input name={`extra_state_${i}`} maxLength={2} /></label>
              </div>
            ))}
          </details>
        </section>
        <section className="monarch-panel monarch-pad">
          <h2 style={{ marginTop: 0 }}>3. ERO / Responsible Official contact</h2>
          <div className="monarch-form">
            <label>Full name<input name="person_name" required maxLength={200} /></label>
            <label>Email<input name="person_email" type="email" maxLength={254} /></label>
            <label>Phone<input name="person_phone" type="tel" maxLength={40} /></label>
            <label>How was this role confirmed?<Select name="role_verification" value="unverified" options={VERIFY_OPTIONS} /></label>
          </div>
          <ShowWhen name="relationship" hideFor={["client"]}>
            <div className="monarch-form" style={{ marginTop: 16 }}>
              <label>PTIN (optional, P + 8 digits)<input name="ptin" autoComplete="off" maxLength={12} placeholder="P01234567" /></label>
              <label>PTIN confirmed?<Select name="ptin_verification" value="unverified" options={VERIFY_OPTIONS} /></label>
              <label>PTIN source<input name="ptin_source" maxLength={300} /></label>
              <label>PTIN renewal date<input type="date" name="ptin_expires_on" /></label>
            </div>
          </ShowWhen>
        </section>
        <section className="monarch-panel monarch-pad">
          <h2 style={{ marginTop: 0 }}>4. EFIN</h2>
          <div className="monarch-form">
            <label>EFIN (six digits)<input name="efin" required inputMode="numeric" autoComplete="off" maxLength={8} placeholder="123456" /></label>
            <label>How was it confirmed?<Select name="efin_verification" value="unverified" options={VERIFY_OPTIONS} /></label>
            <label>Source of that confirmation<input name="efin_source" maxLength={300} placeholder="e.g. IRS acceptance letter dated…" /></label>
            <label>Renewal / expiration date on record<input name="recorded_expiration" type="date" /></label>
            <label>Tax year<input name="tax_year" type="number" min={2000} max={2100} /></label>
            <label className="monarch-check is-wide"><input type="checkbox" name="expiration_verified" /> I verified this date from a source. Reminders only run from verified dates.</label>
            <label className="is-wide">Notes<textarea name="notes" rows={3} maxLength={4000} /></label>
          </div>
          <p className="monarch-muted">For your own office and partners, saving also creates a draft ERO assignment you submit and approve from the ERO&apos;s page. Software or service clients get only the business, locations, contact and EFIN.</p>
          <button className="monarch-primary" type="submit">Save ERO</button>
        </section>
      </ActionForm>
      </div>
    </>
  );
}
