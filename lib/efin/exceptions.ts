import { daysUntil, renewalTracking } from "./rules.ts";
import type { AssignmentRow, CredentialRow, EfinRow, FilingRow, OrgRow, PersonRow } from "./types.ts";

// Compliance exceptions: things a reviewer should look at. Each is derived from recorded data only; nothing here
// claims an IRS status. "Unverified" means no one has recorded a verification, not that the IRS rejected anything.

export type ExceptionKind = "missing_expiration" | "unverified_expiration" | "efin_unverified" | "no_ero" | "filing_unverified" | "credential_expired" | "credential_unverified" | "past_deadline" | "stale_review";
export type ComplianceException = { kind: ExceptionKind; severity: "high" | "medium" | "low"; subjectType: "efin" | "credential" | "filing" | "assignment"; subjectId: string; organizationId: string | null; title: string; detail: string; href: string };

type Input = { efins: EfinRow[]; assignments: AssignmentRow[]; filings: FilingRow[]; credentials: CredentialRow[]; people: PersonRow[]; orgs: OrgRow[]; today: string };

export const EXCEPTION_LABEL: Record<ExceptionKind, string> = {
  missing_expiration: "No renewal date recorded",
  unverified_expiration: "Renewal date not verified",
  efin_unverified: "EFIN not verified",
  no_ero: "No Responsible Official / ERO assigned",
  filing_unverified: "Software authorization not verified",
  credential_expired: "Credential past its recorded date",
  credential_unverified: "Credential not verified",
  past_deadline: "Past recorded renewal deadline",
  stale_review: "Assignment waiting over 7 days",
};

export function complianceExceptions(d: Input): ComplianceException[] {
  const out: ComplianceException[] = [];
  const orgName = (id: string) => d.orgs.find((o) => o.id === id)?.legal_name ?? "Unknown organization";
  const live = d.efins.filter((e) => !e.archived_at);
  for (const e of live) {
    const name = `EFIN ending ${e.efin_last4}`;
    const base = { subjectType: "efin" as const, subjectId: e.id, organizationId: e.organization_id, href: `/efin/${e.id}` };
    const t = renewalTracking(e);
    if (!t.track && t.reason === "missing_date") out.push({ ...base, kind: "missing_expiration", severity: "medium", title: name, detail: `${orgName(e.organization_id)}: record the renewal date once you have verified it.` });
    if (!t.track && t.reason === "unverified_date") out.push({ ...base, kind: "unverified_expiration", severity: "medium", title: name, detail: `${orgName(e.organization_id)}: a date is recorded but not marked verified, so no reminders run.` });
    if (t.track && e.recorded_expiration && daysUntil(e.recorded_expiration, d.today) < 0) out.push({ ...base, kind: "past_deadline", severity: "high", title: name, detail: `${orgName(e.organization_id)}: the recorded deadline ${e.recorded_expiration} has passed. Confirm its status; Monarch has not changed it.` });
    if (e.external_status === "unverified" && e.internal_status !== "draft") out.push({ ...base, kind: "efin_unverified", severity: "low", title: name, detail: `${orgName(e.organization_id)}: no one has recorded a verification of this EFIN with the IRS yet.` });
    const isClient = d.orgs.find((o) => o.id === e.organization_id)?.relationship === "client";
    const hasEro = isClient || Boolean(e.ero_person_id) || d.assignments.some((a) => a.efin_id === e.id && ["ero", "responsible_official"].includes(a.role) && ["approved", "active"].includes(a.state));
    if (e.internal_status === "active" && !hasEro) out.push({ ...base, kind: "no_ero", severity: "high", title: name, detail: `${orgName(e.organization_id)}: an active EFIN needs a recorded ERO or Responsible Official.` });
  }
  const liveEfin = new Set(live.map((e) => e.id));
  for (const f of d.filings) {
    if (f.archived_at || !liveEfin.has(f.efin_id)) continue;
    if (f.external_auth_status === "unverified") out.push({ kind: "filing_unverified", severity: "low", subjectType: "filing", subjectId: f.id, organizationId: f.organization_id, title: `${f.software_provider} authorization`, detail: `${orgName(f.organization_id)}: shown as unverified until someone records how it was confirmed.`, href: `/efin/${f.efin_id}?tab=filing` });
  }
  for (const c of d.credentials) {
    if (c.archived_at) continue;
    const who = d.people.find((p) => p.id === c.person_id)?.full_name ?? "Unknown person";
    if (c.expires_on && c.expires_on < d.today) out.push({ kind: "credential_expired", severity: "medium", subjectType: "credential", subjectId: c.id, organizationId: null, title: `${c.kind.toUpperCase()} for ${who}`, detail: `Recorded date ${c.expires_on} has passed.`, href: "/efin" });
    else if (c.verification_status === "unverified") out.push({ kind: "credential_unverified", severity: "low", subjectType: "credential", subjectId: c.id, organizationId: null, title: `${c.kind.toUpperCase()} for ${who}`, detail: "Recorded but not verified.", href: "/efin" });
  }
  for (const a of d.assignments) {
    if (a.state === "pending_review" && daysUntil(a.requested_at.slice(0, 10), d.today) < -7) out.push({ kind: "stale_review", severity: "medium", subjectType: "assignment", subjectId: a.id, organizationId: a.organization_id, title: `${a.role.replace(/_/g, " ")} assignment`, detail: `Requested ${a.requested_at.slice(0, 10)} and still waiting for review.`, href: `/efin/${a.efin_id}?tab=assignments` });
  }
  const rank = { high: 0, medium: 1, low: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
