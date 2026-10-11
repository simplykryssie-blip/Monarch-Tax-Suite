import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CrmSecrets } from "../crm/crypto.ts";
import { unwrap } from "../commerce/supabase-repo.ts";
import { serviceClient } from "../admin";
import { assignmentProblems, EfinRuleError, forField, last4, tracksTeam, normalizeEfin, normalizeEin, normalizePtin, parseDay, planTransition, todayIso } from "./rules.ts";
import type { AssignmentRole, AssignmentRow, AssignmentState, AuditRow, CredentialRow, EfinRow, FilingRow, LocationRow, OrgRow, PersonRow, RenewalTaskRow, RoleRow, Verification } from "./types.ts";
import { ASSIGNMENT_ROLES, EFIN_STATUSES, VERIFICATION } from "./types.ts";
import { words } from "./text.ts";
import { formatAddress, formatPhone, type Address } from "./format.ts";

// Server-side EFIN data access. Every function here runs with the service role, so callers (server actions and pages) must
// call requireAdmin() first. Sensitive identifiers (EFIN, EIN, PTIN) are encrypted with AAD naming the row and field, a
// last-4 is kept for display, and a keyed hash backs duplicate detection. None of them is ever written to the audit log.

export type Actor = { id: string; email: string };
const db = (): SupabaseClient => serviceClient();

function secrets(): CrmSecrets {
  const s = CrmSecrets.fromBase64(process.env.MONARCH_ENCRYPTION_KEY);
  if (!s) throw new EfinRuleError("Encryption is not configured (MONARCH_ENCRYPTION_KEY), so sensitive identifiers cannot be stored.");
  return s;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuid = (v: unknown, what = "item") => {
  const s = String(v ?? "");
  if (!UUID.test(s)) throw new EfinRuleError(`That ${what} could not be found.`);
  return s;
};
const text = (v: unknown, max: number, label: string, required = false) => {
  const s = String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim();
  if (required && !s) throw new EfinRuleError(`${label} is required.`);
  if (s.length > max) throw new EfinRuleError(`${label} is too long (${max} characters at most).`);
  return s || null;
};
/** Address, phone and email in the one canonical format (see format.ts). Field names are tagged so a form can mark the right box. */
const addr = (form: FormData, pfx = "", sfx = ""): Address =>
  formatAddress(
    { line1: text(form.get(`${pfx}line1${sfx}`), 200, "Address") ?? "", city: text(form.get(`${pfx}city${sfx}`), 100, "City") ?? "", state: text(form.get(`${pfx}state${sfx}`), 40, "State") ?? "", zip: text(form.get(`${pfx}zip${sfx}`), 12, "ZIP") ?? "" },
    { state: `${pfx}state${sfx}`, zip: `${pfx}zip${sfx}` },
  );
const phoneOf = (v: FormDataEntryValue | null, field: string) => {
  const s = String(v ?? "").trim();
  return s ? formatPhone(s, field) : null;
};
const lower = (v: string | null) => (v ? v.toLowerCase() : v);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], label: string): T => {
  const s = String(v ?? "");
  if (!(allowed as readonly string[]).includes(s)) throw new EfinRuleError(`${label} is not valid.`);
  return s as T;
};
const day = (v: unknown, label: string) => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  try { parseDay(s); } catch { throw new EfinRuleError(`${label} must be a real date.`); }
  return s;
};

export class EfinNotFound extends EfinRuleError {}

export const RELATIONSHIPS = ["internal", "partner", "client", "other"] as const;
const NO_TEAM = "Team members and PTINs are not tracked for software or service clients. Change the relationship first if this business is a partner or your own office.";

const dbError = (e: { code?: string; message: string }) => {
  if (/TEAM_NOT_TRACKED/.test(e.message)) return new EfinRuleError(NO_TEAM);
  if (/HAS_HISTORY/.test(e.message)) return new EfinRuleError("This EFIN has been used in an assignment that went live, so it cannot be permanently deleted. Archive it instead; its history is kept.");
  if (/ASSIGNED_ELSEWHERE/.test(e.message)) return new EfinRuleError("This business is assigned to EFINs owned by someone else. Remove those assignments first, or archive it.");
  if (/NOT_FOUND/.test(e.message)) return new EfinNotFound("That record could not be found. It may already be deleted.");
  return new Error(e.message);
};

// ------------------------------------------------------------------------------------------------- audit
type AuditInput = { type: string; targetType: string; targetId: string; organizationId?: string | null; changes?: Record<string, unknown>; reason?: string | null };

/** Append-only. A failure to record an audit event fails the action that needed it. */
export async function audit(actor: Actor, e: AuditInput, client: SupabaseClient = db()) {
  const { error } = await client.from("audit_events").insert({
    actor_id: actor.id,
    actor_email: actor.email || null,
    event_type: e.type,
    target_type: e.targetType,
    target_id: e.targetId,
    organization_id: e.organizationId ?? null,
    changes: e.changes ?? {},
    reason: e.reason ?? null,
  });
  if (error) throw new Error(`Audit log write failed: ${error.message}`);
}

