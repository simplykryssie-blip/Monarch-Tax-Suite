import { Badge, when } from "@/components/admin/ui";
import { daysUntil, todayIso } from "@/lib/efin/rules.ts";
import type { Snapshot } from "@/lib/efin/service";
import type { EfinRow, OrgRow } from "@/lib/efin/types";
import { Verified } from "./parts";
import { RevealEfin } from "./reveal";

export const REL_LABEL: Record<string, string> = { internal: "My own office", partner: "Partner", client: "Software / service client", other: "Other" };
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

/** The top of an ERO's page, laid out like a contact card: who they are, how to reach them, and their EFIN at a glance. */
export function ContactHeader({ s, org, efin }: { s: Snapshot; org: OrgRow; efin?: EfinRow }) {
  const person = s.people.find((p) => p.id === (efin?.ero_person_id ?? org.administrator_person_id));
  const a = org.primary_address ?? {};
  const address = [a.line1, [a.city, a.state].filter(Boolean).join(", "), a.zip].filter(Boolean).join(" · ");
  const locations = s.locations.filter((l) => l.organization_id === org.id && !l.archived_at);
  const today = todayIso();
  const left = efin?.recorded_expiration ? daysUntil(efin.recorded_expiration, today) : null;
  return (
    <header className="efin-contact">
      <div className="efin-monogram" aria-hidden="true">{initials(org.legal_name)}</div>
      <div className="efin-contact-body">
        <div className="monarch-eyebrow">ERO · {REL_LABEL[org.relationship] ?? org.relationship}{org.archived_at ? " · Archived" : ""}</div>
        <h1>{org.legal_name}</h1>
        {org.dba_name && <div className="efin-contact-sub">doing business as {org.dba_name}</div>}
        <ul className="efin-contact-lines">
          {person && <li><span>Contact</span>{person.full_name}</li>}
          {person?.email && <li><span>Email</span><a href={`mailto:${person.email}`}>{person.email}</a></li>}
          {person?.phone && <li><span>Phone</span><a href={`tel:${person.phone}`}>{person.phone}</a></li>}
          {address && <li><span>Address</span>{address}</li>}
          {locations.length > 1 && <li><span>Locations</span>{locations.map((l) => l.name).join(" · ")}</li>}
        </ul>
        {efin && (
          <div className="efin-glance">
            <div><span>EFIN</span><RevealEfin id={efin.id} last4={efin.efin_last4} /></div>
            <div><span>Status</span><Badge value={efin.internal_status === "pending_verification" ? "pending" : efin.internal_status} /></div>
            <div><span>Verification</span><Verified value={efin.external_status} /></div>
            <div><span>Renewal</span>{efin.recorded_expiration ? <>{efin.recorded_expiration}{left !== null && <small className="monarch-muted"> · {left < 0 ? `${-left} days past` : `${left} days`}</small>}</> : <span className="monarch-muted">Not recorded</span>}</div>
            {efin.external_verified_at && <div><span>Verified on</span>{when(efin.external_verified_at)}</div>}
          </div>
        )}
      </div>
    </header>
  );
}
