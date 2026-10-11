import Link from "next/link";
import { Badge, label, when } from "@/components/admin/ui";
import { Icon, type IconName } from "@/components/admin/icons";
import { daysUntil, roleLabel, tracksTeam } from "@/lib/efin/rules.ts";
import type { Snapshot } from "@/lib/efin/service";
import type { Step } from "@/lib/efin/steps.ts";
import type { AuditRow, EfinRow, OrgRow } from "@/lib/efin/types";
import { words } from "@/lib/efin/text.ts";
import { Verified } from "./parts";
import { RevealEfin } from "./reveal";

export const REL_LABEL: Record<string, string> = { internal: "My tax office", partner: "Partner office", client: "Software / service client", other: "Other" };
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const addressLine = (a: Record<string, string> | null | undefined) => [a?.line1, [a?.city, a?.state].filter(Boolean).join(", "), a?.zip].filter(Boolean).join(" · ");
const statusValue = (e: EfinRow) => (e.internal_status === "pending_verification" ? "pending" : e.internal_status);

function CardHead({ icon, title, sub, href, action }: { icon: IconName; title: string; sub?: string; href?: string; action?: string }) {
  return (
    <div className="efin-card-head">
      <span className="efin-card-ico"><Icon name={icon} size={22} /></span>
      <div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>
      {href && <Link className="efin-card-link" href={href}>{action ?? "Edit"}</Link>}
    </div>
  );
}

