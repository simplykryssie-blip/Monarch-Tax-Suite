import { ActionForm } from "../action-form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { Badge, EmptyRow, Flash, label, load, PageTitle, SetupRequired, when } from "@/components/admin/ui";
import { availableTransitions, roleLabel, tracksTeam } from "@/lib/efin/rules.ts";
import { loadEfinAudit, loadSnapshot, problemsFor } from "@/lib/efin/service";
import { ASSIGNMENT_ROLES, EFIN_STATUSES } from "@/lib/efin/types.ts";
import { addMemberAction, saveLocationAction, changeAssignmentAction, requestAssignmentAction, saveFilingAction, updateEfinAction } from "../actions";
import { orgName, personName, Select, VERIFY_OPTIONS, Verified } from "../parts";
import { EroAdmin } from "../ero-admin";
import { AddEfinForm } from "../add-efin-form";
import { FirmHeader, OverviewCards } from "../firm-card";
import { Icon, type IconName } from "@/components/admin/icons";
import { nextSteps } from "@/lib/efin/steps.ts";
import { words } from "@/lib/efin/text.ts";

const TABS: readonly (readonly [string, string, IconName])[] = [
  ["overview", "Overview", "dashboard"],
  ["team", "Team", "customers"],
  ["filing", "EFIN & Filing", "licenses"],
  ["documents", "Documents", "document"],
  ["renewals", "Renewals", "calendar"],
  ["history", "Activity", "history"],
];
const LEGACY_TAB: Record<string, string> = { parties: "team", assignments: "filing" };

const ACTION_COPY: Record<string, string> = { submit: "Submit for review", approve: "Approve", return: "Return to draft", activate: "Activate", suspend: "Suspend", revoke: "Revoke", expire: "Mark expired", reinstate: "Reinstate" };

