import { FormattedInput } from "../formatted-input";
import { ActionForm } from "../action-form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { Badge, EmptyRow, Flash, label, load, PageTitle, SetupRequired, when } from "@/components/admin/ui";
import { availableTransitions, roleLabel, tracksTeam } from "@/lib/efin/rules.ts";
import { loadEfinAudit, loadSnapshot, problemsFor } from "@/lib/efin/service";
import { ASSIGNMENT_ROLES } from "@/lib/efin/types.ts";
import { addMemberAction, changeAssignmentAction, requestAssignmentAction, saveFilingAction } from "../actions";
import { orgName, personName, Select, VERIFY_OPTIONS, Verified } from "../parts";
import { FirmHeader, OverviewCards } from "../firm-card";
import { Icon, type IconName } from "@/components/admin/icons";
import { nextSteps } from "@/lib/efin/steps.ts";
import { words } from "@/lib/efin/text.ts";
import { displayPhone } from "@/lib/efin/format.ts";

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
  const tabs = TABS.filter(([k]) => teamTracked || k !== "team");
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
        </>
      )}

      {tab === "team" && teamTracked && (
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
                return <tr key={r.id}><td><b>{person?.full_name ?? "—"}</b></td><td>{person?.email ?? "—"}{person?.phone && <div className="monarch-muted">{displayPhone(person.phone)}</div>}</td><td>{roleLabel(r.role)}</td><td><Verified value={r.verification_status} /></td><td>{ptin ? <>P••••{ptin.identifier_last4} <Verified value={ptin.verification_status} /></> : <span className="monarch-muted">None recorded</span>}</td></tr>;
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
              <label>Phone<FormattedInput kind="phone" name="person_phone"  /></label>
              <label>Office<Select name="location_id" empty="Whole business" options={s.locations.filter((l) => l.organization_id === efin.organization_id).map((l) => ({ value: l.id, label: l.name }))} /></label>
              <label>How was this role confirmed?<Select name="role_verification" value="unverified" options={VERIFY_OPTIONS} /></label>
              <label>PTIN (optional)<FormattedInput kind="ptin" name="ptin"  /></label>
              <label>PTIN confirmed?<Select name="ptin_verification" value="unverified" options={VERIFY_OPTIONS} /></label>
              <label>PTIN source<input name="ptin_source" maxLength={300} /></label>
              <label>PTIN renewal date<input type="date" name="ptin_expires_on" /></label>
              <div className="is-wide"><button className="monarch-primary" type="submit">Add team member</button></div>
            </ActionForm>
          </section>
            </>
          )}
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
