import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CrmSecrets } from "../crm/crypto.ts";
import { unwrap } from "../commerce/supabase-repo.ts";
import { serviceClient } from "../admin";
import { assignmentProblems, EfinRuleError, last4, normalizeEfin, normalizeEin, normalizePtin, parseDay, planTransition, todayIso } from "./rules.ts";
import type { AssignmentRole, AssignmentRow, AssignmentState, AuditRow, CredentialRow, EfinRow, FilingRow, LocationRow, OrgRow, PersonRow, RenewalTaskRow, RoleRow, Verification } from "./types.ts";
import { ASSIGNMENT_ROLES, EFIN_STATUSES, VERIFICATION } from "./types.ts";

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
export async function saveOrganization(actor: Actor, form: FormData): Promise<OrgRow> {
  const id = String(form.get("id") ?? "");
  const einRaw = String(form.get("ein") ?? "").trim();
  const row: Record<string, unknown> = {
    legal_name: text(form.get("legal_name"), 200, "Legal name", true),
    dba_name: text(form.get("dba_name"), 200, "Doing business as"),
    business_structure: form.get("business_structure") ? oneOf(form.get("business_structure"), ["llc", "corporation", "s_corporation", "partnership", "sole_proprietorship", "nonprofit", "other"] as const, "Business structure") : null,
    relationship: oneOf(form.get("relationship") || "partner", ["internal", "partner", "other"] as const, "Relationship"),
    agreement_status: oneOf(form.get("agreement_status") || "pending", ["pending", "active", "suspended", "ended"] as const, "Agreement status"),
    onboarding_status: oneOf(form.get("onboarding_status") || "not_started", ["not_started", "in_progress", "complete"] as const, "Onboarding status"),
    primary_address: { line1: text(form.get("line1"), 200, "Address") ?? "", city: text(form.get("city"), 100, "City") ?? "", state: text(form.get("state"), 2, "State") ?? "", zip: text(form.get("zip"), 10, "ZIP") ?? "" },
    notes: text(form.get("notes"), 4000, "Notes"),
    updated_by: actor.id,
  };
  const orgId = id ? uuid(id, "organization") : randomUUID();
  if (einRaw) {
    const ein = normalizeEin(einRaw);
    row.ein_encrypted = secrets().encrypt(ein, `org:${orgId}:ein`);
    row.ein_last4 = last4(ein);
  }
  const client = db();
  if (id) {
    const saved = unwrap(await client.from("organizations").update(row).eq("id", orgId).select(ORG_COLS).single() as never) as OrgRow;
    await audit(actor, { type: "organization.updated", targetType: "organization", targetId: orgId, organizationId: orgId, changes: { fields: Object.keys(row).filter((k) => k !== "ein_encrypted" && k !== "updated_by"), ein_changed: Boolean(einRaw) } });
    return saved;
  }
  const saved = unwrap(await client.from("organizations").insert({ ...row, id: orgId, created_by: actor.id }).select(ORG_COLS).single() as never) as OrgRow;
  await audit(actor, { type: "organization.created", targetType: "organization", targetId: orgId, organizationId: orgId, changes: { legal_name: row.legal_name } });
  return saved;
}

export async function saveLocation(actor: Actor, form: FormData) {
  const organizationId = uuid(form.get("organization_id"), "organization");
  const isPrimary = form.get("is_primary") === "on";
  const client = db();
  if (isPrimary) await client.from("office_locations").update({ is_primary: false }).eq("organization_id", organizationId).eq("is_primary", true);
  const row = unwrap(await client.from("office_locations").insert({
    organization_id: organizationId,
    name: text(form.get("name"), 200, "Office name", true),
    address: { line1: text(form.get("line1"), 200, "Address") ?? "", city: text(form.get("city"), 100, "City") ?? "", state: text(form.get("state"), 2, "State") ?? "", zip: text(form.get("zip"), 10, "ZIP") ?? "" },
    is_primary: isPrimary,
  }).select("id, name").single() as never) as { id: string; name: string };
  await audit(actor, { type: "location.created", targetType: "location", targetId: row.id, organizationId, changes: { name: row.name, is_primary: isPrimary } });
}

