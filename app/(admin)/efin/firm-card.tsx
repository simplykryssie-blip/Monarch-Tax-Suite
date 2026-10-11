import Link from "next/link";
import { Badge, label, when } from "@/components/admin/ui";
import { Icon, type IconName } from "@/components/admin/icons";
import { daysUntil, roleLabel, tracksTeam } from "@/lib/efin/rules.ts";
import type { Snapshot } from "@/lib/efin/service";
import type { Step } from "@/lib/efin/steps.ts";
import type { AuditRow, EfinRow, OrgRow } from "@/lib/efin/types";
import { displayAddress, displayPhone } from "@/lib/efin/format.ts";
import { structureLabel } from "@/lib/efin/text.ts";
import { Verified } from "./parts";
import { RevealEfin } from "./reveal";
import { PopupLink } from "./popup-link";

export const REL_LABEL: Record<string, string> = { internal: "My tax office", partner: "Partner office", client: "Software / service client", other: "Other" };
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const addressLine = (a: Record<string, string> | null | undefined) => displayAddress(a);
const statusValue = (e: EfinRow) => (e.internal_status === "pending_verification" ? "pending" : e.internal_status);

function CardHead({ icon, title, sub, href, action, popup }: { icon: IconName; title: string; sub?: string; href?: string; action?: string; popup?: string }) {
  return (
    <div className="efin-card-head">
      <span className="efin-card-ico"><Icon name={icon} size={22} /></span>
      <div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>
      {href && (popup ? <PopupLink className="efin-card-link" href={href} title={popup}>{action ?? "Edit"}</PopupLink> : <Link className="efin-card-link" href={href}>{action ?? "Edit"}</Link>)}
    </div>
  );
}

/** Breadcrumb, firm header with contact lines, the EFIN at a glance, and a "Next steps" checklist. */
export function FirmHeader({ s, org, efin, steps, base }: { s: Snapshot; org: OrgRow; efin?: EfinRow; steps: Step[]; base: string }) {
  const person = s.people.find((p) => p.id === (efin?.ero_person_id ?? org.administrator_person_id));
  const address = addressLine(org.primary_address);
  const todo = steps.filter((x) => !x.done);
  const editLink = (section: string) => (efin ? `${base}/edit?open=${section}` : `${base}?edit=${section}#manage`);
  const left = efin?.recorded_expiration ? daysUntil(efin.recorded_expiration, new Date().toISOString().slice(0, 10)) : null;
  return (
    <>
      <nav className="efin-crumbs" aria-label="Breadcrumb">
        <Link href="/efin" aria-label="My Service Bureau"><Icon name="home" size={16} /></Link>
        <Link href="/efin">My Service Bureau</Link><span>›</span>
        <Link href="/efin/list">Firms</Link><span>›</span>
        <b>{org.legal_name}</b>
      </nav>
      <header className="efin-firm">
        <div className="efin-monogram" aria-hidden="true">{initials(org.legal_name)}</div>
        <div className="efin-firm-body">
          <span className="efin-reltag">{REL_LABEL[org.relationship] ?? org.relationship}{org.archived_at ? " · Archived" : ""}</span>
          <h1>{org.legal_name}</h1>
          <p className="efin-firm-line">
            {person && <span>{person.full_name}</span>}
            {person?.email && <a href={`mailto:${person.email}`}>{person.email}</a>}
            {person?.phone && <a href={`tel:${person.phone}`}>{displayPhone(person.phone)}</a>}
          </p>
          {address && <p className="efin-firm-line"><span>{address}</span></p>}
        </div>
        <div className="efin-firm-actions">
          {!org.archived_at && (efin ? <PopupLink className="monarch-secondary efin-gold" href={editLink("firm")} title="Edit firm"><Icon name="pencil" size={16} /> Edit firm</PopupLink> : <Link className="monarch-secondary efin-gold" href={editLink("firm")}><Icon name="pencil" size={16} /> Edit firm</Link>)}
          <details className="efin-more">
            <summary aria-label="More actions"><Icon name="dots" size={18} /></summary>
            <div className="efin-more-menu">
              {!org.archived_at && (efin ? <PopupLink href={editLink("efin")} title="Add another EFIN">Add another EFIN</PopupLink> : <Link href={editLink("efin")}>Add another EFIN</Link>)}
              {efin ? <PopupLink href={editLink("more")} title="Archive or delete">Archive or delete</PopupLink> : <Link href={editLink("more")}>Archive or delete</Link>}
            </div>
          </details>
        </div>
      </header>

      <div className="efin-top">
        <div className="efin-card efin-glance-card">
          {efin ? (
            <div className="efin-glance">
              <div><span>EFIN</span><RevealEfin id={efin.id} last4={efin.efin_last4} /></div>
              <div><span>Status</span><Badge value={statusValue(efin)} /></div>
              <div><span>Verification</span><Verified value={efin.external_status} /></div>
              <div><span>Next review</span>{efin.recorded_expiration ? <>{efin.recorded_expiration}{left !== null && <small className="monarch-muted"> · {left < 0 ? `${-left} days past` : `${left} days`}</small>}</> : <span className="monarch-muted">Not recorded</span>}</div>
            </div>
          ) : (
            <p className="monarch-muted" style={{ margin: 0 }}>No EFIN recorded for this firm yet.</p>
          )}
        </div>
        <div className="efin-card efin-steps">
          <span className="efin-card-ico"><Icon name="checklist" size={24} /></span>
          <div className="efin-steps-body">
            <h2>Next steps</h2>
            <p>{todo.length === 0 ? "Everything on the checklist is recorded." : todo[0].label + (todo.length > 1 ? ` (+${todo.length - 1} more)` : "")}</p>
            <details className="efin-checklist">
              <summary className="monarch-primary efin-small">View checklist <Icon name="arrow" size={14} /></summary>
              <ul>
                {steps.map((x) => (
                  <li key={x.key} className={x.done ? "is-done" : ""}><Icon name={x.done ? "check" : "chevron"} size={14} /><Link href={`${base}?tab=${x.tab}`}>{x.label}</Link></li>
                ))}
              </ul>
            </details>
          </div>
        </div>
      </div>
    </>
  );
}