// ------------------------------------------------------------------------------------------------- reads
const EFIN_COLS = "id, efin_last4, organization_id, location_id, ero_person_id, internal_status, external_status, external_verified_at, verification_source, recorded_expiration, expiration_verified, tax_year, notes, archived_at, archived_reason, created_at, updated_at";
const ORG_COLS = "id, parent_id, kind, legal_name, dba_name, business_structure, ein_last4, primary_address, relationship, agreement_status, onboarding_status, administrator_person_id, status, notes, archived_at, created_at";
const CRED_COLS = "id, person_id, kind, identifier_last4, verification_status, verification_source, verified_at, expires_on, archived_at";

export type Snapshot = {
  efins: EfinRow[];
  orgs: OrgRow[];
  locations: LocationRow[];
  people: PersonRow[];
  credentials: CredentialRow[];
  roles: RoleRow[];
  assignments: AssignmentRow[];
  filings: FilingRow[];
  tasks: RenewalTaskRow[];
};

/** Everything the module screens need. The data set is small (one service bureau), so one snapshot keeps pages consistent. */
export async function loadSnapshot(): Promise<Snapshot> {
  const c = db();
  const [efins, orgs, locations, people, credentials, roles, assignments, filings, tasks] = await Promise.all([
    c.from("efin_records").select(EFIN_COLS).order("created_at", { ascending: false }),
    c.from("organizations").select(ORG_COLS).order("legal_name"),
    c.from("office_locations").select("id, organization_id, name, address, is_primary, status, archived_at").order("name"),
    c.from("people").select("id, full_name, email, phone, user_id, status, notes, archived_at, created_at").order("full_name"),
    c.from("professional_credentials").select(CRED_COLS),
    c.from("organization_roles").select("id, organization_id, person_id, role, location_id, status, start_date, end_date, verification_status, verification_note"),
    c.from("efin_assignments").select("*").order("requested_at", { ascending: false }),
    c.from("filing_relationships").select("id, efin_id, organization_id, software_provider, software_product, tax_year, external_auth_status, verification_source, last_verified_at, remediation_note, archived_at"),
    c.from("renewal_tasks").select("*").order("due_on"),
  ]);
  return {
    efins: unwrap(efins as never) as EfinRow[],
    orgs: unwrap(orgs as never) as OrgRow[],
    locations: unwrap(locations as never) as LocationRow[],
    people: unwrap(people as never) as PersonRow[],
    credentials: unwrap(credentials as never) as CredentialRow[],
    roles: unwrap(roles as never) as RoleRow[],
    assignments: unwrap(assignments as never) as AssignmentRow[],
    filings: unwrap(filings as never) as FilingRow[],
    tasks: unwrap(tasks as never) as RenewalTaskRow[],
  };
}

export async function loadAudit(opts: { targetId?: string; limit?: number } = {}): Promise<AuditRow[]> {
  let q = db().from("audit_events").select("id, occurred_at, actor_id, actor_email, event_type, target_type, target_id, organization_id, changes, reason").order("occurred_at", { ascending: false }).limit(opts.limit ?? 100);
  if (opts.targetId) q = q.eq("target_id", opts.targetId);
  return unwrap(await q as never) as AuditRow[];
}

/** Audit history for an EFIN profile: the EFIN itself plus its assignments and filing relationships. */
export async function loadEfinAudit(snap: Snapshot, efinId: string): Promise<AuditRow[]> {
  const ids = [efinId, ...snap.assignments.filter((a) => a.efin_id === efinId).map((a) => a.id), ...snap.filings.filter((f) => f.efin_id === efinId).map((f) => f.id)];
  return unwrap(await db().from("audit_events").select("id, occurred_at, actor_id, actor_email, event_type, target_type, target_id, organization_id, changes, reason").in("target_id", ids).order("occurred_at", { ascending: false }).limit(200) as never) as AuditRow[];
}

// -------------------------------------------------------------------------------------------- organizations
export async function saveLocation(actor: Actor, form: FormData) {
  const organizationId = uuid(form.get("organization_id"), "organization");
  const isPrimary = form.get("is_primary") === "on";
  const client = db();
  if (isPrimary) await client.from("office_locations").update({ is_primary: false }).eq("organization_id", organizationId).eq("is_primary", true);
  const row = unwrap(await client.from("office_locations").insert({
    organization_id: organizationId,
    name: text(form.get("name"), 200, "Office name", true),
    address: addr(form),
    is_primary: isPrimary,
  }).select("id, name").single() as never) as { id: string; name: string };
  await audit(actor, { type: "location.created", targetType: "location", targetId: row.id, organizationId, changes: { name: row.name, is_primary: isPrimary } });
}

// ------------------------------------------------------------------------------------------ people / credentials
// ---------------------------------------------------------------------------------------- one-step ERO onboarding
const addressFrom = (form: FormData) => addr(form);
const dupMessage = (e: { code?: string; message: string }) => {
  if (e.code === "23505") return new EfinRuleError(/efin/i.test(e.message) ? "That EFIN is already recorded. Open the existing ERO instead." : /credential|ptin/i.test(e.message) ? "That PTIN is already recorded for someone." : "Something with those details is already recorded.");
  return new Error(e.message);
};

