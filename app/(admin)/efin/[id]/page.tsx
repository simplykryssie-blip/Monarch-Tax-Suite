import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { Badge, EmptyRow, Flash, label, load, PageTitle, SetupRequired, when } from "@/components/admin/ui";
import { availableTransitions, daysUntil, roleLabel, todayIso } from "@/lib/efin/rules.ts";
import { loadEfinAudit, loadSnapshot, problemsFor } from "@/lib/efin/service";
import { ASSIGNMENT_ROLES, EFIN_STATUSES } from "@/lib/efin/types.ts";
import { addMemberAction, saveLocationAction, archiveEfinAction, changeAssignmentAction, requestAssignmentAction, saveFilingAction, updateEfinAction } from "../actions";
import { orgName, personName, Select, VERIFY_OPTIONS, Verified } from "../parts";
import { RevealEfin } from "../reveal";

const TABS = [
  ["overview", "Overview"],
  ["parties", "Office & Team"],
  ["assignments", "Office Assignments"],
  ["filing", "Filing Relationships"],
  ["documents", "Documents"],
  ["renewals", "Renewals"],
  ["history", "Activity History"],
] as const;

const ACTION_COPY: Record<string, string> = { submit: "Submit for review", approve: "Approve", return: "Return to draft", activate: "Activate", suspend: "Suspend", revoke: "Revoke", expire: "Mark expired", reinstate: "Reinstate" };

export default async function EfinProfile({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; notice?: string; error?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as string) : "overview";
  const result = await load(loadSnapshot);
  if (!result.ok) return <SetupRequired message={result.message} />;
  const s = result.data;
  const efin = s.efins.find((e) => e.id === id);
  if (!efin) notFound();
  const here = `/efin/${id}?tab=${tab}`;
  const assignments = s.assignments.filter((a) => a.efin_id === id);
  const filings = s.filings.filter((f) => f.efin_id === id && !f.archived_at);
  const tasks = s.tasks.filter((t) => t.subject_type === "efin" && t.subject_id === id);
  const history = tab === "history" ? await loadEfinAudit(s, id) : [];
  const today = todayIso();
  const orgRoles = s.roles.filter((r) => r.organization_id === efin.organization_id && r.status === "active");
  const people = s.people.filter((p) => !p.archived_at);
  return (
    <>
      <PageTitle title={`EFIN ending ${efin.efin_last4}`} back={{ href: "/efin/list", label: "EROs & EFINs" }}>{orgName(s.orgs, efin.organization_id)}{efin.archived_at && " · Archived"}</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      <nav className="efin-tabs" aria-label="EFIN sections">
        {TABS.map(([k, name]) => <Link key={k} href={`/efin/${id}?tab=${k}`} className={tab === k ? "is-on" : ""}>{name}</Link>)}
      </nav>

      {tab === "overview" && (
        <>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>Overview</h2><p>What is recorded for this EFIN.</p></div><Badge value={efin.internal_status === "pending_verification" ? "pending" : efin.internal_status} /></div>
            <dl className="efin-facts">
              <div><dt>EFIN</dt><dd><RevealEfin id={id} last4={efin.efin_last4} /></dd></div>
              <div><dt>Organization</dt><dd>{orgName(s.orgs, efin.organization_id)}</dd></div>
              <div><dt>Filing office</dt><dd>{s.locations.find((l) => l.id === efin.location_id)?.name ?? "—"}{s.locations.filter((l) => l.organization_id === efin.organization_id && !l.archived_at).length > 1 && <small className="monarch-muted"> · {s.locations.filter((l) => l.organization_id === efin.organization_id && !l.archived_at).length} locations in total</small>}</dd></div>
              <div><dt>ERO / Responsible Official</dt><dd>{personName(s.people, efin.ero_person_id)}</dd></div>
              <div><dt>Verification</dt><dd><Verified value={efin.external_status} /> {efin.external_verified_at && <small className="monarch-muted">{when(efin.external_verified_at)}</small>}</dd></div>
              <div><dt>Source</dt><dd>{efin.verification_source ?? "—"}</dd></div>
              <div><dt>Recorded renewal date</dt><dd>{efin.recorded_expiration ?? "Not recorded"}{efin.recorded_expiration && <> <small className="monarch-muted">{efin.expiration_verified ? "verified" : "not verified"} · {daysUntil(efin.recorded_expiration, today)} days</small></>}</dd></div>
              <div><dt>Tax year</dt><dd>{efin.tax_year ?? "—"}</dd></div>
              <div><dt>Added</dt><dd>{when(efin.created_at)}</dd></div>
            </dl>
            <p className="efin-note">Verification here means someone recorded checking it. Monarch does not read live IRS status and never marks an EFIN approved on its own.</p>
          </section>
          {!efin.archived_at && (
            <section className="monarch-panel monarch-pad">
              <h2 style={{ marginTop: 0 }}>Update record</h2>
              <form action={updateEfinAction} className="monarch-form">
                <input type="hidden" name="id" value={id} /><input type="hidden" name="back" value={here} />
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
              </form>
            </section>
          )}
          {!efin.archived_at && (
            <section className="monarch-panel monarch-pad">
              <h2 style={{ marginTop: 0 }}>Archive</h2>
              <p className="monarch-muted">Archiving removes this EFIN from the registry and stops reminders. The record and its history are kept.</p>
              <form action={archiveEfinAction} className="efin-actions">
                <input type="hidden" name="id" value={id} /><input type="hidden" name="back" value={here} />
                <input type="text" name="reason" required minLength={5} maxLength={500} placeholder="Reason" aria-label="Reason" />
                <label className="efin-confirm"><input type="checkbox" name="confirm" required /> Confirm</label>
                <button className="monarch-secondary is-danger efin-small" type="submit">Archive EFIN</button>
              </form>
            </section>
          )}
        </>
      )}

      {tab === "parties" && (
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
            <h2 style={{ marginTop: 0 }}>Add a team member</h2>
            <form action={addMemberAction} className="monarch-form">
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
            </form>
          </section>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>Locations</h2><p>Every office this ERO operates from.</p></div></div>
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>OFFICE</th><th>ADDRESS</th><th>PRIMARY</th></tr></thead>
              <tbody>{s.locations.filter((l) => l.organization_id === efin.organization_id && !l.archived_at).map((l) => <tr key={l.id}><td><b>{l.name}</b></td><td>{[l.address.line1, l.address.city, l.address.state, l.address.zip].filter(Boolean).join(", ") || "—"}</td><td>{l.is_primary ? "Yes" : ""}</td></tr>)}</tbody>
            </table></div>
          </section>
          <section className="monarch-panel monarch-pad">
            <h2 style={{ marginTop: 0 }}>Add a location</h2>
            <form action={saveLocationAction} className="monarch-form">
              <input type="hidden" name="organization_id" value={efin.organization_id} /><input type="hidden" name="back" value={here} />
              <label>Office name<input name="name" required maxLength={200} /></label>
              <label>Street address<input name="line1" maxLength={200} /></label>
              <label>City<input name="city" maxLength={100} /></label>
              <label>State<input name="state" maxLength={2} /></label>
              <label>ZIP<input name="zip" maxLength={10} /></label>
              <label className="monarch-check is-wide"><input type="checkbox" name="is_primary" /> This is the primary office</label>
              <div className="is-wide"><button className="monarch-primary" type="submit">Add location</button></div>
            </form>
          </section>
        </>
      )}

      {tab === "assignments" && (
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
              <form action={requestAssignmentAction} className="monarch-form">
                <input type="hidden" name="efin_id" value={id} /><input type="hidden" name="organization_id" value={efin.organization_id} /><input type="hidden" name="back" value={here} />
                <label>Role<Select name="role" required options={ASSIGNMENT_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))} /></label>
                <label>Person<Select name="person_id" empty="Choose a person" options={people.map((p) => ({ value: p.id, label: p.full_name }))} /></label>
                <label>Office<Select name="location_id" empty="Not set" options={s.locations.filter((l) => l.organization_id === efin.organization_id).map((l) => ({ value: l.id, label: l.name }))} /></label>
                <label>Software provider<input name="software_provider" maxLength={120} /></label>
                <label>Effective from<input type="date" name="effective_from" /></label>
                <label>Effective to<input type="date" name="effective_to" /></label>
                <div className="is-wide"><button className="monarch-primary" type="submit">Create draft</button></div>
              </form>
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
              <form action={saveFilingAction} className="monarch-form">
                <input type="hidden" name="efin_id" value={id} /><input type="hidden" name="back" value={here} />
                <label>Software provider<input name="software_provider" required maxLength={120} /></label>
                <label>Product<input name="software_product" maxLength={120} /></label>
                <label>Tax year<input name="tax_year" type="number" min={2000} max={2100} /></label>
                <label>Authorization status<Select name="external_auth_status" value="unverified" options={[...VERIFY_OPTIONS, { value: "not_applicable", label: "Not applicable" }]} /></label>
                <label className="is-wide">How it was confirmed<input name="verification_source" maxLength={300} /></label>
                <label className="is-wide">Next step if unverified<input name="remediation_note" maxLength={1000} /></label>
                <div className="is-wide"><button className="monarch-primary" type="submit">Save</button></div>
              </form>
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
    </>
  );
}