/** Breadcrumb, firm header with contact lines, the EFIN at a glance, and a "Next steps" checklist. */
export function FirmHeader({ s, org, efin, steps, base }: { s: Snapshot; org: OrgRow; efin?: EfinRow; steps: Step[]; base: string }) {
  const person = s.people.find((p) => p.id === (efin?.ero_person_id ?? org.administrator_person_id));
  const address = addressLine(org.primary_address);
  const todo = steps.filter((x) => !x.done);
  const left = efin?.recorded_expiration ? daysUntil(efin.recorded_expiration, new Date().toISOString().slice(0, 10)) : null;
  return (
    <>
      <nav className="efin-crumbs" aria-label="Breadcrumb">
        <Link href="/efin" aria-label="EFIN Management"><Icon name="home" size={16} /></Link>
        <Link href="/efin">EFIN Management</Link><span>›</span>
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
            {person?.phone && <a href={`tel:${person.phone}`}>{person.phone}</a>}
          </p>
          {address && <p className="efin-firm-line"><span>{address}</span></p>}
        </div>
        <div className="efin-firm-actions">
          {!org.archived_at && <Link className="monarch-secondary efin-gold" href={`${base}?tab=overview&edit=firm#manage`}><Icon name="pencil" size={16} /> Edit firm</Link>}
          <details className="efin-more">
            <summary aria-label="More actions"><Icon name="dots" size={18} /></summary>
            <div className="efin-more-menu">
              {!org.archived_at && <Link href={`${base}?tab=overview&edit=efin#manage`}>Add another EFIN</Link>}
              <Link href={`${base}?tab=overview&edit=more#manage`}>Archive or delete</Link>
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
              <div><span>Renewal</span>{efin.recorded_expiration ? <>{efin.recorded_expiration}{left !== null && <small className="monarch-muted"> · {left < 0 ? `${-left} days past` : `${left} days`}</small>}</> : <span className="monarch-muted">Not recorded</span>}</div>
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

const when4 = (iso: string) => when(iso);
const detailOf = (h: AuditRow) =>
  Object.entries(h.changes ?? {}).filter(([, v]) => v !== undefined && v !== null && typeof v !== "object").slice(0, 2).map(([k, v]) => `${words(k)}: ${words(String(v))}`).join(" · ");

/** The overview tab's cards: firm, EFIN & ERO information, team (or locations), recent activity, and three shortcuts. */
export function OverviewCards({ s, org, efin, base, activity }: { s: Snapshot; org: OrgRow; efin?: EfinRow; base: string; activity: AuditRow[] }) {
  const person = s.people.find((p) => p.id === (efin?.ero_person_id ?? org.administrator_person_id));
  const team = tracksTeam(org.relationship);
  const roles = s.roles.filter((r) => r.organization_id === org.id && r.status === "active");
  const names = (role: string) => roles.filter((r) => r.role === role).map((r) => s.people.find((p) => p.id === r.person_id)?.full_name).filter(Boolean) as string[];
  const locations = s.locations.filter((l) => l.organization_id === org.id && !l.archived_at);
  const filings = efin ? s.filings.filter((f) => f.efin_id === efin.id && !f.archived_at) : [];
  const edit = (what: string) => `${base}?tab=overview&edit=${what}#manage`;
  const none = <span className="monarch-muted">Not recorded</span>;
  return (
    <>
      <div className="efin-grid">
        <section className="efin-card">
          <CardHead icon="firms" title="Firm overview" href={edit("firm")} />
          <dl className="efin-kv">
            <div><dt>Firm name</dt><dd>{org.legal_name}</dd></div>
            <div><dt>Primary contact</dt><dd>{person?.full_name ?? none}</dd></div>
            <div><dt>Email</dt><dd>{person?.email ?? none}</dd></div>
            <div><dt>Phone</dt><dd>{person?.phone ?? none}</dd></div>
            <div><dt>Address</dt><dd>{addressLine(org.primary_address) || none}</dd></div>
            <div><dt>Relationship</dt><dd>{REL_LABEL[org.relationship] ?? org.relationship}</dd></div>
            <div><dt>Agreement</dt><dd>{label(org.agreement_status)}</dd></div>
          </dl>
        </section>

        <section className="efin-card">
          <CardHead icon="shield" title="EFIN & ERO information" href={efin ? edit("efin") : undefined} />
          <div className="efin-two">
            <dl className="efin-kv">
              <div><dt>EFIN</dt><dd className="efin-mask">{efin ? `••${efin.efin_last4}` : none}</dd></div>
              <div><dt>Status</dt><dd>{efin ? <Badge value={statusValue(efin)} /> : none}</dd></div>
              <div><dt>Verification</dt><dd>{efin ? <Verified value={efin.external_status} /> : none}</dd></div>
              <div><dt>Renewal date</dt><dd>{efin?.recorded_expiration ?? none}</dd></div>
              {efin?.verification_source && <div><dt>Source</dt><dd>{efin.verification_source}</dd></div>}
              {efin && <div><dt>Filing office</dt><dd>{s.locations.find((l) => l.id === efin.location_id)?.name ?? none}</dd></div>}
              {efin?.tax_year && <div><dt>Tax year</dt><dd>{efin.tax_year}</dd></div>}
            </dl>
            <dl className="efin-kv">
              <div><dt>ERO</dt><dd>{(names("ero")[0] ?? person?.full_name) || none}</dd></div>
              <div><dt>Responsible Official</dt><dd>{names("responsible_official").join(", ") || none}</dd></div>
              <div><dt>Principal(s)</dt><dd>{names("principal").join(", ") || none}</dd></div>
              <div><dt>Business locations</dt><dd>{locations.length} location{locations.length === 1 ? "" : "s"}<br /><Link className="efin-card-link" href={`${base}?tab=team`}>View locations →</Link></dd></div>
            </dl>
          </div>
        </section>

        {team ? (
          <section className="efin-card">
            <CardHead icon="customers" title="Team" sub="People associated with this firm. PTINs are individual credentials." href={`${base}?tab=team`} action="Manage" />
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>NAME</th><th>ROLE</th><th>PTIN</th><th>STATUS</th></tr></thead>
              <tbody>
                {roles.length === 0 ? <tr><td colSpan={4} className="monarch-empty">No team members recorded yet.</td></tr> : roles.slice(0, 5).map((r) => {
                  const ptin = s.credentials.find((c) => c.person_id === r.person_id && c.kind === "ptin" && !c.archived_at);
                  return <tr key={r.id}><td><b>{s.people.find((p) => p.id === r.person_id)?.full_name ?? "—"}</b></td><td>{roleLabel(r.role)}</td><td>{ptin ? `P••••${ptin.identifier_last4}` : <span className="monarch-muted">None</span>}</td><td><Verified value={ptin?.verification_status ?? r.verification_status} /></td></tr>;
                })}
              </tbody>
            </table></div>
            <Link className="efin-add" href={`${base}?tab=team#add-member`}><Icon name="plus" size={16} /> Add team member</Link>
          </section>
        ) : (
          <section className="efin-card">
            <CardHead icon="office" title="Locations" sub="Software and service clients keep no team or PTIN records." href={`${base}?tab=team`} action="Manage" />
            <ul className="efin-eflist" style={{ padding: "0 22px 18px" }}>{locations.length === 0 ? <li className="monarch-muted">No locations recorded.</li> : locations.map((l) => <li key={l.id}><b>{l.name}</b>{l.is_primary && <span className="efin-tag">Primary</span>}<span className="monarch-muted">{addressLine(l.address)}</span></li>)}</ul>
          </section>
        )}

        <section className="efin-card">
          <CardHead icon="history" title="Recent activity" href={`${base}?tab=history`} action="View all" />
          <ol className="efin-timeline">
            {activity.length === 0 ? <li className="monarch-muted">Nothing recorded yet.</li> : activity.slice(0, 4).map((h) => (
              <li key={h.id}><time>{when4(h.occurred_at)}</time><div><b>{label(h.event_type.replace(/\./g, " "))}</b>{detailOf(h) && <small>{detailOf(h)}</small>}{h.reason && <small>{h.reason}</small>}</div></li>
            ))}
          </ol>
        </section>
      </div>

      <div className="efin-grid efin-grid-3">
        <section className="efin-card efin-mini">
          <CardHead icon="document" title="Documents" sub="Supporting files for this EFIN and firm." />
          <p className="efin-mini-note">Upload is not available yet. Record where each document is kept in the verification source.</p>
          <Link className="monarch-secondary efin-small" href={`${base}?tab=documents`}>Open documents</Link>
        </section>
        <section className="efin-card efin-mini">
          <CardHead icon="calendar" title="Renewals" sub={efin?.recorded_expiration ? `Recorded renewal date ${efin.recorded_expiration}.` : "No renewal date recorded."} />
          {efin ? <Link className="monarch-secondary efin-small" href={edit("efin")}>Set renewal date</Link> : null}
        </section>
        <section className="efin-card efin-mini">
          <CardHead icon="nodes" title="Filing relationships" sub={filings.length ? `${filings.length} software provider${filings.length === 1 ? "" : "s"} recorded.` : "No software providers recorded for this EFIN."} />
          {efin ? <Link className="monarch-secondary efin-small" href={`${base}?tab=filing`}>{filings.length ? "View providers" : "Add provider"}</Link> : null}
        </section>
      </div>
    </>
  );
}
