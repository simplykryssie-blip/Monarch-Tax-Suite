import { requireAdmin } from "@/lib/admin";
import { Badge, EmptyRow, Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { loadSnapshot } from "@/lib/efin/service";
import { saveLocationAction, saveOrganizationAction } from "../actions";
import { Select } from "../parts";

const STRUCTURES = ["llc", "corporation", "s_corporation", "partnership", "sole_proprietorship", "nonprofit", "other"].map((v) => ({ value: v, label: v.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) }));

export default async function Offices({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const result = await load(loadSnapshot);
  return (
    <>
      <PageTitle title="Offices & organizations">The businesses (ERO offices) that hold EFINs, and where each one operates. A parent organization can have several locations.</PageTitle>
      <Flash {...sp} />
      {!result.ok ? <SetupRequired message={result.message} /> : (
        <>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>Organizations</h2><p>Agreement and onboarding status are internal records.</p></div></div>
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>ORGANIZATION</th><th>RELATIONSHIP</th><th>AGREEMENT</th><th>ONBOARDING</th><th>EIN</th><th>EFINS</th><th>OFFICES</th></tr></thead>
              <tbody>{result.data.orgs.length === 0 ? <EmptyRow colSpan={7}>No organizations yet. Add the first one below.</EmptyRow> : result.data.orgs.map((o) => (
                <tr key={o.id}>
                  <td><b>{o.legal_name}</b>{o.dba_name && <div className="monarch-muted">dba {o.dba_name}</div>}</td>
                  <td>{o.relationship}</td><td><Badge value={o.agreement_status} /></td><td><Badge value={o.onboarding_status} /></td>
                  <td>{o.ein_last4 ? `••-•••${o.ein_last4}` : "—"}</td>
                  <td>{result.data.efins.filter((e) => e.organization_id === o.id && !e.archived_at).length}</td>
                  <td>{result.data.locations.filter((l) => l.organization_id === o.id && !l.archived_at).map((l) => l.name).join(", ") || "—"}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </section>
          <section className="monarch-panel monarch-pad">
            <h2 style={{ marginTop: 0 }}>Add an organization</h2>
            <form action={saveOrganizationAction} className="monarch-form">
              <label>Legal name<input name="legal_name" required maxLength={200} /></label>
              <label>Doing business as<input name="dba_name" maxLength={200} /></label>
              <label>Business structure<Select name="business_structure" empty="Not set" options={STRUCTURES} /></label>
              <label>EIN (encrypted; last 4 shown)<input name="ein" inputMode="numeric" autoComplete="off" maxLength={11} placeholder="12-3456789" /></label>
              <label>Relationship<Select name="relationship" value="partner" options={[{ value: "internal", label: "Internal (my own office)" }, { value: "partner", label: "Partner" }, { value: "other", label: "Other" }]} /></label>
              <label>Agreement<Select name="agreement_status" value="pending" options={["pending", "active", "suspended", "ended"].map((v) => ({ value: v, label: v }))} /></label>
              <label>Onboarding<Select name="onboarding_status" value="not_started" options={[{ value: "not_started", label: "Not started" }, { value: "in_progress", label: "In progress" }, { value: "complete", label: "Complete" }]} /></label>
              <label>Street address<input name="line1" maxLength={200} /></label>
              <label>City<input name="city" maxLength={100} /></label>
              <label>State<input name="state" maxLength={2} /></label>
              <label>ZIP<input name="zip" maxLength={10} /></label>
              <label className="is-wide">Notes<textarea name="notes" rows={2} maxLength={4000} /></label>
              <div className="is-wide"><button className="monarch-primary" type="submit">Save organization</button></div>
            </form>
          </section>
          {result.data.orgs.length > 0 && (
            <section className="monarch-panel monarch-pad">
              <h2 style={{ marginTop: 0 }}>Add an office location</h2>
              <form action={saveLocationAction} className="monarch-form">
                <label>Organization<Select name="organization_id" required options={result.data.orgs.map((o) => ({ value: o.id, label: o.legal_name }))} /></label>
                <label>Office name<input name="name" required maxLength={200} placeholder="Main office" /></label>
                <label>Street address<input name="line1" maxLength={200} /></label>
                <label>City<input name="city" maxLength={100} /></label>
                <label>State<input name="state" maxLength={2} /></label>
                <label>ZIP<input name="zip" maxLength={10} /></label>
                <label className="monarch-check is-wide"><input type="checkbox" name="is_primary" /> This is the primary office</label>
                <div className="is-wide"><button className="monarch-primary" type="submit">Add office</button></div>
              </form>
            </section>
          )}
        </>
      )}
    </>
  );
}