const summarize = (c: Record<string, unknown>) =>
  Object.entries(c).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "object" ? Object.entries(v as Record<string, unknown>).map(([a, b]) => (b && typeof b === "object" ? `${a} ${(b as { from?: unknown }).from} → ${(b as { to?: unknown }).to}` : `${a}`)).join(", ") : String(v)}`).join(" · ");

function TransitionForms({ a, back }: { a: { id: string; state: Parameters<typeof availableTransitions>[0] }; back: string }) {
  const ts = availableTransitions(a.state);
  if (ts.length === 0) return <span className="monarch-muted">{a.state === "revoked" ? "Revoked — cannot be reactivated" : "Ended"}</span>;
  return (
    <div className="efin-actions">
      {ts.map((t) => (
        <form key={t.to} action={changeAssignmentAction}>
          <input type="hidden" name="id" value={a.id} /><input type="hidden" name="to" value={t.to} /><input type="hidden" name="back" value={back} />
          {t.reasonRequired && <input type="text" name="reason" required minLength={5} maxLength={1000} placeholder="Reason" aria-label="Reason" />}
          {!t.reasonRequired && t.action === "approve" && <input type="text" name="reason" maxLength={1000} placeholder="Reason (needed to approve your own request)" aria-label="Reason" />}
          {!t.reasonRequired && t.action !== "approve" && <input type="hidden" name="reason" value="" />}
          {t.highImpact && <label className="efin-confirm"><input type="checkbox" name="confirm" required /> Confirm</label>}
          <button type="submit" className={"monarch-secondary efin-small" + (t.to === "revoked" || t.to === "suspended" ? " is-danger" : "")}>{ACTION_COPY[t.action] ?? t.action}</button>
        </form>
      ))}
    </div>
  );
}