// ------------------------------------------------------------------------------------------ people / credentials
export async function savePerson(actor: Actor, form: FormData) {
  const email = text(form.get("email"), 254, "Email");
  if (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new EfinRuleError("That email address does not look right.");
  const row = unwrap(await db().from("people").insert({ full_name: text(form.get("full_name"), 200, "Full name", true), email, phone: text(form.get("phone"), 40, "Phone"), created_by: actor.id, updated_by: actor.id }).select("id, full_name").single() as never) as { id: string; full_name: string };
  await audit(actor, { type: "person.created", targetType: "person", targetId: row.id, changes: { full_name: row.full_name } });
}

/** PTIN is a separate protected record linked to a person. Recording one never authorizes e-file by itself. */
export async function addCredential(actor: Actor, form: FormData) {
  const personId = uuid(form.get("person_id"), "person");
  const ptin = normalizePtin(String(form.get("identifier") ?? ""));
  const s = secrets();
  const id = randomUUID();
  const verification = oneOf(form.get("verification_status") || "unverified", VERIFICATION, "Verification");
  const hash = s.hashIdentifier("ptin", ptin);
  const client = db();
  const { error } = await client.from("professional_credentials").insert({
    id, person_id: personId, kind: "ptin",
    identifier_encrypted: s.encrypt(ptin, `credential:${id}:identifier`), identifier_last4: last4(ptin), identifier_hash: hash,
    verification_status: verification, verification_source: text(form.get("verification_source"), 300, "Verification source"),
    verified_at: verification === "unverified" ? null : new Date().toISOString(), verified_by: verification === "unverified" ? null : actor.id,
    expires_on: day(form.get("expires_on"), "Expiration date"),
  });
  if (error) throw error.code === "23505" ? new EfinRuleError("That PTIN is already recorded for someone.") : new Error(error.message);
  await audit(actor, { type: "credential.created", targetType: "credential", targetId: id, changes: { kind: "ptin", last4: last4(ptin), verification_status: verification, person_id: personId } });
}

export async function addRole(actor: Actor, form: FormData) {
  const organizationId = uuid(form.get("organization_id"), "organization");
  const personId = uuid(form.get("person_id"), "person");
  const role = oneOf(form.get("role"), ASSIGNMENT_ROLES, "Role");
  const locationId = form.get("location_id") ? uuid(form.get("location_id"), "office") : null;
  const verification = oneOf(form.get("verification_status") || "unverified", VERIFICATION, "Verification");
  const { data, error } = await db().from("organization_roles").insert({ organization_id: organizationId, person_id: personId, role, location_id: locationId, verification_status: verification, verification_note: text(form.get("verification_note"), 1000, "Verification note"), start_date: day(form.get("start_date"), "Start date"), created_by: actor.id }).select("id").single();
  if (error) throw error.code === "23505" ? new EfinRuleError("That person already holds this role here.") : new Error(error.message);
  await audit(actor, { type: "role.created", targetType: "role", targetId: data.id as string, organizationId, changes: { role, person_id: personId, verification_status: verification } });
}

// ------------------------------------------------------------------------------------------------------ EFINs
export async function createEfin(actor: Actor, form: FormData): Promise<string> {
  const efin = normalizeEfin(String(form.get("efin") ?? ""));
  const s = secrets();
  const id = randomUUID();
  const organizationId = uuid(form.get("organization_id"), "organization");
  const external = oneOf(form.get("external_status") || "unverified", VERIFICATION, "Verification");
  const expiration = day(form.get("recorded_expiration"), "Expiration date");
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
  if (error) throw error.code === "23505" ? new EfinRuleError("That EFIN is already recorded. Open the existing record instead.") : new Error(error.message);
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
  if (status !== before.internal_status && !String(form.get("reason") ?? "").trim()) throw new EfinRuleError("Add a reason for the status change.");
  const next = {
    internal_status: status,
    external_status: external,
    external_verified_at: external === "unverified" ? null : external === before.external_status ? before.external_verified_at : new Date().toISOString(),
    verification_source: text(form.get("verification_source"), 300, "Verification source"),
    recorded_expiration: expiration,
    expiration_verified: Boolean(expiration) && form.get("expiration_verified") === "on",
    notes: text(form.get("notes"), 4000, "Notes"),
    updated_by: actor.id,
  };
  unwrap(await client.from("efin_records").update(next).eq("id", id) as never);
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of ["internal_status", "external_status", "recorded_expiration", "expiration_verified", "verification_source"] as const) {
    if ((before as Record<string, unknown>)[k] !== (next as Record<string, unknown>)[k]) changed[k] = { from: (before as Record<string, unknown>)[k], to: (next as Record<string, unknown>)[k] };
  }
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

// ----------------------------------------------------------------------------------------------- assignments
export async function requestAssignment(actor: Actor, form: FormData): Promise<string> {
  const efinId = uuid(form.get("efin_id"), "EFIN");
  const client = db();
  const efin = unwrap(await client.from("efin_records").select("id, organization_id, internal_status, archived_at").eq("id", efinId).maybeSingle() as never) as Pick<EfinRow, "id" | "organization_id" | "internal_status" | "archived_at"> | null;
  if (!efin) throw new EfinNotFound("That EFIN could not be found.");
  const organizationId = uuid(form.get("organization_id"), "organization");
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
  return { efinId: a.efin_id, message: `Assignment ${plan.to.replace(/_/g, " ")}.` };
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

export { todayIso };
export type { Verification, AssignmentRole };