/** The overview tab: one details card (business + EFIN & officials), the team, and recent activity. Everything else is a tab or the Edit page. */
export function OverviewCards({ s, org, efin, base, activity }: { s: Snapshot; org: OrgRow; efin?: EfinRow; base: string; activity: AuditRow[] }) {
  const team = tracksTeam(org.relationship);
  const person = s.people.find((p) => p.id === (efin?.ero_person_id ?? org.administrator_person_id));
  const roles = s.roles.filter((r) => r.organization_id === org.id && r.status === "active");
  const names = (role: string) => roles.filter((r) => r.role === role).map((r) => s.people.find((p) => p.id === r.person_id)?.full_name).filter(Boolean) as string[];
  const locations = s.locations.filter((l) => l.organization_id === org.id && !l.archived_at);
  const where = efin ? `${base}/edit?open=` : `${base}?edit=`;
  const locBase = `/efin/locations/${org.id}${efin ? `?from=${efin.id}` : ""}`;
  const locAdd = `/efin/locations/${org.id}?add=1${efin ? `&from=${efin.id}` : ""}`;
  const docBase = `/efin/documents/${org.id}${efin ? `?from=${efin.id}` : ""}`;
  const docAdd = `/efin/documents/${org.id}?add=1${efin ? `&from=${efin.id}` : ""}#upload`;
  const docs = s.documents.filter((d) => d.subject_type === "organization" && d.subject_id === org.id);
  const used = (kind: string) => s.options.filter((o) => o.kind === kind && s.orgOptions.some((x) => x.organization_id === org.id && x.option_id === o.id)).map((o) => o.name).join(", ");
  const none = <span className="monarch-muted">Not recorded</span>;
  const structure = org.business_structure ? structureLabel(org.business_structure) : null;
  return (
    <div className="efin-grid efin-overview">
      <section className="efin-card efin-span">
        <CardHead icon="firms" title="Firm details" href={`${where}firm${efin ? "" : "#manage"}`} popup={efin ? "Edit firm" : undefined} />
        <div className="efin-two">
          <dl className="efin-kv">
            <div><dt>Relationship</dt><dd>{REL_LABEL[org.relationship] ?? org.relationship}</dd></div>
            <div><dt>Agreement</dt><dd>{label(org.agreement_status)}</dd></div>
            <div><dt>Business type</dt><dd>{structure ?? none}</dd></div>
            <div><dt>EIN</dt><dd className="efin-mask">{org.ein_last4 ? `••-•••${org.ein_last4}` : none}</dd></div>
            <div>
              <dt>Documents</dt>
              <dd>{docs.length} document{docs.length === 1 ? "" : "s"}
                <span className="efin-inline-actions"><PopupLink className="efin-card-link" href={docBase} title="Documents">View</PopupLink><PopupLink className="efin-card-link" href={docAdd} title="Upload a document">+ Upload</PopupLink></span>
              </dd>
            </div>
            <div>
              <dt>Locations</dt>
              <dd>{locations.length} location{locations.length === 1 ? "" : "s"}
                <span className="efin-inline-actions"><PopupLink className="efin-card-link" href={locBase} title="Locations">View</PopupLink><PopupLink className="efin-card-link" href={locAdd} title="Add a location">+ Add</PopupLink></span>
              </dd>
            </div>
          </dl>
          <dl className="efin-kv">
            <div><dt>ERO</dt><dd>{(names("ero")[0] ?? person?.full_name) || none}</dd></div>
            <div><dt>Responsible Official</dt><dd>{names("responsible_official").join(", ") || none}</dd></div>
            <div><dt>Principal(s)</dt><dd>{names("principal").join(", ") || none}</dd></div>
            <div><dt>Filing office</dt><dd>{(efin && s.locations.find((l) => l.id === efin.location_id)?.name) || none}</dd></div>
            <div><dt>Tax software</dt><dd>{used("tax_software") || (efin ? <PopupLink className="efin-card-link" href={`${where}software`} title="Software & banking">Choose</PopupLink> : <Link className="efin-card-link" href={`${where}software#manage`}>Choose</Link>)}</dd></div>
            <div><dt>Bank products</dt><dd>{used("bank_product") || (efin ? <PopupLink className="efin-card-link" href={`${where}software`} title="Software & banking">Choose</PopupLink> : <Link className="efin-card-link" href={`${where}software#manage`}>Choose</Link>)}</dd></div>
          </dl>
        </div>
      </section>

      {team && (
        <section className="efin-card">
          <CardHead icon="customers" title="Team" sub="PTINs are individual credentials." href={`${base}?tab=team`} action="Manage" />
          <div className="monarch-table-wrap"><table>
            <thead><tr><th>NAME</th><th>ROLE</th><th>PTIN</th></tr></thead>
            <tbody>
              {roles.length === 0 ? <tr><td colSpan={3} className="monarch-empty">No team members yet.</td></tr> : roles.slice(0, 4).map((r) => {
                const ptin = s.credentials.find((c) => c.person_id === r.person_id && c.kind === "ptin" && !c.archived_at);
                return <tr key={r.id}><td><b>{s.people.find((p) => p.id === r.person_id)?.full_name ?? "—"}</b></td><td>{roleLabel(r.role)}</td><td>{ptin ? `P••••${ptin.identifier_last4}` : <span className="monarch-muted">None</span>}</td></tr>;
              })}
            </tbody>
          </table></div>
          <Link className="efin-add" href={`${base}?tab=team#add-member`}><Icon name="plus" size={16} /> Add team member</Link>
        </section>
      )}

      <section className={"efin-card" + (team ? "" : " efin-span")}>
        <CardHead icon="history" title="Recent activity" href={`${base}?tab=history`} action="View all" />
        <ol className="efin-timeline">
          {activity.length === 0 ? <li className="monarch-muted">Nothing recorded yet.</li> : activity.slice(0, 3).map((h) => (
            <li key={h.id}><time>{when(h.occurred_at)}</time><div><b>{label(h.event_type.replace(/\./g, " "))}</b>{h.reason && <small>{h.reason}</small>}</div></li>
          ))}
        </ol>
      </section>
    </div>
  );
}
