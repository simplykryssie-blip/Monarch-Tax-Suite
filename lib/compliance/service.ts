import { createHash, randomUUID } from "node:crypto";
import { ValidationError } from "../commerce/validation.ts";
import type { CrmSecrets } from "../crm/crypto.ts";
import type { DocumentStore } from "../documents/types.ts";
import { checkDocumentFile, cleanDocumentName, CONTENT_TYPES, MAX_DOCUMENT_BYTES } from "../documents/files.ts";
import { can, type Permissions, type Role } from "../office/permissions.ts";
import { checkAnswers, WispInputError, type WispAnswers } from "../wisp/content.ts";
import { buildWispPdf } from "../wisp/pdf.ts";
import {
  addDays, count8879, daysBetween, earlyDeletion, ftcDuty, INCIDENT_STEPS, isDate, itemState, longDate, nextReviewDue, nextYearlyDue, openSteps,
  ptinReminderPeriod, ptinSeason, reviewReminderStage, reviewState, settingsOf, todayIso, type OfficeStatus,
} from "./rules.ts";
import {
  DOC_KINDS, LOCATIONS, type Attestation, type ComplianceRepo, type ComplianceSettings, type DocKind, type Form8879, type Incident, type Location8879,
  type TeamMember, type VaultDocument,
} from "./types.ts";

// The Compliance Center for one office. Guided, not caged: where an IRS or FTC rule applies the office is told
// "Required by", and can still go ahead; going against the rule asks for a reason, and the reason is kept in the
// history. Every action checks the office permission catalog and writes to the history.

export type ComplianceDeps = {
  tenantId: string;
  repo: ComplianceRepo;
  store: DocumentStore;
  secrets: CrmSecrets | null;
  /** Sends one reminder email. Null when sent; otherwise why not (a message starting "Not sent" means held back on purpose). */
  send: (mail: { to: string; subject: string; text: string; idempotencyKey: string }) => Promise<string | null>;
  origin: () => Promise<string>;
  now?: () => Date;
};

/** Who is acting, for which office. Bureau administrators act as role "bureau". */
export type Ctx = { userId: string; name: string; role: Role; memberId: string | null; permissions: Permissions; officeId: string; officeName: string };