export default async function EfinProfile({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; edit?: string; notice?: string; error?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const result = await load(loadSnapshot);
  if (!result.ok) return <SetupRequired message={result.message} module="efin" />;
  const s = result.data;
  const efin = s.efins.find((e) => e.id === id);
  if (!efin) notFound();
  const org = s.orgs.find((o) => o.id === efin.organization_id);
  const teamTracked = org ? tracksTeam(org.relationship) : true;
  const tabs = TABS.map(([k, n, i]) => [k, k === "team" && !teamTracked ? "Locations" : n, i] as const);
  const wanted = LEGACY_TAB[sp.tab ?? ""] ?? sp.tab;
  const tab = tabs.some(([k]) => k === wanted) ? (wanted as string) : "overview";
  const base = `/efin/${id}`;
  const here = `/efin/${id}?tab=${tab}`;
  const assignments = s.assignments.filter((a) => a.efin_id === id);
  const filings = s.filings.filter((f) => f.efin_id === id && !f.archived_at);
  const tasks = s.tasks.filter((t) => t.subject_type === "efin" && t.subject_id === id);
  const history = tab === "history" || tab === "overview" ? await loadEfinAudit(s, id) : [];
  const eroPerson = s.people.find((p) => p.id === (efin.ero_person_id ?? org?.administrator_person_id));
  const steps = org ? nextSteps({ org, efin, person: eroPerson, assignments, filings: s.filings }) : [];
  const orgRoles = s.roles.filter((r) => r.organization_id === efin.organization_id && r.status === "active");
  const people = s.people.filter((p) => !p.archived_at);
  return (
    <>
      {org ? <FirmHeader s={s} org={org} efin={efin} steps={steps} base={base} /> : <PageTitle title={`EFIN ending ${efin.efin_last4}`}>{orgName(s.orgs, efin.organization_id)}</PageTitle>}
      <Flash notice={sp.notice} error={sp.error} />
      <nav className="efin-tabs" aria-label="EFIN sections">
        {tabs.map(([k, name, icon]) => <Link key={k} href={`/efin/${id}?tab=${k}`} className={tab === k ? "is-on" : ""}><Icon name={icon} size={17} /> {name}</Link>)}
      </nav>
      <div className="efin-flow">

      {tab === "overview" && (
        <>
          {org && <OverviewCards s={s} org={org} efin={efin} base={base} activity={history} />}
          <h2 className="efin-manage-title" id="manage">Manage this firm</h2>
          {org && (
            <section className="monarch-panel">
              <div className="monarch-panel-head"><div><h2>EFINs for {org.legal_name}</h2><p>Every EFIN recorded for this ERO.</p></div></div>
              <ul className="efin-eflist">
                {s.efins.filter((e) => e.organization_id === org.id).map((e) => (
                  <li key={e.id}>{e.id === id ? <b className="efin-mask">••{e.efin_last4}</b> : <Link href={`/efin/${e.id}`} className="efin-mask">••{e.efin_last4}</Link>}<Badge value={e.internal_status === "pending_verification" ? "pending" : e.internal_status} /><span className="monarch-muted">{e.recorded_expiration ? `renews ${e.recorded_expiration}` : "no renewal date"}{e.archived_at ? " · archived" : ""}</span></li>
                ))}
              </ul>
            </section>
          )}
          {org && !org.archived_at && (
            <details className="efin-edit" open={sp.edit === "efin"}>
              <summary>Add another EFIN</summary>
              <div className="efin-edit-body"><AddEfinForm s={s} org={org} back={here} /></div>
            </details>
          )}
          {!efin.archived_at && (
            <details className="efin-edit" open={sp.edit === "efin"}>
              <summary>Update this EFIN</summary>
              <div className="efin-edit-body">
              <ActionForm action={updateEfinAction} className="monarch-form">
                <input type="hidden" name="id" value={id} /><input type="hidden" name="back" value={here} />
                <label>Correct the EFIN number <small className="monarch-muted">(leave empty to keep ••{efin.efin_last4})</small><input name="efin" inputMode="numeric" autoComplete="off" maxLength={8} placeholder="Only if it was typed wrong" /></label>
                <label>Filing office for this EFIN<Select name="location_id" value={efin.location_id} empty="Not set" options={s.locations.filter((l) => l.organization_id === efin.organization_id && !l.archived_at).map((l) => ({ value: l.id, label: l.name }))} /></label>
                <label>Internal status<Select name="internal_status" value={efin.internal_status} options={EFIN_STATUSES.map((v) => ({ value: v, label: label(v) }))} /></label>
                <label>Verification<Select name="external_status" value={efin.external_status} options={VERIFY_OPTIONS} /></label>
                <label>Verification source<input name="verification_source" defaultValue={efin.verification_source ?? ""} maxLength={300} /></label>
                <label>Renewal / expiration date<input type="date" name="recorded_expiration" defaultValue={efin.recorded_expiration ?? ""} /></label>
                <label className="monarch-check is-wide"><input type="checkbox" name="expiration_verified" defaultChecked={efin.expiration_verified} /> This date is verified. The original deadline is kept in the history when a date changes.</label>
                <label className="is-wide">Reason for a status change (required when the status changes)<input name="reason" maxLength={1000} /></label>
                <label className="is-wide">Notes<textarea name="notes" rows={3} maxLength={4000} defaultValue={efin.notes ?? ""} /></label>
                <label className="monarch-check is-wide"><input type="checkbox" name="confirm" /> I confirm moving this EFIN to suspended or inactive (high-impact).</label>
                <div className="is-wide"><button className="monarch-primary" type="submit">Save changes</button></div>
              </ActionForm>
              </div>
            </details>
          )}
          {org && <EroAdmin s={s} org={org} efin={efin} back={here} openSection={sp.edit} />}
        </>
      )}

      {tab === "team" && (
        <>
          {teamTracked && (
            <>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>Team</h2><p>People holding roles at {orgName(s.orgs, efin.organization_id)}. PTINs are separate credentials and never authorize e-file by themselves.</p></div></div>
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>PERSON</th><th>CONTACT</th><th>ROLE</th><th>VERIFICATION</th><th>PTIN</th></tr></thead>
              <tbody>{orgRoles.length === 0 ? <EmptyRow colSpan={5}>No team members recorded yet.</EmptyRow> : orgRoles.map((r) => {
                const ptin = s.credentials.find((c) => c.person_id === r.person_id && c.kind === "ptin" && !c.archived_at);
                const person = s.people.find((p) => p.id === r.person_id);
                return <tr key={r.id}><td><b>{person?.full_name ?? "—"}</b></td><td>{person?.email ?? "—"}{person?.phone && <div className="monarch-muted">{person.phone}</div>}</td><td>{roleLabel(r.role)}</td><td><Verified value={r.verification_status} /></td><td>{ptin ? <>P••••{ptin.identifier_last4} <Verified value={ptin.verification_status} /></> : <span className="monarch-muted">None recorded</span>}</td></tr>;
              })}</tbody>
            </table></div>
          </section>
          <section className="monarch-panel monarch-pad">
            <h2 id="add-member" style={{ marginTop: 0 }}>Add a team member</h2>
            <ActionForm action={addMemberAction} className="monarch-form">
              <input type="hidden" name="organization_id" value={efin.organization_id} /><input type="hidden" name="back" value={here} />
              <label>Full name<input name="person_name" required maxLength={200} /></label>
              <label>Role<Select name="role" required value="tax_preparer" options={ASSIGNMENT_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))} /></label>
              <label>Email<input name="person_email" type="email" maxLength={254} /></label>
              <label>Phone<input name="person_phone" type="tel" maxLength={40} /></label>
              <label>Office<Select name="location_id" empty="Whole business" options={s.locations.filter((l) => l.organization_id === efin.organization_id).map((l) => ({ value: l.id, label: l.name }))} /></label>
              <label>How was this role confirmed?<Select name="role_verification" value="unverified" options={VERIFY_OPTIONS} /></label>
              <label>PTIN (optional)<input name="ptin" autoComplete="off" maxLength={12} placeholder="P01234567" /></label>
              <label>PTIN confirmed?<Select name="ptin_verification" value="unverified" options={VERIFY_OPTIONS} /></label>
              <label>PTIN source<input name="ptin_source" maxLength={300} /></label>
              <label>PTIN renewal date<input type="date" name="ptin_expires_on" /></label>
              <div className="is-wide"><button className="monarch-primary" type="submit">Add team member</button></div>
            </ActionForm>
          </section>
            </>
          )}
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>Locations</h2><p>Every office this ERO operates from.</p></div></div>
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>OFFICE</th><th>ADDRESS</th><th>PRIMARY</th></tr></thead>
              <tbody>{s.locations.filter((l) => l.organization_id === efin.organization_id && !l.archived_at).map((l) => <tr key={l.id}><td><b>{l.name}</b></td><td>{[l.address.line1, l.address.city, l.address.state, l.address.zip].filter(Boolean).join(", ") || "—"}</td><td>{l.is_primary ? "Yes" : ""}</td></tr>)}</tbody>
            </table></div>
          </section>
          <section className="monarch-panel monarch-pad">
            <h2 style={{ marginTop: 0 }}>Add a location</h2>
            <ActionForm action={saveLocationAction} className="monarch-form">
              <input type="hidden" name="organization_id" value={efin.organization_id} /><input type="hidden" name="back" value={here} />
              <label>Office name<input name="name" required maxLength={200} /></label>
              <label>Street address<input name="line1" maxLength={200} /></label>
              <label>City<input name="city" maxLength={100} /></label>
              <label>State<input name="state" maxLength={2} /></label>
              <label>ZIP<input name="zip" maxLength={10} /></label>
              <label className="monarch-check is-wide"><input type="checkbox" name="is_primary" /> This is the primary office</label>
              <div className="is-wide"><button className="monarch-primary" type="submit">Add location</button></div>
            </ActionForm>
          </section>
        </>
      )}

      {tab === "filing" && teamTracked && (
        <>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>Office assignments</h2><p>Assignments are internal records. They are reviewed by an administrator before they take effect, and are separate from anything the IRS or a software provider has authorized.</p></div></div>
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>PERSON</th><th>ROLE</th><th>STATE</th><th>EFFECTIVE</th><th>ACTIONS</th></tr></thead>
              <tbody>{assignments.length === 0 ? <EmptyRow colSpan={5}>No assignments yet.</EmptyRow> : assignments.map((a) => {
                const blockers = ["draft", "pending_review", "approved"].includes(a.state) ? problemsFor(s, a) : [];
                return (
                  <tr key={a.id}>
                    <td><b>{personName(s.people, a.person_id)}</b></td><td>{roleLabel(a.role)}</td><td><Badge value={a.state} /></td>
                    <td>{a.effective_from ?? "—"} → {a.effective_to ?? "open"}</td>
                    <td>
                      {blockers.length > 0 && <div className="monarch-muted" style={{ whiteSpace: "normal", maxWidth: 360, marginBottom: 8 }}>{blockers[0]}</div>}
                      <TransitionForms a={a} back={here} />
                    </td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          </section>
          {!efin.archived_at && (
            <section className="monarch-panel monarch-pad">
              <h2 style={{ marginTop: 0 }}>Request an assignment</h2>
              <ActionForm action={requestAssignmentAction} className="monarch-form">
                <input type="hidden" name="efin_id" value={id} /><input type="hidden" name="organization_id" value={efin.organization_id} /><input type="hidden" name="back" value={here} />
                <label>Role<Select name="role" required options={ASSIGNMENT_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))} /></label>
                <label>Person<Select name="person_id" empty="Choose a person" options={people.map((p) => ({ value: p.id, label: p.full_name }))} /></label>
                <label>Office<Select name="location_id" empty="Not set" options={s.locations.filter((l) => l.organization_id === efin.organization_id).map((l) => ({ value: l.id, label: l.name }))} /></label>
                <label>Software provider<input name="software_provider" maxLength={120} /></label>
                <label>Effective from<input type="date" name="effective_from" /></label>
                <label>Effective to<input type="date" name="effective_to" /></label>
                <div className="is-wide"><button className="monarch-primary" type="submit">Create draft</button></div>
              </ActionForm>
            </section>
          )}
        </>
      )}

      {tab === "filing" && (
        <>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>Filing relationships</h2><p>Which software provider is set up to file with this EFIN. Each line shows how it was confirmed. Monarch does not sync with any provider, so nothing here is live.</p></div></div>
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>PROVIDER</th><th>PRODUCT</th><th>TAX YEAR</th><th>AUTHORIZATION</th><th>SOURCE</th><th>NEXT STEP</th></tr></thead>
              <tbody>{filings.length === 0 ? <EmptyRow colSpan={6}>No software providers recorded for this EFIN.</EmptyRow> : filings.map((f) => (
                <tr key={f.id}><td><b>{f.software_provider}</b></td><td>{f.software_product ?? "—"}</td><td>{f.tax_year ?? "—"}</td><td><Verified value={f.external_auth_status} /></td><td>{f.verification_source ?? "—"}</td><td style={{ whiteSpace: "normal" }}>{f.remediation_note ?? (f.external_auth_status === "unverified" ? "Confirm with the provider and record how." : "—")}</td></tr>
              ))}</tbody>
            </table></div>
          </section>
          {!efin.archived_at && (
            <section className="monarch-panel monarch-pad">
              <h2 style={{ marginTop: 0 }}>Add a provider</h2>
              <ActionForm action={saveFilingAction} className="monarch-form">
                <input type="hidden" name="efin_id" value={id} /><input type="hidden" name="back" value={here} />
                <label>Software provider<input name="software_provider" required maxLength={120} /></label>
                <label>Product<input name="software_product" maxLength={120} /></label>
                <label>Tax year<input name="tax_year" type="number" min={2000} max={2100} /></label>
                <label>Authorization status<Select name="external_auth_status" value="unverified" options={[...VERIFY_OPTIONS, { value: "not_applicable", label: "Not applicable" }]} /></label>
                <label className="is-wide">How it was confirmed<input name="verification_source" maxLength={300} /></label>
                <label className="is-wide">Next step if unverified<input name="remediation_note" maxLength={1000} /></label>
                <div className="is-wide"><button className="monarch-primary" type="submit">Save</button></div>
              </ActionForm>
            </section>
          )}
        </>
      )}

      {tab === "documents" && (
        <section className="monarch-panel">
          <div className="monarch-panel-head"><div><h2>Documents</h2><p>Supporting files for this EFIN.</p></div></div>
          <div className="monarch-table-wrap"><table><tbody><EmptyRow colSpan={1}>Document upload is not part of this release. Record where each document is kept in the verification source of the EFIN, assignment or credential. Uploads need a private storage bucket and are planned as the next stage.</EmptyRow></tbody></table></div>
        </section>
      )}

      {tab === "renewals" && (
        <section className="monarch-panel">
          <div className="monarch-panel-head"><div><h2>Renewals</h2><p>Reminders go out 60, 30, 14 and 7 days before a verified date, once each. Past the date the EFIN is moved to compliance review; it is never invalidated automatically.</p></div><Link className="monarch-secondary" href="/efin/renewals">All renewals</Link></div>
          <div className="monarch-table-wrap"><table>
            <thead><tr><th>TASK</th><th>DUE</th><th>ORIGINAL DEADLINE</th><th>STATUS</th></tr></thead>
            <tbody>{tasks.length === 0 ? <EmptyRow colSpan={4}>No renewal task. One is created automatically once a verified renewal date is recorded.</EmptyRow> : tasks.map((t) => <tr key={t.id}><td><b>{t.title}</b></td><td>{t.due_on}</td><td>{t.original_due_on}</td><td><Badge value={t.status} /></td></tr>)}</tbody>
          </table></div>
        </section>
      )}

      {tab === "history" && (
        <section className="monarch-panel">
          <div className="monarch-panel-head"><div><h2>Activity history</h2><p>Every change to this EFIN and its assignments. The log cannot be edited or deleted.</p></div></div>
          <div className="monarch-table-wrap"><table>
            <thead><tr><th>WHEN</th><th>WHO</th><th>EVENT</th><th>DETAIL</th></tr></thead>
            <tbody>{history.length === 0 ? <EmptyRow colSpan={4}>Nothing recorded yet.</EmptyRow> : history.map((h) => <tr key={h.id}><td>{when(h.occurred_at)}</td><td>{h.actor_email ?? "System"}</td><td><b>{label(h.event_type.replace(/\./g, " "))}</b></td><td style={{ whiteSpace: "normal" }}>{h.reason ?? ""}{Object.keys(h.changes).length > 0 && <small className="monarch-muted"> {summarize(h.changes)}</small>}</td></tr>)}</tbody>
          </table></div>
        </section>
      )}
      </div>
    </>
  );
}

const summarize = (c: Record<string, unknown>) =>
  Object.entries(c).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${words(k)}: ${typeof v === "object" ? Object.entries(v as Record<string, unknown>).map(([a, b]) => (b && typeof b === "object" ? `${a} ${(b as { from?: unknown }).from} → ${(b as { to?: unknown }).to}` : `${a}`)).join(", ") : String(v)}`).join(" · ");

function TransitionForms({ a, back }: { a: { id: string; state: Parameters<typeof availableTransitions>[0] }; back: string }) {
  const ts = availableTransitions(a.state);
  if (ts.length === 0) return <span className="monarch-muted">{a.state === "revoked" ? "Revoked — cannot be reactivated" : "Ended"}</span>;
  return (
    <div className="efin-actions">
      {ts.map((t) => (
        <ActionForm key={t.to} action={changeAssignmentAction}>
          <input type="hidden" name="id" value={a.id} /><input type="hidden" name="to" value={t.to} /><input type="hidden" name="back" value={back} />
          {t.reasonRequired && <input type="text" name="reason" required minLength={5} maxLength={1000} placeholder="Reason" aria-label="Reason" />}
          {!t.reasonRequired && t.action === "approve" && <input type="text" name="reason" maxLength={1000} placeholder="Reason (needed to approve your own request)" aria-label="Reason" />}
          {!t.reasonRequired && t.action !== "approve" && <input type="hidden" name="reason" value="" />}
          {t.highImpact && <label className="efin-confirm"><input type="checkbox" name="confirm" required /> Confirm</label>}
          <button type="submit" className={"monarch-secondary efin-small" + (t.to === "revoked" || t.to === "suspended" ? " is-danger" : "")}>{ACTION_COPY[t.action] ?? t.action}</button>
        </ActionForm>
      ))}
    </div>
  );
}
