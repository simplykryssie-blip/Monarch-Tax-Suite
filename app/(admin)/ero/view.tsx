import Link from "next/link";
import { Badge, EmptyRow } from "@/components/admin/ui";
import { Icon } from "@/components/admin/icons";
import { daysUntil, maskEfin, roleLabel, todayIso } from "@/lib/efin/rules.ts";
import type { Snapshot } from "@/lib/efin/service";
import { ASSIGNMENT_ROLES } from "@/lib/efin/types.ts";
import { addPtinAction, archivePtinAction } from "../efin/actions";
import { ActionForm } from "../efin/action-form";
import { FormattedInput } from "../efin/formatted-input";
import { Kpi, Select, VERIFY_OPTIONS, Verified } from "../efin/parts";

export function EroDashboard({ s, adding }: { s: Snapshot; adding: boolean }) {
  const today = todayIso();
  const own = s.orgs.filter((o) => o.relationship === "internal" && !o.archived_at);
  const ownIds = new Set(own.map((o) => o.id));
  const ownEfins = s.efins.filter((e) => !e.archived_at && ownIds.has(e.organization_id));
  const orgName = (id: string) => s.orgs.find((o) => o.id === id)?.legal_name ?? "—";
  // PTINs of the people who work at my own office.
  const rows = s.credentials
    .filter((c) => c.kind === "ptin" && !c.archived_at)
    .map((c) => ({ c, roles: s.roles.filter((r) => r.person_id === c.person_id && r.status === "active" && ownIds.has(r.organization_id)), person: s.people.find((p) => p.id === c.person_id) }))
    .filter((r) => r.roles.length > 0)
    .sort((a, b) => (a.person?.full_name ?? "").localeCompare(b.person?.full_name ?? ""));
  const soon = rows.filter((r) => r.c.expires_on && daysUntil(r.c.expires_on, today) >= 0 && daysUntil(r.c.expires_on, today) <= 60).length;
  const peopleWithoutPtin = s.people.filter((p) => !p.archived_at && !s.credentials.some((c) => c.person_id === p.id && c.kind === "ptin" && !c.archived_at) && s.roles.some((r) => r.person_id === p.id && ownIds.has(r.organization_id)));
  const single = own.length === 1 ? own[0] : null;
  return (
    <>
      <div className="mt-kpis">
        <Kpi href="#my-efin" icon="licenses" title="My EFINs" value={ownEfins.length} sub={own.length ? own.map((o) => o.legal_name).join(", ") : "Add your own firm first"} />
        <Kpi href="#ptins" icon="user" title="PTINs" value={rows.length} sub="In my office" />
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

        <section className="monarch-panel" id="ptins">
          <div className="monarch-panel-head">
            <div><h2>PTINs</h2><p>Each PTIN belongs to a person, not a firm. Shown masked. PTINs renew every year; add the renewal date so you can see what is coming.</p></div>
            {own.length > 0 && !adding && <Link className="monarch-primary" href="/ero?add=1#add-ptin"><Icon name="plus" size={16} /> Add PTIN</Link>}
          </div>

          {adding && own.length > 0 && (
            <div className="efin-edit-body" id="add-ptin" style={{ padding: "0 20px 20px" }}>
              <ActionForm action={addPtinAction} className="monarch-form">
                <label>Name<input name="person_name" maxLength={200} autoComplete="off" /></label>
                <label>PTIN<FormattedInput kind="ptin" name="ptin" /></label>
                <label>Renewal date<input type="date" name="ptin_expires_on" /></label>
                {single && <input type="hidden" name="organization_id" value={single.id} />}
                <details className="is-wide efin-advanced">
                  <summary>More options</summary>
                  <div className="monarch-form" style={{ marginTop: 12 }}>
                    {!single && <label>Firm<Select name="organization_id" required options={own.map((o) => ({ value: o.id, label: o.legal_name }))} /></label>}
                    {peopleWithoutPtin.length > 0 && <label>Or choose someone already on your list<Select name="person_id" empty="Use the name above" options={peopleWithoutPtin.map((p) => ({ value: p.id, label: p.full_name }))} /></label>}
                    <label>Role<Select name="role" value="tax_preparer" options={ASSIGNMENT_ROLES.filter((r) => r !== "bureau_administrator").map((r) => ({ value: r, label: roleLabel(r) }))} /></label>
                    <label>Confirmation status<Select name="ptin_verification" value="unverified" options={VERIFY_OPTIONS} /></label>
                    <label>How it was confirmed<input name="ptin_source" maxLength={300} /></label>
                    <label>Email<input name="person_email" type="email" maxLength={254} /></label>
                    <label>Phone<FormattedInput kind="phone" name="person_phone" /></label>
                  </div>
                </details>
                <div className="is-wide efin-actions">
                  <button className="monarch-primary" type="submit">Save PTIN</button>
                  <Link className="monarch-secondary" href="/ero">Cancel</Link>
                </div>
              </ActionForm>
            </div>
          )}

          <div className="monarch-table-wrap"><table>
            <thead><tr><th>PREPARER</th><th>FIRM</th><th>ROLE</th><th>PTIN</th><th>STATUS</th><th>RENEWS</th><th></th></tr></thead>
            <tbody>
              {rows.length === 0 ? <EmptyRow colSpan={7}>{own.length === 0 ? "Add your own firm first, then record the PTINs of the people who prepare for it." : "No PTINs recorded yet. Use Add PTIN above."}</EmptyRow> : rows.map(({ c, roles, person }) => {
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
      </div>
    </>
  );
}