/** Creates an ERO end to end (organization, office, person + ERO role, optional PTIN, EFIN, draft assignment) in one transaction. */
export async function onboardEro(actor: Actor, form: FormData): Promise<string> {
  const s = secrets();
  const relationship = forField("relationship", () => oneOf(form.get("relationship") || "partner", RELATIONSHIPS, "Relationship"));
  const efin = forField("efin", () => normalizeEfin(String(form.get("efin") ?? "")));
  const ptinRaw = String(form.get("ptin") ?? "").trim();
  const einRaw = String(form.get("ein") ?? "").trim();
  // Clients that only bought software never get PTIN or team records, even if those fields were filled in and then hidden.
  const ptin = ptinRaw && tracksTeam(relationship) ? forField("ptin", () => normalizePtin(ptinRaw)) : null;
  const ein = einRaw ? forField("ein", () => normalizeEin(einRaw)) : null;
  const ids = { org: randomUUID(), loc: randomUUID(), person: randomUUID(), efin: randomUUID(), cred: ptin ? randomUUID() : null };
  const efinVerification = oneOf(form.get("efin_verification") || "unverified", VERIFICATION, "EFIN verification");
  const expiration = forField("recorded_expiration", () => day(form.get("recorded_expiration"), "Expiration date"));
  const email = forField("person_email", () => lower(text(form.get("person_email"), 254, "Email")));
  if (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new EfinRuleError("That email address does not look right.", "person_email");
  const payload = {
    actor_id: actor.id, actor_email: actor.email,
    org_id: ids.org, loc_id: ids.loc, person_id: ids.person, efin_id: ids.efin, cred_id: ids.cred,
    legal_name: forField("legal_name", () => text(form.get("legal_name"), 200, "Legal name", true)), dba_name: text(form.get("dba_name"), 200, "Doing business as"),
    business_structure: form.get("business_structure") ? oneOf(form.get("business_structure"), ["llc", "corporation", "s_corporation", "partnership", "sole_proprietorship", "nonprofit", "other"] as const, "Business structure") : null,
    ein_encrypted: ein ? s.encrypt(ein, `org:${ids.org}:ein`) : null, ein_last4: ein ? last4(ein) : null,
    address: addressFrom(form),
    relationship,
    agreement_status: oneOf(form.get("agreement_status") || "pending", ["pending", "active", "suspended", "ended"] as const, "Agreement status"),
    org_notes: text(form.get("notes"), 4000, "Notes"),
    office_name: text(form.get("office_name") || "Main office", 200, "Office name", true),
    person_name: forField("person_name", () => text(form.get("person_name"), 200, "ERO name", true)), person_email: email, person_phone: phoneOf(form.get("person_phone"), "person_phone"),
    role_verification: oneOf(form.get("role_verification") || "unverified", VERIFICATION, "Role verification"),
    ptin_encrypted: ptin ? s.encrypt(ptin, `credential:${ids.cred}:identifier`) : null, ptin_last4: ptin ? last4(ptin) : null, ptin_hash: ptin ? s.hashIdentifier("ptin", ptin) : null,
    ptin_verification: oneOf(form.get("ptin_verification") || "unverified", VERIFICATION, "PTIN verification"), ptin_source: text(form.get("ptin_source"), 300, "PTIN source"), ptin_expires_on: day(form.get("ptin_expires_on"), "PTIN date"),
    efin_encrypted: s.encrypt(efin, `efin:${ids.efin}:efin`), efin_last4: last4(efin), efin_hash: s.hashIdentifier("efin", efin),
    efin_verification: efinVerification, efin_source: text(form.get("efin_source"), 300, "EFIN source"),
    recorded_expiration: expiration, expiration_verified: Boolean(expiration) && form.get("expiration_verified") === "on",
    tax_year: form.get("tax_year") ? Number(form.get("tax_year")) : null, efin_notes: null,
    // Additional locations for an ERO with several offices (up to five extra, blanks ignored).
    extra_offices: [0, 1, 2, 3, 4].map((i) => ({ name: text(form.get(`extra_name_${i}`), 200, "Location name"), address: addr(form, "extra_", `_${i}`) })).filter((o) => o.name),
  };
  const { error } = await db().rpc("efin_onboard", { p: payload });
  if (error) { const m = dupMessage(error); if (m instanceof EfinRuleError && !m.field) m.field = /efin/i.test(error.message) ? "efin" : /ptin|credential/i.test(error.message) ? "ptin" : undefined; throw m; }
  return ids.efin;
}

/** Adds a team member (person + role, optional PTIN) to an existing organization in one transaction. */
export async function addMember(actor: Actor, form: FormData) {
  const s = secrets();
  const orgRow = unwrap(await db().from("organizations").select("relationship").eq("id", uuid(form.get("organization_id"), "organization")).maybeSingle() as never) as { relationship: string } | null;
  if (!orgRow) throw new EfinNotFound("That business could not be found.");
  if (!tracksTeam(orgRow.relationship)) throw new EfinRuleError(NO_TEAM);
  const ptinRaw = String(form.get("ptin") ?? "").trim();
  const ptin = ptinRaw ? normalizePtin(ptinRaw) : null;
  const credId = ptin ? randomUUID() : null;
  const email = lower(text(form.get("person_email"), 254, "Email"));
  if (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new EfinRuleError("That email address does not look right.");
  const payload = {
    actor_id: actor.id, actor_email: actor.email, org_id: uuid(form.get("organization_id"), "organization"), person_id: randomUUID(), cred_id: credId,
    person_name: text(form.get("person_name"), 200, "Name", true), person_email: email, person_phone: phoneOf(form.get("person_phone"), "person_phone"),
    role: oneOf(form.get("role"), ASSIGNMENT_ROLES, "Role"), loc_id: form.get("location_id") ? uuid(form.get("location_id"), "office") : null,
    role_verification: oneOf(form.get("role_verification") || "unverified", VERIFICATION, "Verification"),
    ptin_encrypted: ptin ? s.encrypt(ptin, `credential:${credId}:identifier`) : null, ptin_last4: ptin ? last4(ptin) : null, ptin_hash: ptin ? s.hashIdentifier("ptin", ptin) : null,
    ptin_verification: oneOf(form.get("ptin_verification") || "unverified", VERIFICATION, "PTIN verification"), ptin_source: text(form.get("ptin_source"), 300, "PTIN source"), ptin_expires_on: day(form.get("ptin_expires_on"), "PTIN date"),
  };
  const { error } = await db().rpc("efin_add_member", { p: payload });
  if (error) throw /TEAM_NOT_TRACKED/.test(error.message) ? new EfinRuleError(NO_TEAM) : dupMessage(error);
}

// ------------------------------------------------------------------------------------------------------ EFINs
export async function createEfin(actor: Actor, form: FormData): Promise<string> {
  const efin = forField("efin", () => normalizeEfin(String(form.get("efin") ?? "")));
  const s = secrets();
  const id = randomUUID();
  const organizationId = uuid(form.get("organization_id"), "organization");
  const external = oneOf(form.get("external_status") || "unverified", VERIFICATION, "Verification");
  const expiration = forField("recorded_expiration", () => day(form.get("recorded_expiration"), "Expiration date"));
  const { error } = await db().from("efin_records").insert({
    id, efin_encrypted: s.encrypt(efin, `efin:${id}:efin`), efin_last4: last4(efin), efin_hash: s.hashIdentifier("efin", efin),
    organization_id: organizationId,
    location_id: form.get("location_id") ? uuid(form.get("location_id"), "office") : null,
    ero_person_id: form.get("ero_person_id") ? uuid(form.get("ero_person_id"), "person") : null,
    internal_status: "pending_verification",
    external_status: external,
    external_verified_at: external === "unverified" ? null : new Date().toISOString(),
    verification_source: text(form.get("verification_source"), 300, "Verification source"),
    recorded_expiration: expiration,
    expiration_verified: Boolean(expiration) && form.get("expiration_verified") === "on",
    tax_year: form.get("tax_year") ? Number(form.get("tax_year")) : null,
    notes: text(form.get("notes"), 4000, "Notes"),
    created_by: actor.id, updated_by: actor.id,
  });
  if (error) throw error.code === "23505" ? new EfinRuleError("That EFIN is already recorded. Open the existing record instead.", "efin") : new Error(error.message);
  await audit(actor, { type: "efin.created", targetType: "efin", targetId: id, organizationId, changes: { last4: last4(efin), external_status: external, recorded_expiration: expiration } });
  return id;
}

export async function updateEfin(actor: Actor, form: FormData) {
  const id = uuid(form.get("id"), "EFIN");
  const client = db();
  const before = unwrap(await client.from("efin_records").select(EFIN_COLS).eq("id", id).maybeSingle() as never) as EfinRow | null;
  if (!before) throw new EfinNotFound("That EFIN could not be found.");
  const external = oneOf(form.get("external_status") || before.external_status, VERIFICATION, "Verification");
  const status = oneOf(form.get("internal_status") || before.internal_status, EFIN_STATUSES, "Status");
  const expiration = day(form.get("recorded_expiration"), "Expiration date");
  if (status !== before.internal_status && ["suspended", "inactive"].includes(status) && form.get("confirm") !== "on") throw new EfinRuleError("Changing an EFIN to suspended or inactive is high-impact. Tick the confirmation box.");
  if (status !== before.internal_status && !String(form.get("reason") ?? "").trim()) throw new EfinRuleError("Add a reason for the status change.", "reason");
  // Correcting a mistyped EFIN: leave the box empty to keep the current number.
  const newEfinRaw = String(form.get("efin") ?? "").trim();
  const correction: Record<string, string> = {};
  let correctedLast4: string | null = null;
  if (newEfinRaw) {
    const n = forField("efin", () => normalizeEfin(newEfinRaw));
    const sec = secrets();
    correction.efin_encrypted = sec.encrypt(n, `efin:${id}:efin`);
    correction.efin_last4 = last4(n);
    correction.efin_hash = sec.hashIdentifier("efin", n);
    correctedLast4 = last4(n);
  }
  const locationId = form.get("location_id") ? uuid(form.get("location_id"), "office") : null;
  if (locationId) {
    const { data: loc } = await client.from("office_locations").select("organization_id").eq("id", locationId).maybeSingle();
    if (!loc || loc.organization_id !== before.organization_id) throw new EfinRuleError("That location belongs to a different business.");
  }
  const next = {
    ...correction,
    location_id: locationId,
    internal_status: status,
    external_status: external,
    external_verified_at: external === "unverified" ? null : external === before.external_status ? before.external_verified_at : new Date().toISOString(),
    verification_source: text(form.get("verification_source"), 300, "Verification source"),
    recorded_expiration: expiration,
    expiration_verified: Boolean(expiration) && form.get("expiration_verified") === "on",
    notes: text(form.get("notes"), 4000, "Notes"),
    updated_by: actor.id,
  };
  const upd = await client.from("efin_records").update(next).eq("id", id);
  if (upd.error) throw upd.error.code === "23505" ? new EfinRuleError("That EFIN is already recorded on another ERO.", "efin") : new Error(upd.error.message);
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of ["location_id", "internal_status", "external_status", "recorded_expiration", "expiration_verified", "verification_source"] as const) {
    if ((before as Record<string, unknown>)[k] !== (next as Record<string, unknown>)[k]) changed[k] = { from: (before as Record<string, unknown>)[k], to: (next as Record<string, unknown>)[k] };
  }
  if (correctedLast4) changed.efin_number = { from: `••${before.efin_last4}`, to: `••${correctedLast4}` };
  await audit(actor, { type: "efin.updated", targetType: "efin", targetId: id, organizationId: before.organization_id, changes: changed, reason: text(form.get("reason"), 1000, "Reason") });
}

/** Archive rather than delete: the record and its history stay. */
export async function archiveEfin(actor: Actor, form: FormData) {
  const id = uuid(form.get("id"), "EFIN");
  if (form.get("confirm") !== "on") throw new EfinRuleError("Confirm to archive this EFIN.");
  const reason = text(form.get("reason"), 500, "Reason", true) as string;
  const { data, error } = await db().from("efin_records").update({ archived_at: new Date().toISOString(), archived_reason: reason, internal_status: "inactive", updated_by: actor.id }).eq("id", id).is("archived_at", null).select("organization_id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new EfinNotFound("That EFIN could not be found, or it is already archived.");
  await audit(actor, { type: "efin.archived", targetType: "efin", targetId: id, organizationId: data.organization_id as string, reason });
}

/** Reveals the full EFIN to an administrator. The read is audited first; if the audit write fails nothing is revealed. */
export async function revealEfin(actor: Actor, efinId: string): Promise<string> {
  const id = uuid(efinId, "EFIN");
  const { data, error } = await db().from("efin_records").select("efin_encrypted, organization_id").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new EfinNotFound("That EFIN could not be found.");
  await audit(actor, { type: "efin.revealed", targetType: "efin", targetId: id, organizationId: data.organization_id as string });
  return secrets().decrypt(data.efin_encrypted as string, `efin:${id}:efin`);
}

// ------------------------------------------------------------------------------------- edit ERO / contact / locations
/** Edits the business behind an ERO. A changed relationship needs a reason and is recorded; it never changes anyone's access. */
export async function updateOrganization(actor: Actor, form: FormData) {
  const id = uuid(form.get("id"), "ERO");
  const client = db();
  const before = unwrap(await client.from("organizations").select(ORG_COLS).eq("id", id).maybeSingle() as never) as OrgRow | null;
  if (!before) throw new EfinNotFound("That ERO could not be found.");
  const relationship = forField("relationship", () => oneOf(form.get("relationship") || before.relationship, RELATIONSHIPS, "Relationship"));
  if (relationship !== before.relationship && !String(form.get("reason") ?? "").trim()) throw new EfinRuleError("Add a reason for changing the relationship.", "reason");
  const einRaw = String(form.get("ein") ?? "").trim();
  const row: Record<string, unknown> = {
    legal_name: forField("legal_name", () => text(form.get("legal_name"), 200, "Legal name", true)),
    dba_name: text(form.get("dba_name"), 200, "Doing business as"),
    business_structure: form.get("business_structure") ? oneOf(form.get("business_structure"), ["llc", "corporation", "s_corporation", "partnership", "sole_proprietorship", "nonprofit", "other"] as const, "Business structure") : null,
    relationship,
    agreement_status: oneOf(form.get("agreement_status") || before.agreement_status, ["pending", "active", "suspended", "ended"] as const, "Agreement status"),
    primary_address: addressFrom(form),
    notes: text(form.get("notes"), 4000, "Notes"),
    updated_by: actor.id,
  };
  if (einRaw) {
    const ein = forField("ein", () => normalizeEin(einRaw));
    row.ein_encrypted = secrets().encrypt(ein, `org:${id}:ein`);
    row.ein_last4 = last4(ein);
  }
  unwrap(await client.from("organizations").update(row).eq("id", id) as never);
  const changed: Record<string, unknown> = {};
  if (relationship !== before.relationship) changed.relationship = { from: before.relationship, to: relationship };
  if (row.legal_name !== before.legal_name) changed.legal_name = { from: before.legal_name, to: row.legal_name };
  if (einRaw) changed.ein = "changed (not recorded)";
  await audit(actor, { type: "organization.updated", targetType: "organization", targetId: id, organizationId: id, changes: changed, reason: text(form.get("reason"), 1000, "Reason") });
}

export async function updatePerson(actor: Actor, form: FormData) {
  const id = uuid(form.get("person_id"), "person");
  const email = forField("person_email", () => lower(text(form.get("person_email"), 254, "Email")));
  if (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new EfinRuleError("That email address does not look right.", "person_email");
  const row = { full_name: forField("person_name", () => text(form.get("person_name"), 200, "Name", true)), email, phone: phoneOf(form.get("person_phone"), "person_phone"), updated_by: actor.id };
  unwrap(await db().from("people").update(row).eq("id", id) as never);
  await audit(actor, { type: "person.updated", targetType: "person", targetId: id, changes: { fields: ["full_name", "email", "phone"] } });
}

export async function updateLocation(actor: Actor, form: FormData) {
  const id = uuid(form.get("location_id"), "location");
  const client = db();
  const loc = unwrap(await client.from("office_locations").select("organization_id").eq("id", id).maybeSingle() as never) as { organization_id: string } | null;
  if (!loc) throw new EfinNotFound("That location could not be found.");
  const remove = form.get("remove") === "on";
  if (remove) {
    const { count } = await client.from("efin_records").select("id", { count: "exact", head: true }).eq("location_id", id).is("archived_at", null);
    if ((count ?? 0) > 0) throw new EfinRuleError("An EFIN still uses this location as its filing office. Change the EFIN's filing office first.");
    unwrap(await client.from("office_locations").update({ archived_at: new Date().toISOString(), is_primary: false }).eq("id", id) as never);
    await audit(actor, { type: "location.archived", targetType: "location", targetId: id, organizationId: loc.organization_id });
    return;
  }
  const isPrimary = form.get("is_primary") === "on";
  if (isPrimary) await client.from("office_locations").update({ is_primary: false }).eq("organization_id", loc.organization_id).eq("is_primary", true);
  unwrap(await client.from("office_locations").update({ name: forField("name", () => text(form.get("name"), 200, "Location name", true)), address: addressFrom(form), is_primary: isPrimary }).eq("id", id) as never);
  await audit(actor, { type: "location.updated", targetType: "location", targetId: id, organizationId: loc.organization_id, changes: { is_primary: isPrimary } });
}

// --------------------------------------------------------------------------------- archive, restore, delete, bulk
const RESTORE_REASON = "Archived with ERO";

export async function restoreEfin(actor: Actor, efinId: string) {
  const id = uuid(efinId, "EFIN");
  const { data, error } = await db().from("efin_records").update({ archived_at: null, archived_reason: null, internal_status: "pending_verification", updated_by: actor.id }).eq("id", id).not("archived_at", "is", null).select("organization_id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new EfinNotFound("That EFIN is not archived.");
  await audit(actor, { type: "efin.restored", targetType: "efin", targetId: id, organizationId: data.organization_id as string, reason: "Restored; status set to pending verification" });
}

export async function archiveOrganization(actor: Actor, orgId: string, reason: string) {
  const id = uuid(orgId, "ERO");
  const client = db();
  const now = new Date().toISOString();
  const { data, error } = await client.from("organizations").update({ archived_at: now, status: "inactive", updated_by: actor.id }).eq("id", id).is("archived_at", null).select("legal_name").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new EfinNotFound("That ERO could not be found, or it is already archived.");
  unwrap(await client.from("efin_records").update({ archived_at: now, archived_reason: RESTORE_REASON, internal_status: "inactive", updated_by: actor.id }).eq("organization_id", id).is("archived_at", null) as never);
  await audit(actor, { type: "organization.archived", targetType: "organization", targetId: id, organizationId: id, reason });
}

export async function restoreOrganization(actor: Actor, orgId: string) {
  const id = uuid(orgId, "ERO");
  const client = db();
  const { data, error } = await client.from("organizations").update({ archived_at: null, status: "active", updated_by: actor.id }).eq("id", id).not("archived_at", "is", null).select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new EfinNotFound("That ERO is not archived.");
  unwrap(await client.from("efin_records").update({ archived_at: null, archived_reason: null, internal_status: "pending_verification", updated_by: actor.id }).eq("organization_id", id).eq("archived_reason", RESTORE_REASON) as never);
  await audit(actor, { type: "organization.restored", targetType: "organization", targetId: id, organizationId: id, reason: "Restored; EFINs set to pending verification" });
}

/** Permanent deletion, all or nothing. Refused when an assignment ever went live (archive instead). Audit events remain. */
export async function deleteEfin(actor: Actor, efinId: string) {
  const { error } = await db().rpc("efin_delete_efin", { p_efin: uuid(efinId, "EFIN"), p_actor: actor.id, p_email: actor.email });
  if (error) throw dbError(error);
}
export async function deleteOrganization(actor: Actor, orgId: string) {
  const { error } = await db().rpc("efin_delete_organization", { p_org: uuid(orgId, "ERO"), p_actor: actor.id, p_email: actor.email });
  if (error) throw dbError(error);
}

export const BULK_ACTIONS = ["archive", "restore", "delete", "status_active", "status_inactive", "status_suspended", "status_pending_verification"] as const;
export type BulkResult = { done: number; skipped: { label: string; why: string }[] };

/** Applies one action to many rows ("efin:<id>" or "org:<id>"). Each row succeeds or is skipped on its own and is audited on its own. */
export async function bulkApply(actor: Actor, form: FormData): Promise<BulkResult> {
  const action = oneOf(form.get("bulk_action"), BULK_ACTIONS, "Action");
  const ids = [...new Set(form.getAll("ids").map(String))];
  if (ids.length === 0) throw new EfinRuleError("Select at least one row first.");
  if (ids.length > 100) throw new EfinRuleError("Select 100 rows or fewer at a time.");
  const reason = String(form.get("reason") ?? "").trim();
  if (action !== "restore" && reason.length < 5) throw new EfinRuleError("Add a reason (a few words); it is recorded in the history.", "reason");
  if (action !== "restore" && action !== "status_active" && action !== "status_pending_verification" && form.get("confirm") !== "on") throw new EfinRuleError("Tick the box to confirm this high-impact change.", "confirm");
  const client = db();
  const result: BulkResult = { done: 0, skipped: [] };
  for (const raw of ids) {
    const [kind, id] = raw.split(":");
    if ((kind !== "efin" && kind !== "org") || !UUID.test(id ?? "")) { result.skipped.push({ label: "Unknown row", why: "Not a valid selection." }); continue; }
    const label = kind === "efin" ? `EFIN ••${((await client.from("efin_records").select("efin_last4").eq("id", id).maybeSingle()).data as { efin_last4?: string } | null)?.efin_last4 ?? "????"}` : (((await client.from("organizations").select("legal_name").eq("id", id).maybeSingle()).data as { legal_name?: string } | null)?.legal_name ?? "ERO");
    try {
      if (action === "delete") await (kind === "efin" ? deleteEfin(actor, id) : deleteOrganization(actor, id));
      else if (action === "archive") {
        if (kind === "org") await archiveOrganization(actor, id, reason);
        else { const f = new FormData(); f.set("id", id); f.set("confirm", "on"); f.set("reason", reason); await archiveEfin(actor, f); }
      } else if (action === "restore") await (kind === "efin" ? restoreEfin(actor, id) : restoreOrganization(actor, id));
      else {
        if (kind !== "efin") throw new EfinRuleError("Status applies to EFINs, not to an ERO without one.");
        const status = action.replace("status_", "");
        const { data, error } = await client.from("efin_records").update({ internal_status: status, updated_by: actor.id }).eq("id", id).is("archived_at", null).select("organization_id, internal_status").maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) throw new EfinRuleError("Archived or missing.");
        await audit(actor, { type: "efin.status_changed", targetType: "efin", targetId: id, organizationId: data.organization_id as string, changes: { new_status: status, bulk: true }, reason });
      }
      result.done++;
    } catch (e) {
      if (e instanceof EfinRuleError) result.skipped.push({ label, why: e.message });
      else throw e;
    }
  }
  return result;
}

// ----------------------------------------------------------------------------------------------- assignments
export async function requestAssignment(actor: Actor, form: FormData): Promise<string> {
  const efinId = uuid(form.get("efin_id"), "EFIN");
  const client = db();
  const efin = unwrap(await client.from("efin_records").select("id, organization_id, internal_status, archived_at").eq("id", efinId).maybeSingle() as never) as Pick<EfinRow, "id" | "organization_id" | "internal_status" | "archived_at"> | null;
  if (!efin) throw new EfinNotFound("That EFIN could not be found.");
  const organizationId = uuid(form.get("organization_id"), "organization");
  const destOrg = unwrap(await client.from("organizations").select("relationship").eq("id", organizationId).maybeSingle() as never) as { relationship: string } | null;
  if (destOrg && !tracksTeam(destOrg.relationship)) throw new EfinRuleError("Assignments are not kept for software or service clients.");
  const role = oneOf(form.get("role"), ASSIGNMENT_ROLES, "Role");
  const personId = form.get("person_id") ? uuid(form.get("person_id"), "person") : null;
  const from = day(form.get("effective_from"), "Start date");
  const to = day(form.get("effective_to"), "End date");
  const row = { efin_id: efinId, organization_id: organizationId, location_id: form.get("location_id") ? uuid(form.get("location_id"), "office") : null, person_id: personId, role, software_provider: text(form.get("software_provider"), 120, "Software provider"), effective_from: from, effective_to: to, requested_by: actor.id, state: "draft" as const };
  if (to && from && to < from) throw new EfinRuleError("The end date is before the start date.");
  const { data, error } = await client.from("efin_assignments").insert(row).select("id").single();
  if (error) throw error.code === "23505" ? new EfinRuleError("That person already has a live assignment for this role on this EFIN.") : new Error(error.message);
  await audit(actor, { type: "assignment.created", targetType: "assignment", targetId: data.id as string, organizationId, changes: { efin_id: efinId, role, person_id: personId, state: "draft" } });
  return efinId;
}

export async function changeAssignment(actor: Actor, form: FormData): Promise<{ efinId: string; message: string }> {
  const id = uuid(form.get("id"), "assignment");
  const to = oneOf(form.get("to"), ["draft", "pending_review", "approved", "active", "suspended", "revoked", "expired"] as const, "State") as AssignmentState;
  const client = db();
  const a = unwrap(await client.from("efin_assignments").select("*").eq("id", id).maybeSingle() as never) as AssignmentRow | null;
  if (!a) throw new EfinNotFound("That assignment could not be found.");
  const [efin, roles, credentials] = await Promise.all([
    client.from("efin_records").select("internal_status, archived_at, organization_id").eq("id", a.efin_id).single(),
    client.from("organization_roles").select("organization_id, person_id, role, status").eq("organization_id", a.organization_id),
    a.person_id ? client.from("professional_credentials").select("person_id, kind, archived_at").eq("person_id", a.person_id) : Promise.resolve({ data: [], error: null }),
  ]);
  const reason = String(form.get("reason") ?? "");
  const plan = planTransition({
    assignment: a, to, actorId: actor.id, reason, confirmed: form.get("confirm") === "on",
    efin: unwrap(efin as never) as Pick<EfinRow, "internal_status" | "archived_at" | "organization_id">,
    roles: unwrap(roles as never) as RoleRow[], credentials: unwrap(credentials as never) as CredentialRow[],
  });
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { state: plan.to, updated_at: now };
  if (plan.to === "approved" || (plan.to === "draft" && a.state === "pending_review")) { patch.reviewed_by = actor.id; patch.reviewed_at = now; patch.review_reason = reason.trim() || null; }
  if (plan.to === "active") { patch.activated_at = a.activated_at ?? now; }
  if (["revoked", "expired", "suspended"].includes(plan.to)) { patch.end_reason = reason.trim() || null; }
  if (["revoked", "expired"].includes(plan.to)) { patch.ended_at = now; }
  // Compare-and-set on the previous state so two administrators cannot apply conflicting moves.
  const { data, error } = await client.from("efin_assignments").update(patch).eq("id", id).eq("state", a.state).select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new EfinRuleError("Someone else changed this assignment first. Reload and try again.");
  await audit(actor, {
    type: `assignment.${plan.action}`, targetType: "assignment", targetId: id, organizationId: a.organization_id,
    changes: { efin_id: a.efin_id, role: a.role, person_id: a.person_id, previous_state: a.state, new_state: plan.to, self_approval: plan.selfApproval || undefined },
    reason: reason.trim() || null,
  });
  return { efinId: a.efin_id, message: `Assignment ${words(plan.to)}.` };
}

/** Surfaces what is blocking an assignment, for the UI to show before someone clicks. */
export function problemsFor(snap: Snapshot, a: AssignmentRow): string[] {
  const efin = snap.efins.find((e) => e.id === a.efin_id);
  if (!efin) return ["The EFIN record is missing."];
  return assignmentProblems({ assignment: a, efin, roles: snap.roles, credentials: snap.credentials });
}

// ---------------------------------------------------------------------------------------------- filing + docs
export async function saveFiling(actor: Actor, form: FormData) {
  const efinId = uuid(form.get("efin_id"), "EFIN");
  const client = db();
  const efin = unwrap(await client.from("efin_records").select("organization_id").eq("id", efinId).maybeSingle() as never) as { organization_id: string } | null;
  if (!efin) throw new EfinNotFound("That EFIN could not be found.");
  const status = oneOf(form.get("external_auth_status") || "unverified", ["unverified", "manually_verified", "verified", "not_applicable"] as const, "Authorization status");
  const row = unwrap(await client.from("filing_relationships").insert({
    efin_id: efinId, organization_id: efin.organization_id,
    software_provider: text(form.get("software_provider"), 120, "Software provider", true),
    software_product: text(form.get("software_product"), 120, "Product"),
    tax_year: form.get("tax_year") ? Number(form.get("tax_year")) : null,
    external_auth_status: status,
    verification_source: text(form.get("verification_source"), 300, "Verification source"),
    last_verified_at: status === "manually_verified" || status === "verified" ? new Date().toISOString() : null,
    remediation_note: text(form.get("remediation_note"), 1000, "Remediation note"),
  }).select("id").single() as never) as { id: string };
  await audit(actor, { type: "filing_relationship.created", targetType: "filing_relationship", targetId: row.id, organizationId: efin.organization_id, changes: { efin_id: efinId, external_auth_status: status } });
}

// -------------------------------------------------------------------------------------------------- renewals
export async function completeRenewal(actor: Actor, form: FormData) {
  const id = uuid(form.get("id"), "task");
  const evidence = text(form.get("evidence_note"), 1000, "Evidence (what confirmed the renewal)", true);
  const newDue = day(form.get("new_due_on"), "New expiration date");
  if (!newDue) throw new EfinRuleError("Enter the new verified expiration date.");
  const client = db();
  const task = unwrap(await client.from("renewal_tasks").select("*").eq("id", id).maybeSingle() as never) as RenewalTaskRow | null;
  if (!task || ["done", "cancelled"].includes(task.status)) throw new EfinNotFound("That task is not open.");
  const now = new Date().toISOString();
  unwrap(await client.from("renewal_tasks").update({ status: "done", completed_at: now, completed_by: actor.id, completion_note: text(form.get("completion_note"), 1000, "Note"), evidence_note: evidence }).eq("id", id) as never);
  if (task.subject_type === "efin") {
    unwrap(await client.from("efin_records").update({ recorded_expiration: newDue, expiration_verified: true, internal_status: "active", updated_by: actor.id }).eq("id", task.subject_id).eq("internal_status", "renewal_review") as never);
    unwrap(await client.from("efin_records").update({ recorded_expiration: newDue, expiration_verified: true, updated_by: actor.id }).eq("id", task.subject_id) as never);
  }
  await audit(actor, { type: "renewal.completed", targetType: "renewal_task", targetId: id, organizationId: task.organization_id, changes: { previous_due_on: task.due_on, original_due_on: task.original_due_on, new_due_on: newDue }, reason: evidence });
}

export { todayIso, tracksTeam };
export type { Verification, AssignmentRole };
