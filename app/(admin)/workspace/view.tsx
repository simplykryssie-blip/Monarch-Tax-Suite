import Link from "next/link";
import { Badge, EmptyRow } from "@/components/admin/ui";
import { Icon } from "@/components/admin/icons";
import { displayPhone } from "@/lib/efin/format.ts";
import { daysUntil, maskEfin, roleLabel, todayIso } from "@/lib/efin/rules.ts";
import type { Snapshot } from "@/lib/efin/service";
import { ASSIGNMENT_ROLES } from "@/lib/efin/types.ts";
import { addPtinAction, archivePtinAction } from "../efin/actions";
import { ActionForm } from "../efin/action-form";
import { FormattedInput } from "../efin/formatted-input";
import { Kpi, Select, VERIFY_OPTIONS, Verified } from "../efin/parts";

export function WorkspaceView({ s, open }: { s: Snapshot; open: boolean }) {
  const today = todayIso();
  const own = s.orgs.filter((o) => o.relationship === "internal" && !o.archived_at);
  const partners = s.orgs.filter((o) => o.relationship === "partner" && !o.archived_at);
  const teamOrgs = [...own, ...partners];
  const teamIds = new Set(teamOrgs.map((o) => o.id));
  const ownEfins = s.efins.filter((e) => !e.archived_at && own.some((o) => o.id === e.organization_id));
  const orgName = (id: string) => s.orgs.find((o) => o.id === id)?.legal_name ?? "—";
  // PTINs of the people who work at my firms and partner firms.
  const rows = s.credentials
    .filter((c) => c.kind === "ptin" && !c.archived_at)
    .map((c) => {
      const roles = s.roles.filter((r) => r.person_id === c.person_id && r.status === "active" && teamIds.has(r.organization_id));
      return { c, roles, person: s.people.find((p) => p.id === c.person_id) };
    })
    .filter((r) => r.roles.length > 0)
    .sort((a, b) => (a.person?.full_name ?? "").localeCompare(b.person?.full_name ?? ""));
  const soon = rows.filter((r) => r.c.expires_on && daysUntil(r.c.expires_on, today) >= 0 && daysUntil(r.c.expires_on, today) <= 60).length;
  const attached = (orgId: string) => ownEfins.filter((e) => s.assignments.some((a) => a.efin_id === e.id && a.organization_id === orgId && !["revoked", "expired"].includes(a.state)));
  const peopleWithoutPtin = s.people.filter((p) => !p.archived_at && !s.credentials.some((c) => c.person_id === p.id && c.kind === "ptin" && !c.archived_at) && s.roles.some((r) => r.person_id === p.id && teamIds.has(r.organization_id)));
  return (
    <>
      <div className="mt-kpis">
        <Kpi href="#my-efin" icon="licenses" title="My EFINs" value={ownEfins.length} sub={own.length ? own.map((o) => o.legal_name).join(", ") : "Add your own firm first"} />
        <Kpi href="#partners" icon="firms" title="Partner EROs" value={partners.length} sub={`${partners.filter((o) => attached(o.id).length > 0).length} attached to my EFIN`} />
        <Kpi href="#ptins" icon="user" title="PTINs" value={rows.length} sub="Across my firm and partners" />
        <Kpi href="#ptins" icon="bell" title="PTIN renewals soon" value={soon} sub="Within 60 days" />
      </div>

      <div className="efin-flow">
        <section className="monarch-panel" id="my-efin">
          <div className="monarch-panel-head"><div><h2>My EFIN</h2><p>Your own tax office and the EFIN it files under.</p></div></div>
          <div className="monarch-table-wrap"><table>
            <thead><tr><th>FIRM</th><th>EFIN</th><th>STATUS</th><th>CONFIRMATION</th></tr></thead>
            <tbody>
              {own.length === 0 ? (
                <EmptyRow colSpan={4}>No firm marked as your own office yet. <Link href="/efin/new" className="efin-card-link">Add a firm</Link> and choose &quot;My own tax office&quot;.</EmptyRow>
              ) : own.flatMap((o) => {
                const efins = s.efins.filter((e) => e.organization_id === o.id && !e.archived_at);
                return efins.length === 0
                  ? [<tr key={o.id}><td><Link href={`/efin/org/${o.id}`}><b>{o.legal_name}</b></Link></td><td colSpan={3} className="monarch-muted">No EFIN recorded yet</td></tr>]
                  : efins.map((e) => <tr key={e.id}><td><Link href={`/efin/${e.id}`}><b>{o.legal_name}</b></Link></td><td className="efin-mask">{maskEfin(e.efin_last4)}</td><td><Badge value={e.internal_status === "pending_verification" ? "pending" : e.internal_status} /></td><td><Verified value={e.external_status} /></td></tr>);
              })}
            </tbody>
          </table></div>
        </section>

        <section className="monarch-panel" id="partners">
          <div className="monarch-panel-head"><div><h2>Partner EROs</h2><p>Partner firms whose preparers you may manage. &quot;Attached&quot; means an assignment to one of your EFINs exists.</p></div><Link className="mt-card-link" href="/efin/new">Add a firm</Link></div>
          <div className="monarch-table-wrap"><table>
            <thead><tr><th>PARTNER ERO</th><th>CONTACT</th><th>EFIN</th><th>PTINS</th><th>ATTACHED TO MY EFIN</th></tr></thead>
            <tbody>
              {partners.length === 0 ? <EmptyRow colSpan={5}>No partner EROs yet. Add a firm and choose &quot;Partner&quot;.</EmptyRow> : partners.map((o) => {
                const efin = s.efins.find((e) => e.organization_id === o.id && !e.archived_at);
                const person = s.people.find((p) => p.id === (efin?.ero_person_id ?? o.administrator_person_id));
                const ptins = rows.filter((r) => r.roles.some((x) => x.organization_id === o.id)).length;
                const links = attached(o.id);
                return (
                  <tr key={o.id}>
                    <td><Link href={efin ? `/efin/${efin.id}` : `/efin/org/${o.id}`}><b>{o.legal_name}</b></Link></td>
                    <td>{person?.full_name ?? "—"}{person?.phone && <div className="monarch-muted">{displayPhone(person.phone)}</div>}</td>
                    <td className="efin-mask">{efin ? maskEfin(efin.efin_last4) : <span className="monarch-muted">None</span>}</td>
                    <td>{ptins}</td>
                    <td>{links.length ? links.map((e) => <span className="efin-tag" key={e.id}>EFIN {maskEfin(e.efin_last4)}</span>) : <span className="monarch-muted">Not attached yet</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </section>

        <section className="monarch-panel" id="ptins">
          <div className="monarch-panel-head">
            <div><h2>PTINs</h2><p>Each PTIN belongs to a person, not a firm. Shown masked. PTINs renew every year; add the renewal date so you can see what is coming.</p></div>
            {teamOrgs.length > 0 && <Link className="monarch-primary" href="/workspace?add=1#add-ptin"><Icon name="plus" size={16} /> Add PTIN</Link>}
          </div>
          <div className="monarch-table-wrap"><table>
            <thead><tr><th>PREPARER</th><th>FIRM</th><th>ROLE</th><th>PTIN</th><th>STATUS</th><th>RENEWS</th><th></th></tr></thead>
            <tbody>
              {rows.length === 0 ? <EmptyRow colSpan={7}>No PTINs recorded yet. Use Add PTIN below.</EmptyRow> : rows.map(({ c, roles, person }) => {
                const left = c.expires_on ? daysUntil(c.expires_on, today) : null;
                return (
                  <tr key={c.id}>
                    <td><b>{person?.full_name ?? "—"}</b>{person?.email && <div className="monarch-muted">{person.email}</div>}</td>
                    <td>{[...new Set(roles.map((r) => orgName(r.organization_id)))].join(", ")}</td>
                    <td>{[...new Set(roles.map((r) => roleLabel(r.role)))].join(", ")}</td>
                    <td className="efin-mask">P••••{c.identifier_last4}</td>
                    <td><Verified value={c.verification_status} /></td>
                    <td>{c.expires_on ? <>{c.expires_on}{left !== null && <small className={left < 0 ? "" : "monarch-muted"} style={left < 0 ? { color: "#a8322b" } : undefined}> · {left < 0 ? `${-left} days past` : `${left} days`}</small>}</> : <span className="monarch-muted">Not recorded</span>}</td>
                    <td>
                      <ActionForm action={archivePtinAction} confirm={`Remove the PTIN ending ${c.identifier_last4} for ${person?.full_name ?? "this person"} from your list?`}>
                        <input type="hidden" name="id" value={c.id} /><input type="hidden" name="confirm" value="on" />
                        <button className="monarch-secondary is-danger efin-small" type="submit">Remove</button>
                      </ActionForm>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </section>

        <details className="efin-edit" id="add-ptin" open={open}>
          <summary>Add a PTIN</summary>
          <div className="efin-edit-body">
            {teamOrgs.length === 0 ? (
              <p className="monarch-muted" style={{ margin: 0 }}>PTINs belong to a firm that keeps a team: your own office or a partner. <Link href="/efin/new" className="efin-card-link">Add a firm</Link> first.</p>
            ) : (
              <ActionForm action={addPtinAction} className="monarch-form">
                <label>Firm<Select name="organization_id" required options={teamOrgs.map((o) => ({ value: o.id, label: `${o.legal_name} (${o.relationship === "internal" ? "my office" : "partner"})` }))} /></label>
                <label>Preparer<Select name="person_id" empty="New person (enter details below)" options={peopleWithoutPtin.map((p) => ({ value: p.id, label: p.full_name }))} /></label>
                <label>Full name (new person)<input name="person_name" maxLength={200} autoComplete="off" /></label>
                <label>Role<Select name="role" value="tax_preparer" options={ASSIGNMENT_ROLES.filter((r) => r !== "bureau_administrator").map((r) => ({ value: r, label: roleLabel(r) }))} /></label>
                <label>Email (new person)<input name="person_email" type="email" maxLength={254} /></label>
                <label>Phone (new person)<FormattedInput kind="phone" name="person_phone" /></label>
                <label>PTIN<FormattedInput kind="ptin" name="ptin" /></label>
                <label>Status<Select name="ptin_verification" value="unverified" options={VERIFY_OPTIONS} /></label>
                <label>How it was confirmed<input name="ptin_source" maxLength={300} /></label>
                <label>PTIN renewal date<input type="date" name="ptin_expires_on" /></label>
                <p className="efin-note is-wide" style={{ padding: 0 }}>Choose an existing person to attach a PTIN to them, or leave Preparer on &quot;New person&quot; and fill in their name. Software and service clients are not listed because no PTINs are kept for them.</p>
                <div className="is-wide"><button className="monarch-primary" type="submit">Add PTIN</button></div>
              </ActionForm>
            )}
          </div>
        </details>
      </div>
    </>
  );
}