const fail = (m: string): never => { throw new ValidationError(m); };
const nowOf = (deps: ComplianceDeps) => deps.now?.() ?? new Date();
const today = (deps: ComplianceDeps) => todayIso(nowOf(deps));
const text = (raw: unknown, max: number) => (typeof raw === "string" ? raw.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const longText = (raw: unknown, max: number) => (typeof raw === "string" ? raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
const optDate = (raw: unknown, label: string) => {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return null;
  if (!isDate(v)) fail(`${label} isn't a valid date.`);
  return v;
};
const reqDate = (raw: unknown, label: string) => optDate(raw, label) ?? fail(`Enter ${label.toLowerCase()}.`);
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function need(ctx: Ctx, key: string) {
  if (!can(ctx.role, ctx.permissions, key)) fail("You don't have access to that part of the Compliance Center. Ask your ERO.");
}
const event = (deps: ComplianceDeps, ctx: Ctx | null, e: { entity: Parameters<ComplianceRepo["addEvent"]>[0]["entity"]; record_id: string | null; action: string; reason?: string | null; detail?: Record<string, unknown>; officeId?: string }) =>
  deps.repo.addEvent({ organization_id: e.officeId ?? ctx?.officeId ?? null, entity: e.entity, record_id: e.record_id, action: e.action, actor_id: ctx?.userId ?? null, actor_name: ctx?.name ?? "Monarch reminders", reason: e.reason ?? null, detail: e.detail ?? {} });

/** A record found by id, and only in this office. */
async function mine<T extends { organization_id: string }>(ctx: Ctx, row: T | null, what: string): Promise<T> {
  if (!row || row.organization_id !== ctx.officeId) fail(`That ${what} wasn't found.`);
  return row!;
}

/** Going against an IRS or FTC rule: allowed, with a reason that is kept. */
function overrideReason(raw: unknown, warning: string): string {
  const reason = text(raw, 1000);
  if (reason.length < 3) fail(`${warning} To go ahead, give a reason. It's kept in the history.`);
  return reason;
}

// ------------------------------------------------------------------ settings

export async function saveSettings(deps: ComplianceDeps, ctx: Ctx, raw: Record<string, unknown>): Promise<ComplianceSettings> {
  need(ctx, "compliance.manage");
  const int = (v: unknown, lo: number, hi: number, label: string) => {
    const n = Number(String(v ?? "").trim());
    if (!Number.isInteger(n) || n < lo || n > hi) fail(`${label} must be a whole number from ${lo} to ${hi}.`);
    return n;
  };
  const days = String(raw.review_reminder_days ?? "").split(/[\s,]+/).filter(Boolean).map((d) => int(d, 0, 365, "Each reminder day"));
  if (days.length > 6) fail("Choose up to 6 reminder days.");
  const email = text(raw.liaison_email, 254);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("Enter a valid email for your Stakeholder Liaison, or leave it blank.");
  const saved = await deps.repo.saveSettings(ctx.officeId, {
    review_months: int(raw.review_months, 1, 36, "The review schedule"),
    review_reminder_days: [...new Set(days)].sort((a, b) => b - a),
    retention_alert_days: int(raw.retention_alert_days, 0, 730, "The retention alert"),
    ptin_reminder_every_days: int(raw.ptin_reminder_every_days, 1, 76, "PTIN reminder spacing"),
    liaison_name: text(raw.liaison_name, 120) || null,
    liaison_phone: text(raw.liaison_phone, 40) || null,
    liaison_email: email || null,
    liaison_notes: text(raw.liaison_notes, 500) || null,
  });
  await event(deps, ctx, { entity: "settings", record_id: saved.id, action: "settings_saved", detail: { review_months: saved.review_months, review_reminder_days: saved.review_reminder_days, retention_alert_days: saved.retention_alert_days, ptin_reminder_every_days: saved.ptin_reminder_every_days } });
  return saved;
}

// ------------------------------------------------------------------ vault

export const vaultPath = (deps: ComplianceDeps, officeId: string, id: string, type: "pdf" | "docx") => `${deps.tenantId}/compliance/${officeId}/${id}.${type}`;
const kindOf = (raw: unknown): DocKind => (typeof raw === "string" && raw in DOC_KINDS ? (raw as DocKind) : fail("Choose what kind of document this is."));

/** Starts an upload: a pending vault row and a one-time upload link straight to private storage. */
export async function startUpload(deps: ComplianceDeps, ctx: Ctx, raw: { kind: unknown; title: unknown; fileName: unknown; sizeBytes: unknown }) {
  need(ctx, "compliance.vault");
  const kind = kindOf(raw.kind);
  const size = Number(raw.sizeBytes);
  if (!Number.isFinite(size) || size <= 0) fail("Choose a file.");
  if (size > MAX_DOCUMENT_BYTES) fail("That file is larger than 25 MB.");
  const { fileName, fileType } = cleanDocumentName(String(raw.fileName ?? ""));
  const title = text(raw.title, 200) || fileName.replace(/\.(pdf|docx)$/i, "");
  const id = randomUUID();
  const path = vaultPath(deps, ctx.officeId, id, fileType);
  const doc = await deps.repo.insertDocument({ organization_id: ctx.officeId, kind, title, file_path: path, file_type: fileType, size_bytes: size, sha256: null, status: "pending", retention_until: null, answers_sealed: null, uploaded_by: ctx.userId, uploaded_by_name: ctx.name });
  const { url } = await deps.store.createUploadUrl(path);
  return { doc, uploadUrl: url, contentType: CONTENT_TYPES[fileType] };
}

/** Finishes an upload: the file is checked by its content, fingerprinted, and the row marked stored. */
export async function finishUpload(deps: ComplianceDeps, ctx: Ctx, id: string): Promise<VaultDocument> {
  need(ctx, "compliance.vault");
  const doc = await mine(ctx, await deps.repo.getDocument(id), "document");
  if (doc.status === "stored") return doc;
  const bytes = await deps.store.download(doc.file_path);
  if (!bytes) fail("The upload didn't arrive. Try again.");
  try {
    await checkDocumentFile(bytes!, doc.file_type);
  } catch (e) {
    await deps.store.remove([doc.file_path]).catch(() => undefined);
    await deps.repo.deleteDocument(doc.id);
    throw e;
  }
  const stored = await deps.repo.updateDocument(doc.id, { status: "stored", size_bytes: bytes!.length, sha256: createHash("sha256").update(bytes!).digest("hex") });
  await event(deps, ctx, { entity: "document", record_id: doc.id, action: "uploaded", detail: { kind: doc.kind, title: doc.title } });
  return stored;
}

/** A 60-second link to a vault file. Logged. */
export async function vaultDownload(deps: ComplianceDeps, ctx: Ctx, id: string): Promise<string> {
  const doc = await mine(ctx, await deps.repo.getDocument(id), "document");
  // A WISP is readable by everyone who must acknowledge it; everything else needs the vault.
  if (!(doc.kind === "wisp" && can(ctx.role, ctx.permissions, "compliance.home") && ctx.role !== "bureau")) need(ctx, "compliance.vault");
  if (doc.status !== "stored") fail("That file hasn't finished uploading.");
  if (!doc.file_path.startsWith(`${deps.tenantId}/compliance/${ctx.officeId}/`)) fail("Refused: that file is not in this office's folder.");
  await event(deps, ctx, { entity: "document", record_id: doc.id, action: "downloaded" });
  return deps.store.signedUrl(doc.file_path, 60, `${doc.title.replace(/[^\w .-]+/g, "").slice(0, 80) || "document"}.${doc.file_type}`);
}

/**
 * Deletes a vault file. An 8879 kept for less than the IRS retention period gets the "Required by IRS" warning: the
 * office can still delete it, with a reason that is kept. A linked 8879 record is kept (it just loses its file).
 */
export async function deleteDocument(deps: ComplianceDeps, ctx: Ctx, id: string, raw: { reason?: unknown }) {
  need(ctx, "compliance.vault");
  const doc = await mine(ctx, await deps.repo.getDocument(id), "document");
  const early = earlyDeletion(doc.retention_until, today(deps));
  const reason = early.early ? overrideReason(raw.reason, early.warning!) : text(raw.reason, 1000) || null;
  await deps.repo.deleteDocument(doc.id);
  // The file is kept for the 24-hour window, then the scheduler deletes it.
  await deps.store.discard([doc.file_path]);
  await event(deps, ctx, { entity: "document", record_id: doc.id, action: early.early ? "deleted_early" : "deleted", reason, detail: { kind: doc.kind, title: doc.title, retention_until: doc.retention_until } });
  return { early: early.early };
}

// ------------------------------------------------------------------ WISP

export const attestationStatement = (office: string) =>
  `I attest that ${office} has a written information security plan (WISP) as required by IRS Publication 5708 and the FTC Safeguards Rule, that the plan attached here is the office's current plan, and that the office follows it.`;

// Sealed answers are bound to their file, so they can't be moved to another office's record.
const aad = (deps: ComplianceDeps, path: string) => `compliance-wisp:${deps.tenantId}:${path}`;

/** Builds the office's WISP with the shared engine and files it in the vault. Answers are kept sealed to prefill next year. */
export async function buildWisp(deps: ComplianceDeps, ctx: Ctx, raw: unknown, brandName: string): Promise<VaultDocument> {
  need(ctx, "compliance.manage");
  let answers: WispAnswers;
  try {
    answers = checkAnswers(raw);
  } catch (e) {
    throw e instanceof WispInputError ? new ValidationError(e.message) : e;
  }
  const id = randomUUID();
  const bytes = await buildWispPdf({ answers, brandName, generatedAt: nowOf(deps), planId: id });
  const path = vaultPath(deps, ctx.officeId, id, "pdf");
  await deps.store.upload(path, bytes, "application/pdf");
  const doc = await deps.repo.insertDocument({
    organization_id: ctx.officeId, kind: "wisp", title: `WISP — ${answers.firm_name} (${today(deps)})`, file_path: path, file_type: "pdf", size_bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"), status: "stored", retention_until: null,
    answers_sealed: deps.secrets ? deps.secrets.encrypt(JSON.stringify(answers), aad(deps, path)) : null, uploaded_by: ctx.userId, uploaded_by_name: ctx.name,
  });
  await event(deps, ctx, { entity: "document", record_id: doc.id, action: "wisp_built", detail: { title: doc.title } });
  return doc;
}

/** The answers of the office's most recent built WISP, to prefill the builder. */
export async function lastAnswers(deps: ComplianceDeps, officeId: string): Promise<WispAnswers | null> {
  if (!deps.secrets) return null;
  const doc = (await deps.repo.listDocuments(officeId, { kind: "wisp" })).find((d) => d.answers_sealed);
  if (!doc) return null;
  try {
    return JSON.parse(deps.secrets.decrypt(doc.answers_sealed!, aad(deps, doc.file_path))) as WispAnswers;
  } catch {
    return null;
  }
}

/** Firm-level attestation: who, when, which WISP from the vault, and when the next review is due. */
export async function attest(deps: ComplianceDeps, ctx: Ctx, raw: { documentId: unknown; name: unknown; confirm: unknown }): Promise<Attestation> {
  need(ctx, "compliance.manage");
  if (ctx.role === "bureau") fail("The office's ERO attests to its WISP. The bureau can see the status but doesn't attest for an office.");
  if (raw.confirm !== true && raw.confirm !== "on" && raw.confirm !== "yes") fail("Tick the box to confirm the attestation.");
  const name = text(raw.name, 200);
  if (name.length < 2) fail("Type your full name to sign the attestation.");
  const docId = String(raw.documentId ?? "");
  const doc = UUID.test(docId) ? await deps.repo.getDocument(docId) : null;
  if (!doc || doc.organization_id !== ctx.officeId || doc.kind !== "wisp" || doc.status !== "stored") fail("Choose the WISP you're attesting to (build one, or upload it to the vault as a WISP).");
  const settings = settingsOf(await deps.repo.getSettings(ctx.officeId));
  const att = await deps.repo.insertAttestation({
    organization_id: ctx.officeId, source: doc!.answers_sealed ? "built" : "uploaded", document_id: doc!.id, statement: attestationStatement(ctx.officeName),
    attested_by: ctx.userId, attested_name: name, review_due: nextReviewDue(today(deps), settings.review_months),
  });
  await event(deps, ctx, { entity: "attestation", record_id: att.id, action: "attested", detail: { document_id: doc!.id, review_due: att.review_due, signed_as: name } });
  return att;
}

export async function latestAttestation(deps: ComplianceDeps, officeId: string): Promise<Attestation | null> {
  return (await deps.repo.listAttestations(officeId))[0] ?? null;
}

/** A team member confirms they've read the office's current WISP. Once per attestation. */
export async function acknowledge(deps: ComplianceDeps, ctx: Ctx, attestationId: string) {
  need(ctx, "compliance.home");
  if (!ctx.memberId) fail("Acknowledgments are made by the office's team members.");
  const latest = await latestAttestation(deps, ctx.officeId);
  if (!latest || latest.id !== attestationId) fail("The office's WISP has changed. Open it again and acknowledge the current one.");
  const already = (await deps.repo.listAcks(latest!.id)).find((a) => a.member_id === ctx.memberId);
  if (already) return already;
  const ack = await deps.repo.insertAck({ organization_id: ctx.officeId, attestation_id: latest!.id, member_id: ctx.memberId!, member_name: ctx.name });
  await event(deps, ctx, { entity: "ack", record_id: ack.id, action: "acknowledged", detail: { attestation_id: latest!.id } });
  return ack;
}

// ------------------------------------------------------------------ Form 8879

const locationOf = (raw: unknown): Location8879 => (typeof raw === "string" && raw in LOCATIONS ? (raw as Location8879) : fail("Choose where the signed 8879 is kept."));

export function check8879(raw: Record<string, unknown>) {
  const tax_year = Number(String(raw.tax_year ?? "").trim());
  if (!Number.isInteger(tax_year) || tax_year < 2000 || tax_year > 2100) fail("Enter the tax year.");
  const return_ref = text(raw.return_ref, 80) || fail("Enter the return reference (the software's return or client ID).");
  const taxpayer_name = text(raw.taxpayer_name, 200) || fail("Enter the taxpayer's name.");
  const signed_on = reqDate(raw.signed_on, "The date the signed 8879 went on file");
  const due_date = reqDate(raw.due_date, "The return due date");
  const received_date = optDate(raw.received_date, "The IRS accepted/received date");
  return { tax_year, return_ref, taxpayer_name, signed_on, location: locationOf(raw.location), location_note: text(raw.location_note, 300) || null, due_date, received_date };
}

export async function create8879(deps: ComplianceDeps, ctx: Ctx, raw: Record<string, unknown>): Promise<Form8879> {
  need(ctx, "compliance.8879");
  const f = check8879(raw);
  const returnId = typeof raw.return_id === "string" && UUID.test(raw.return_id) ? raw.return_id : null;
  const documentId = await linkable(deps, ctx, raw.document_id);
  const rec = await deps.repo.insert8879({ organization_id: ctx.officeId, return_id: returnId, ...f, document_id: documentId, created_by: ctx.userId, created_by_name: ctx.name });
  if (documentId) await deps.repo.updateDocument(documentId, { retention_until: rec.retention_until });
  await event(deps, ctx, { entity: "8879", record_id: rec.id, action: "recorded", detail: { tax_year: rec.tax_year, return_ref: rec.return_ref, retention_until: rec.retention_until } });
  return rec;
}

/** A vault file that can be attached to an 8879 record: this office's, finished uploading. */
async function linkable(deps: ComplianceDeps, ctx: Ctx, raw: unknown): Promise<string | null> {
  const id = typeof raw === "string" ? raw : "";
  if (!id) return null;
  const doc = UUID.test(id) ? await deps.repo.getDocument(id) : null;
  if (!doc || doc.organization_id !== ctx.officeId || doc.status !== "stored") fail("That vault file wasn't found.");
  return doc!.id;
}

export async function update8879(deps: ComplianceDeps, ctx: Ctx, id: string, raw: Record<string, unknown>): Promise<Form8879> {
  need(ctx, "compliance.8879");
  const before = await mine(ctx, await deps.repo.get8879(id), "8879 record");
  const f = check8879(raw);
  const documentId = raw.document_id === undefined ? before.document_id : await linkable(deps, ctx, raw.document_id);
  const after = await deps.repo.update8879(id, { ...f, document_id: documentId });
  if (documentId) await deps.repo.updateDocument(documentId, { retention_until: after.retention_until });
  const changed = (Object.keys(f) as (keyof typeof f)[]).filter((k) => (f[k] ?? null) !== (before[k] ?? null));
  if (changed.length || documentId !== before.document_id) await event(deps, ctx, { entity: "8879", record_id: id, action: "edited", detail: { fields: changed, retention_until: after.retention_until, ...(documentId !== before.document_id ? { file: documentId ? "attached" : "removed" } : {}) } });
  return after;
}

/**
 * Deletes an 8879 tracking record. Before the retention end: the "Required by IRS" warning, and the office can still
 * go ahead with a reason that's kept. The vault file is a separate record and is not deleted here.
 */
export async function delete8879(deps: ComplianceDeps, ctx: Ctx, id: string, raw: { reason?: unknown }) {
  need(ctx, "compliance.8879");
  const rec = await mine(ctx, await deps.repo.get8879(id), "8879 record");
  const early = earlyDeletion(rec.retention_until, today(deps));
  const reason = early.early ? overrideReason(raw.reason, early.warning!) : text(raw.reason, 1000) || null;
  await deps.repo.delete8879(id);
  await event(deps, ctx, { entity: "8879", record_id: id, action: early.early ? "deleted_early" : "deleted", reason, detail: { tax_year: rec.tax_year, return_ref: rec.return_ref, retention_until: rec.retention_until, vault_file_kept: Boolean(rec.document_id) } });
  return { early: early.early };
}

// ------------------------------------------------------------------ PTIN

/** "Renewed for [year]": the preparer for themselves, or anyone with compliance management for the team. */
export async function recordRenewal(deps: ComplianceDeps, ctx: Ctx, raw: { memberId: unknown; renewed: unknown; renewedOn: unknown; year?: unknown }) {
  need(ctx, "compliance.home");
  const memberId = String(raw.memberId ?? "");
  const team = await deps.repo.listTeam(ctx.officeId);
  const member = team.find((m) => m.id === memberId) ?? fail("That team member wasn't found.");
  if (member!.id !== ctx.memberId) need(ctx, "compliance.manage");
  const renewed = raw.renewed === true || raw.renewed === "yes" || raw.renewed === "on";
  const season = ptinSeason(today(deps));
  const year = raw.year === undefined ? season.renewalYear : Number(raw.year);
  if (!Number.isInteger(year) || year < season.renewalYear - 1 || year > season.renewalYear) fail("Choose this year's or next year's PTIN.");
  const renewedOn = renewed ? optDate(raw.renewedOn, "The renewal date") ?? today(deps) : null;
  const saved = await deps.repo.saveRenewal({ organization_id: ctx.officeId, member_id: member!.id, renewal_year: year, renewed, renewed_on: renewedOn, recorded_by: ctx.userId });
  await event(deps, ctx, { entity: "ptin", record_id: saved.id, action: renewed ? "ptin_renewed" : "ptin_not_renewed", detail: { member: member!.full_name, year, renewed_on: renewedOn } });
  return saved;
}

// ------------------------------------------------------------------ incidents

/** Anyone on the team can start an incident report. Counts and dates only: never client names or SSNs. */
export async function startIncident(deps: ComplianceDeps, ctx: Ctx, raw: Record<string, unknown>): Promise<Incident> {
  need(ctx, "compliance.home");
  const title = text(raw.title, 200) || fail("Say briefly what happened, for example \"Laptop stolen from car\".");
  const inc = await deps.repo.insertIncident({
    organization_id: ctx.officeId, title, summary: longText(raw.summary, 4000) || null, discovered_on: optDate(raw.discovered_on, "The date it was discovered") ?? today(deps),
    people_affected: peopleOf(raw.people_affected), info_encrypted: encryptedOf(raw.info_encrypted), reported_by: ctx.userId, reported_by_name: ctx.name,
  });
  await event(deps, ctx, { entity: "incident", record_id: inc.id, action: "reported", detail: { title, discovered_on: inc.discovered_on, people_affected: inc.people_affected } });
  return inc;
}

function peopleOf(raw: unknown): number | null {
  const v = String(raw ?? "").replace(/[\s,]/g, "");
  if (!v) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 100_000_000) fail("Enter the number of people affected as a whole number, or leave it blank if not known yet.");
  return n;
}
const encryptedOf = (raw: unknown): Incident["info_encrypted"] => (raw === "yes" || raw === "no" ? raw : "unknown");

export async function updateIncident(deps: ComplianceDeps, ctx: Ctx, id: string, raw: Record<string, unknown>): Promise<Incident> {
  need(ctx, "compliance.incidents");
  const before = await mine(ctx, await deps.repo.getIncident(id), "incident");
  const after = await deps.repo.updateIncident(id, {
    title: text(raw.title, 200) || before.title, summary: longText(raw.summary, 4000) || null,
    discovered_on: optDate(raw.discovered_on, "The date it was discovered") ?? before.discovered_on, people_affected: peopleOf(raw.people_affected),
    info_encrypted: encryptedOf(raw.info_encrypted), irs_notified_on: optDate(raw.irs_notified_on, "The IRS notice date"), ftc_notified_on: optDate(raw.ftc_notified_on, "The FTC notice date"),
  });
  await event(deps, ctx, { entity: "incident", record_id: id, action: "updated", detail: { people_affected: after.people_affected, info_encrypted: after.info_encrypted, irs_notified_on: after.irs_notified_on, ftc_notified_on: after.ftc_notified_on } });
  return after;
}

/** Marks a checklist step done or not needed (with an optional note), or clears it. */
export async function markStep(deps: ComplianceDeps, ctx: Ctx, id: string, raw: { step: unknown; state: unknown; note?: unknown }): Promise<Incident> {
  need(ctx, "compliance.incidents");
  const inc = await mine(ctx, await deps.repo.getIncident(id), "incident");
  const step = INCIDENT_STEPS.find((s) => s.key === raw.step) ?? fail("That step wasn't found.");
  const steps = { ...inc.steps };
  if (raw.state === "clear") delete steps[step!.key];
  else steps[step!.key] = { done_at: nowOf(deps).toISOString(), by: ctx.userId, by_name: ctx.name, note: text(raw.note, 500) || undefined, skipped: raw.state === "skip" || undefined };
  const after = await deps.repo.updateIncident(id, { steps });
  await event(deps, ctx, { entity: "incident", record_id: id, action: raw.state === "clear" ? "step_cleared" : raw.state === "skip" ? "step_skipped" : "step_done", detail: { step: step!.key, title: step!.title, note: text(raw.note, 500) || undefined } });
  return after;
}

/**
 * Closes an incident. With steps still open, or an FTC notice that applies but isn't recorded, the office sees what's
 * missing and can still close it with a reason that is kept.
 */
export async function closeIncident(deps: ComplianceDeps, ctx: Ctx, id: string, raw: { reason?: unknown }) {
  need(ctx, "compliance.incidents");
  const inc = await mine(ctx, await deps.repo.getIncident(id), "incident");
  if (inc.status === "closed") return inc;
  const left = openSteps(inc, today(deps));
  const ftc = ftcDuty(inc, today(deps));
  const missing = [...(ftc.applies && !ftc.done ? ["Required by FTC: the FTC notice isn't recorded."] : []), ...(left.length ? [`${left.length} checklist step${left.length === 1 ? " is" : "s are"} still open.`] : [])];
  const reason = missing.length ? overrideReason(raw.reason, missing.join(" ")) : text(raw.reason, 1000) || null;
  const after = await deps.repo.updateIncident(id, { status: "closed", closed_at: nowOf(deps).toISOString() });
  await event(deps, ctx, { entity: "incident", record_id: id, action: missing.length ? "closed_with_open_items" : "closed", reason, detail: { open_steps: left.map((s) => s.key), ftc_required: ftc.applies, ftc_notified_on: inc.ftc_notified_on } });
  return after;
}

export async function reopenIncident(deps: ComplianceDeps, ctx: Ctx, id: string) {
  need(ctx, "compliance.incidents");
  await mine(ctx, await deps.repo.getIncident(id), "incident");
  const after = await deps.repo.updateIncident(id, { status: "open", closed_at: null });
  await event(deps, ctx, { entity: "incident", record_id: id, action: "reopened" });
  return after;
}

// ------------------------------------------------------------------ office checklist

export async function createItem(deps: ComplianceDeps, ctx: Ctx, raw: Record<string, unknown>) {
  need(ctx, "compliance.manage");
  const item = await deps.repo.insertItem({
    organization_id: ctx.officeId, title: text(raw.title, 200) || fail("Give the item a title."), description: longText(raw.description, 2000) || null,
    due_on: optDate(raw.due_on, "The due date"), repeat: raw.repeat === "yearly" ? "yearly" : "once", created_by: ctx.userId,
  });
  await event(deps, ctx, { entity: "item", record_id: item.id, action: "item_added", detail: { title: item.title, due_on: item.due_on, repeat: item.repeat } });
  return item;
}

export async function updateItem(deps: ComplianceDeps, ctx: Ctx, id: string, raw: Record<string, unknown>) {
  need(ctx, "compliance.manage");
  await mine(ctx, await deps.repo.getItem(id), "item");
  const after = await deps.repo.updateItem(id, { title: text(raw.title, 200) || fail("Give the item a title."), description: longText(raw.description, 2000) || null, due_on: optDate(raw.due_on, "The due date"), repeat: raw.repeat === "yearly" ? "yearly" : "once" });
  await event(deps, ctx, { entity: "item", record_id: id, action: "item_edited", detail: { title: after.title, due_on: after.due_on, repeat: after.repeat } });
  return after;
}

/** Done (who and when). A yearly item then moves its due date a year on. Undo clears it. */
export async function setItemDone(deps: ComplianceDeps, ctx: Ctx, id: string, done: boolean) {
  need(ctx, "compliance.manage");
  const item = await mine(ctx, await deps.repo.getItem(id), "item");
  const patch = done
    ? { done_at: nowOf(deps).toISOString(), done_by: ctx.userId, done_by_name: ctx.name, ...(item.repeat === "yearly" ? { due_on: nextYearlyDue(item.due_on, today(deps)) } : {}) }
    : { done_at: null, done_by: null, done_by_name: null };
  const after = await deps.repo.updateItem(id, patch);
  await event(deps, ctx, { entity: "item", record_id: id, action: done ? "item_done" : "item_reopened", detail: { title: item.title, next_due: after.due_on } });
  return after;
}

export async function deleteItem(deps: ComplianceDeps, ctx: Ctx, id: string) {
  need(ctx, "compliance.manage");
  const item = await mine(ctx, await deps.repo.getItem(id), "item");
  await deps.repo.deleteItem(id);
  await event(deps, ctx, { entity: "item", record_id: id, action: "item_deleted", detail: { title: item.title } });
}

// ------------------------------------------------------------------ status

/** People who should acknowledge and renew: the office's active team members. */
const activeTeam = (team: TeamMember[]) => team.filter((m) => m.status === "active");

export async function officeStatus(deps: ComplianceDeps, officeId: string): Promise<OfficeStatus> {
  const t = today(deps);
  const season = ptinSeason(t);
  const [settingsRow, attestations, team, renewals, incidents, records, items] = await Promise.all([
    deps.repo.getSettings(officeId), deps.repo.listAttestations(officeId), deps.repo.listTeam(officeId), deps.repo.listRenewals(officeId, season.renewalYear),
    deps.repo.listIncidents(officeId), deps.repo.list8879(officeId), deps.repo.listItems(officeId),
  ]);
  const settings = settingsOf(settingsRow);
  const latest = attestations[0] ?? null;
  const people = activeTeam(team);
  const acks = latest ? await deps.repo.listAcks(latest.id) : [];
  const open = incidents.filter((i) => i.status === "open");
  return {
    review: reviewState(latest, t, settings.review_reminder_days),
    acks: { done: people.filter((m) => acks.some((a) => a.member_id === m.id)).length, of: people.length },
    ptin: { inSeason: season.inSeason, year: season.renewalYear, renewed: people.filter((m) => renewals.some((r) => r.member_id === m.id && r.renewed)).length, of: people.length },
    incidents: { open: open.length, ftcOverdue: open.filter((i) => ftcDuty(i, t).overdue).length },
    records8879: count8879(records, t, settings.retention_alert_days),
    items: items.reduce((acc, i) => {
      const st = itemState(i, t).state;
      if (st === "overdue") acc.overdue++;
      if (st === "due_soon") acc.dueSoon++;
      return acc;
    }, { overdue: 0, dueSoon: 0 }),
  };
}

// ------------------------------------------------------------------ reminders

export type SweepResult = { offices: number; sent: number; failed: number; heldBack: number; skipped: number };

/**
 * The daily reminder sweep. WISP review reminders go to the office's EROs at each reminder day and once when overdue;
 * PTIN reminders go, during renewal season, only to team members who haven't recorded a renewal, once per period.
 * Each email is recorded before sending so a rerun never sends it twice. In-app alerts don't depend on email.
 */
export async function runComplianceSweep(deps: ComplianceDeps): Promise<SweepResult> {
  const t = today(deps);
  const result: SweepResult = { offices: 0, sent: 0, failed: 0, heldBack: 0, skipped: 0 };
  const origin = (await deps.origin()).replace(/\/$/, "");
  const offices = (await deps.repo.listOffices()).filter((o) => !o.archived);
  const season = ptinSeason(t);
  for (const office of offices) {
    const team = activeTeam(await deps.repo.listTeam(office.id));
    if (!team.length) continue;
    result.offices++;
    const settings = settingsOf(await deps.repo.getSettings(office.id));
    const latest = await latestAttestation(deps, office.id);
    const review = reviewState(latest, t, settings.review_reminder_days);
    const stage = latest ? reviewReminderStage(review, settings.review_reminder_days) : null;
    if (latest && stage) {
      for (const ero of team.filter((m) => m.role === "ero")) {
        const when = review.days! < 0 ? `was due ${longDate(review.due!)}` : review.days === 0 ? "is due today" : `is due in ${review.days} day${review.days === 1 ? "" : "s"} (${longDate(review.due!)})`;
        await notify(deps, result, office.id, `wisp-review:${latest.id}:${stage}`, ero.email, {
          subject: review.days! < 0 ? `${office.name}: WISP review overdue` : `${office.name}: WISP review ${review.days === 0 ? "due today" : `due in ${review.days} days`}`,
          text: `The annual review of ${office.name}'s written information security plan (WISP) ${when}.\n\nRequired by IRS (Publication 5708) and the FTC Safeguards Rule: review the plan at least once a year. Review it, update it if anything changed, and attest again in the Compliance Center:\n${origin}/office/compliance/wisp\n\nNothing has been locked or changed. This is a reminder.`,
        });
      }
    }
    const period = ptinReminderPeriod(t, settings.ptin_reminder_every_days);
    if (period) {
      const renewals = await deps.repo.listRenewals(office.id, season.renewalYear);
      for (const m of team.filter((p) => !renewals.some((r) => r.member_id === p.id && r.renewed))) {
        const left = daysBetween(t, season.seasonEnd);
        await notify(deps, result, office.id, `ptin:${m.id}:${period}`, m.email, {
          subject: `Renew your PTIN for ${season.renewalYear}`,
          text: `Every PTIN expires December 31. Renewal for ${season.renewalYear} is open now${left >= 0 ? ` (${left} day${left === 1 ? "" : "s"} left)` : ""}.\n\nRenew with the IRS (the renewal asks you to confirm your firm has a written information security plan), then record it in the Compliance Center so these reminders stop:\n${origin}/office/compliance/ptin\n\n${office.name}`,
        });
      }
    }
  }
  return result;
}

async function notify(deps: ComplianceDeps, result: SweepResult, officeId: string, key: string, to: string, mail: { subject: string; text: string }) {
  const claim = await deps.repo.claimNotice({ organization_id: officeId, notice_key: key, recipient: to.toLowerCase() });
  if (!claim) { result.skipped++; return; }
  const problem = await deps.send({ to, subject: mail.subject, text: mail.text, idempotencyKey: `compliance:${createHash("sha256").update(`${deps.tenantId}:${key}:${to}`).digest("hex").slice(0, 32)}` })
    .catch((e: unknown) => (e instanceof Error ? e.message : "The email could not be sent.").slice(0, 300));
  const heldBack = Boolean(problem && problem.startsWith("Not sent"));
  await deps.repo.finishNotice(claim.id, { status: problem ? (heldBack ? "held_back" : "failed") : "sent", attempts: claim.attempts + 1, last_error: problem?.slice(0, 480) ?? null, sent_at: problem ? null : nowOf(deps).toISOString() });
  if (!problem) result.sent++;
  else if (heldBack) result.heldBack++;
  else result.failed++;
}

/** Removes uploads that were started but never finished (older than a day). */
export async function sweepPendingUploads(deps: ComplianceDeps) {
  const stale = await deps.repo.listStalePending(addDays(today(deps), -1));
  for (const d of stale) {
    await deps.store.remove([d.file_path]).catch(() => undefined);
    await deps.repo.deleteDocument(d.id);
  }
  return stale.length;
}
