import { requireAdmin } from "@/lib/admin";
import { EmptyRow, Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { roleLabel } from "@/lib/efin/rules.ts";
import { loadSnapshot } from "@/lib/efin/service";
import { ASSIGNMENT_ROLES } from "@/lib/efin/types.ts";
import { addCredentialAction, addRoleAction, savePersonAction } from "../actions";
import { orgName, Select, VERIFY_OPTIONS, Verified } from "../parts";

export default async function People({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const result = await load(loadSnapshot);
  return (
    <>
      <PageTitle title="People & credentials">Responsible officials, EROs, principals and preparers. A PTIN is a separate protected credential linked to a person; it is never treated as e-file authorization.</PageTitle>
      <Flash {...sp} />
      {!result.ok ? <SetupRequired message={result.message} /> : (() => {
        const s = result.data;
        const people = s.people.filter((p) => !p.archived_at);
        return (
          <>
            <section className="monarch-panel">
              <div className="monarch-panel-head"><div><h2>People</h2><p>Roles are per organization. Credentials show the last four characters only.</p></div></div>
              <div className="monarch-table-wrap"><table>
                <thead><tr><th>PERSON</th><th>CONTACT</th><th>ROLES</th><th>PTIN</th></tr></thead>
                <tbody>{people.length === 0 ? <EmptyRow colSpan={4}>No people yet. Add the first one below.</EmptyRow> : people.map((p) => {
                  const roles = s.roles.filter((r) => r.person_id === p.id && r.status === "active");
                  const creds = s.credentials.filter((c) => c.person_id === p.id && !c.archived_at);
                  return (
                    <tr key={p.id}>
                      <td><b>{p.full_name}</b></td><td>{p.email ?? "—"}{p.phone && <div className="monarch-muted">{p.phone}</div>}</td>
                      <td style={{ whiteSpace: "normal" }}>{roles.length ? roles.map((r) => <div key={r.id}>{roleLabel(r.role)} <span className="monarch-muted">· {orgName(s.orgs, r.organization_id)}</span> <Verified value={r.verification_status} /></div>) : "—"}</td>
                      <td>{creds.length ? creds.map((c) => <div key={c.id}>P••••{c.identifier_last4} <Verified value={c.verification_status} />{c.expires_on && <small className="monarch-muted"> to {c.expires_on}</small>}</div>) : <span className="monarch-muted">None recorded</span>}</td>
                    </tr>
                  );
                })}</tbody>
              </table></div>
            </section>
            <section className="monarch-panel monarch-pad">
              <h2 style={{ marginTop: 0 }}>Add a person</h2>
              <form action={savePersonAction} className="monarch-form">
                <label>Full name<input name="full_name" required maxLength={200} /></label>
                <label>Email<input name="email" type="email" maxLength={254} /></label>
                <label>Phone<input name="phone" type="tel" maxLength={40} /></label>
                <div className="is-wide"><button className="monarch-primary" type="submit">Add person</button></div>
              </form>
            </section>
            {people.length > 0 && s.orgs.length > 0 && (
              <section className="monarch-panel monarch-pad">
                <h2 style={{ marginTop: 0 }}>Record a role</h2>
                <form action={addRoleAction} className="monarch-form">
                  <label>Person<Select name="person_id" required options={people.map((p) => ({ value: p.id, label: p.full_name }))} /></label>
                  <label>Organization<Select name="organization_id" required options={s.orgs.map((o) => ({ value: o.id, label: o.legal_name }))} /></label>
                  <label>Role<Select name="role" required options={ASSIGNMENT_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))} /></label>
                  <label>Office (optional)<Select name="location_id" empty="Whole organization" options={s.locations.map((l) => ({ value: l.id, label: `${orgName(s.orgs, l.organization_id)} — ${l.name}` }))} /></label>
                  <label>How was this role confirmed?<Select name="verification_status" value="unverified" options={VERIFY_OPTIONS} /></label>
                  <label>Start date<input type="date" name="start_date" /></label>
                  <label className="is-wide">Note<input name="verification_note" maxLength={1000} /></label>
                  <div className="is-wide"><button className="monarch-primary" type="submit">Save role</button></div>
                </form>
              </section>
            )}
            {people.length > 0 && (
              <section className="monarch-panel monarch-pad">
                <h2 style={{ marginTop: 0 }}>Record a PTIN</h2>
                <form action={addCredentialAction} className="monarch-form">
                  <label>Person<Select name="person_id" required options={people.map((p) => ({ value: p.id, label: p.full_name }))} /></label>
                  <label>PTIN (P + 8 digits)<input name="identifier" required autoComplete="off" maxLength={12} placeholder="P01234567" /></label>
                  <label>How was it confirmed?<Select name="verification_status" value="unverified" options={VERIFY_OPTIONS} /></label>
                  <label>Source<input name="verification_source" maxLength={300} /></label>
                  <label>Renewal date on record<input type="date" name="expires_on" /></label>
                  <div className="is-wide"><button className="monarch-primary" type="submit">Save PTIN</button></div>
                </form>
              </section>
            )}
          </>
        );
      })()}
    </>
  );
}
