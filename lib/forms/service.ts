import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { ValidationError } from "../commerce/validation.ts";
import type { CommerceRepo } from "../commerce/types.ts";
import type { CrmSecrets } from "../crm/crypto.ts";
import { DOCUMENT_URL_SECONDS } from "../documents/files.ts";
import { isSignaturePng } from "../documents/signing.ts";
import type { TenantProfile } from "../documents/types.ts";
import { checkTheme, type FormTheme } from "./theme.ts";
import { answerText, checkAnswers, draftAnswers, type AddressAnswer, type Answers } from "./answers.ts";
import { allFields, checkDefinition, checkPublishable, DefinitionError, DISPLAY_TYPES, emptyDefinition, hasSignature, inputFields, MAX_FILE_BYTES, MAX_SUBMISSION_FILE_BYTES, type Field, type FormDefinition } from "./definition.ts";
import { buildFirmPayload, efinFrom } from "./firm.ts";
import { checkUpload, cleanUploadName, kindOfContentType, sha256Hex, UPLOAD_CONTENT_TYPES } from "./files.ts";
import { evaluate, type RawAnswers } from "./logic.ts";
import { buildSubmissionPdf, type PdfAttachment, type PdfSection } from "./pdf.ts";
import { checkSettings, DEFAULT_SETTINGS, readSettings, respondentKeys, settingsProblems, type FormSettings } from "./settings.ts";
import { effectiveBrand, type Brand } from "../brands.ts";
import type { FirmsRepo, FormRow, FormsRepo, FormStores, FormVersion, SealedAnswer, SignatureRecord, StoredAnswers, Submission, SubmissionStatus, UploadRow } from "./types.ts";

// The Form Builder for one tenant. Every storage path starts with the tenant id and is built here from rows the
// tenant can see; signed links are only ever made for paths inside the tenant's own folder.

export type FormDeps = {
  tenantId: string;
  repo: FormsRepo;
  stores: FormStores;
  firms: FirmsRepo | null;
  commerce: Pick<CommerceRepo, "findCustomerByEmail" | "createCustomer" | "getCustomer">;
  /** Encryption for sensitive answers and identifier hashes (MONARCH_ENCRYPTION_KEY). */
  secrets: CrmSecrets;
  /** Secret for public tokens (start stamps). */
  linkKey: Buffer;
  profile: () => Promise<TenantProfile | null>;
  /** The tenant's firms/brands (connected sending domains) and which brand each verified sender belongs to. */
  brandCatalog?: () => Promise<{ brands: Brand[]; senderDomain: Record<string, string> }>;
  /** Adds a respondent to Leads (source: the form's name). Wired on the server; absent in tests. */
  addLead?: (input: { formName: string; name: string | null; email: string }) => Promise<unknown>;
  now?: () => Date;
};

const catalogOf = async (deps: FormDeps) => (deps.brandCatalog ? deps.brandCatalog().catch(() => ({ brands: [], senderDomain: {} })) : { brands: [] as Brand[], senderDomain: {} as Record<string, string> });

/** The brand a form belongs to (the one chosen, or the only one), or null. */
export async function brandFor(deps: FormDeps, settings: FormSettings): Promise<Brand | null> {
  return effectiveBrand(settings.brand_domain_id, (await catalogOf(deps)).brands);
}

export const DRAFT_HOURS = 24;
export const SAVED_DRAFT_DAYS = 30;
export const RECEIPT_MINUTES = 60;
export const MIN_FILL_SECONDS = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN = /^[A-Za-z0-9_-]{40,60}$/;
const nowOf = (d: FormDeps) => (d.now ? d.now() : new Date());
const iso = (d: FormDeps) => nowOf(d).toISOString();
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

/** Answers the respondent must fix, by question key. */
export class SubmissionInvalid extends ValidationError {
  errors: Record<string, string>;
  constructor(errors: Record<string, string>) {
    super(Object.values(errors)[0] ?? "Check your answers.");
    this.errors = errors;
  }
}

// ------------------------------------------------------------------ paths

function ownPath(deps: FormDeps, path: string): string {
  if (!UUID.test(deps.tenantId) || !path.startsWith(`${deps.tenantId}/`) || path.includes("..")) throw new Error("Refused: that file is not in this tenant's folder.");
  return path;
}
const uploadPath = (deps: FormDeps, formId: string, submissionId: string, uploadId: string) => `${deps.tenantId}/forms/${formId}/${submissionId}/${uploadId}`;
const pdfPath = (deps: FormDeps, submissionId: string) => `${deps.tenantId}/submissions/${submissionId}.pdf`;

const PUBLIC_ID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
export function newPublicId(): string {
  const bytes = randomBytes(16);
  return Array.from(bytes, (b) => PUBLIC_ID_CHARS[b % PUBLIC_ID_CHARS.length]).join("");
}
export const isPublicId = (v: string) => /^[A-Za-z0-9]{16}$/.test(v);

/** Today in the firm's time zone, as YYYY-MM-DD. */
export function todayIn(timeZone: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

async function event(deps: FormDeps, formId: string | null, submissionId: string | null, type: string, actorId: string | null, detail: Record<string, unknown> = {}) {
  await deps.repo.addEvent({ form_id: formId, submission_id: submissionId, type, actor_id: actorId, detail });
}

// ---------------------------------------------------------------- sealing

const sealAad = (deps: FormDeps, submissionId: string, key: string) => `form-answer:${deps.tenantId}:${submissionId}:${key}`;
const isSealed = (v: unknown): v is SealedAnswer => !!v && typeof v === "object" && !Array.isArray(v) && typeof (v as SealedAnswer).sealed === "string";
const last4 = (v: string) => v.replace(/[^A-Za-z0-9]/g, "").slice(-4);

function seal(deps: FormDeps, def: FormDefinition, submissionId: string, answers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...answers };
  for (const f of inputFields(def)) {
    const v = out[f.key];
    if (f.sensitive && typeof v === "string" && v) out[f.key] = { sealed: deps.secrets.encrypt(v, sealAad(deps, submissionId, f.key)), last4: last4(v) } satisfies SealedAnswer;
  }
  return out;
}

/** The answers with sensitive values decrypted. Only for server use: workflows, firm records, an administrator's reveal. */
export function openAnswers(deps: FormDeps, submission: Pick<Submission, "id" | "answers">): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(submission.answers ?? {})) {
    if (isSealed(v)) {
      try {
        out[k] = deps.secrets.decrypt(v.sealed, sealAad(deps, submission.id, k));
      } catch {
        out[k] = "";
      }
    } else out[k] = v;
  }
  return out;
}

/** An answer for display: sensitive values masked to their last four characters. */
export function displayAnswer(field: Field, value: StoredAnswers[string] | undefined, uploads: UploadRow[] = []): string {
  if (value === undefined || value === null) return "";
  if (isSealed(value)) return `•••• ${value.last4}`;
  if (field.type === "file" && Array.isArray(value)) return value.map((id) => uploads.find((u) => u.id === id)?.file_name ?? "file").join(", ");
  return answerText(field, value as Answers[string]);
}

// ------------------------------------------------------------------ admin

const cleanName = (v: string) => v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);

export async function createForm(deps: FormDeps, input: { name: string; description?: string | null; brandDomainId?: string | null; addToLeads?: boolean; adminId: string }): Promise<FormRow> {
  const name = cleanName(input.name);
  if (name.length < 2) throw new ValidationError("Give the form a name.");
  // With several firms/brands the form must say which one it belongs to; with one, that one is used.
  const { brands } = await catalogOf(deps);
  let brandId: string | null = null;
  if (brands.length === 1) brandId = brands[0].id;
  else if (brands.length > 1) {
    brandId = brands.find((b) => b.id === input.brandDomainId)?.id ?? null;
    if (!brandId) throw new ValidationError("Choose which firm this form belongs to.");
  }
  const form = await deps.repo.insertForm({ name, description: input.description?.trim().slice(0, 1000) || null, public_id: newPublicId(), draft_definition: emptyDefinition(), settings: { ...DEFAULT_SETTINGS, add_to_leads: input.addToLeads === true, brand_domain_id: brandId }, created_by: input.adminId });
  await event(deps, form.id, null, "created", input.adminId);
  return form;
}

export async function duplicateForm(deps: FormDeps, formId: string, adminId: string): Promise<FormRow> {
  const src = await mustForm(deps, formId);
  const copy = await deps.repo.insertForm({
    name: cleanName(`Copy of ${src.name}`), description: src.description, public_id: newPublicId(), draft_definition: src.draft_definition,
    settings: readSettings(src.settings), signature_consent: src.signature_consent, created_by: adminId,
  });
  await event(deps, copy.id, null, "created", adminId, { copied_from: src.id });
  return copy;
}

async function mustForm(deps: FormDeps, id: string): Promise<FormRow> {
  const form = UUID.test(id) ? await deps.repo.getForm(id) : null;
  if (!form) throw new ValidationError("Form not found.");
  return form;
}

/** A light shape check, so an unfinished draft can still be autosaved. Publishing runs the full check. */
function looseDefinition(raw: unknown): FormDefinition {
  const r = raw as FormDefinition;
  if (!r || typeof r !== "object" || !Array.isArray(r.pages) || !Array.isArray(r.rules)) throw new ValidationError("The form could not be saved: its layout is not readable.");
  const json = JSON.stringify(r);
  if (json.length > 600_000) throw new ValidationError("The form is too large to save.");
  return { version: 1, pages: r.pages, rules: r.rules };
}

/** Autosave. Always stores the draft; returns what still needs fixing before it can be published. */
export async function saveDraft(deps: FormDeps, formId: string, raw: unknown, adminId: string): Promise<{ savedAt: string; problem: { message: string; target?: string } | null }> {
  const form = await mustForm(deps, formId);
  if (form.status === "archived") throw new ValidationError("This form is archived. Restore it to edit it.");
  let def: FormDefinition;
  let problem: { message: string; target?: string } | null = null;
  try {
    def = checkDefinition(raw);
  } catch (e) {
    if (!(e instanceof DefinitionError)) throw e;
    def = looseDefinition(raw);
    problem = { message: e.message, target: e.target };
  }
  const savedAt = iso(deps);
  await deps.repo.updateForm(form.id, { draft_definition: def, draft_updated_at: savedAt });
  void adminId;
  return { savedAt, problem };
}

export async function publishForm(deps: FormDeps, formId: string, adminId: string): Promise<FormVersion> {
  const form = await mustForm(deps, formId);
  if (form.status === "archived") throw new ValidationError("This form is archived. Restore it before publishing.");
  let def: FormDefinition;
  try {
    def = checkDefinition(form.draft_definition);
    checkPublishable(def);
  } catch (e) {
    if (e instanceof DefinitionError) throw new ValidationError(e.message);
    throw e;
  }
  if (hasSignature(def) && !form.signature_consent) throw new ValidationError("This form has a signature field. Write your signing consent statement in Settings first.");
  const catalog = await catalogOf(deps);
  const problems = settingsProblems(readSettings(form.settings), def, { brandIds: catalog.brands.map((b) => b.id), senderDomain: catalog.senderDomain });
  if (problems.length) throw new ValidationError(`${problems[0]} (Settings)`);
  const versions = await deps.repo.listVersions(form.id);
  const version = await deps.repo.insertVersion({ form_id: form.id, version: versions.reduce((n, v) => Math.max(n, v.version), 0) + 1, definition: def, published_by: adminId });
  await deps.repo.updateForm(form.id, { current_version_id: version.id, status: "published" });
  await event(deps, form.id, null, "published", adminId, { version: version.version });
  return version;
}

export async function setFormStatus(deps: FormDeps, formId: string, to: "closed" | "published" | "archived" | "restore", adminId: string): Promise<FormRow> {
  const form = await mustForm(deps, formId);
  let status: FormRow["status"];
  if (to === "restore") status = form.current_version_id ? "closed" : "draft";
  else if (to === "published") {
    if (!form.current_version_id) throw new ValidationError("Publish the form first.");
    if (form.status === "archived") throw new ValidationError("Restore the form first.");
    status = "published";
  } else status = to;
  const updated = await deps.repo.updateForm(form.id, { status });
  await event(deps, form.id, null, to === "published" ? "reopened" : to === "restore" ? "restored" : to, adminId);
  return updated;
}

/** Forms that were never submitted can be deleted (with any drafts); others are archived. */
export async function removeForm(deps: FormDeps, formId: string, adminId: string): Promise<"deleted" | "archived"> {
  const form = await mustForm(deps, formId);
  if ((await deps.repo.countSubmitted(form.id)) > 0) {
    await setFormStatus(deps, form.id, "archived", adminId);
    return "archived";
  }
  const drafts = await deps.repo.listSubmissions(form.id, { status: "draft", limit: 1000, includeTests: true });
  await removeSubmissions(deps, drafts.rows);
  await deps.repo.updateForm(form.id, { current_version_id: null });
  await deps.repo.deleteForm(form.id);
  return "deleted";
}

/** The definition the settings page checks against: the draft when it is readable, else the published one. */
async function settingsDefinition(deps: FormDeps, form: FormRow): Promise<FormDefinition> {
  try {
    return checkDefinition(form.draft_definition);
  } catch {
    const v = form.current_version_id ? await deps.repo.getVersion(form.current_version_id) : null;
    return v?.definition ?? emptyDefinition();
  }
}

export async function saveSettings(deps: FormDeps, formId: string, raw: unknown, senderIds: string[], adminId: string): Promise<FormSettings> {
  const form = await mustForm(deps, formId);
  let settings: FormSettings;
  try {
    const catalog = await catalogOf(deps);
    // The settings page doesn't send the look of the form; keep it as it was.
    const given = (raw ?? {}) as Record<string, unknown>;
    settings = checkSettings({ ...given, theme: given.theme ?? readSettings(form.settings).theme }, await settingsDefinition(deps, form), senderIds, { brandIds: catalog.brands.map((b) => b.id), senderDomain: catalog.senderDomain });
  } catch (e) {
    throw new ValidationError(e instanceof Error ? e.message : "Those settings could not be saved.");
  }
  await deps.repo.updateForm(form.id, { settings });
  await event(deps, form.id, null, "settings_saved", adminId);
  return settings;
}

/** Saves how the public form looks (colours, font, images, custom CSS). Checked; the rest of the settings are kept. */
export async function saveTheme(deps: FormDeps, formId: string, raw: unknown, adminId: string): Promise<FormSettings> {
  const form = await mustForm(deps, formId);
  let theme: FormTheme;
  try {
    theme = checkTheme(raw);
  } catch (e) {
    throw new ValidationError(e instanceof Error ? e.message : "That look could not be saved.");
  }
  const settings = { ...readSettings(form.settings), theme };
  await deps.repo.updateForm(form.id, { settings });
  await event(deps, form.id, null, "theme_saved", adminId);
  return settings;
}

export async function saveFormDetails(deps: FormDeps, formId: string, input: { name: string; description: string; consent: string }, adminId: string) {
  const form = await mustForm(deps, formId);
  const name = cleanName(input.name);
  if (name.length < 2) throw new ValidationError("Give the form a name.");
  const consent = input.consent.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, 5000);
  if (consent && consent.length < 20) throw new ValidationError("Write the full consent statement the signer agrees to (at least 20 characters).");
  await deps.repo.updateForm(form.id, { name, description: input.description.trim().slice(0, 1000) || null, signature_consent: consent || null });
  if ((consent || null) !== form.signature_consent) await event(deps, form.id, null, "consent_updated", adminId);
}

// --------------------------------------------------------------- public form

export type PublicState = "open" | "closed" | "not_found";
export type PublicForm = { form: FormRow; version: FormVersion; settings: FormSettings; state: PublicState };

/** The live form behind a public link, and whether it is taking submissions right now. */
export async function publicForm(deps: FormDeps, publicId: string): Promise<PublicForm | null> {
  if (!isPublicId(publicId)) return null;
  const form = await deps.repo.getFormByPublicId(publicId);
  if (!form || !form.current_version_id || form.status === "draft" || form.status === "archived") return null;
  const version = await deps.repo.getVersion(form.current_version_id);
  if (!version) return null;
  const settings = readSettings(form.settings);
  let state: PublicState = form.status === "published" ? "open" : "closed";
  if (state === "open" && settings.close_at && Date.parse(settings.close_at) <= nowOf(deps).getTime()) state = "closed";
  if (state === "open" && settings.max_submissions && (await deps.repo.countSubmitted(form.id)) >= settings.max_submissions) state = "closed";
  return { form, version, settings, state };
}

/** A signed time stamp given out with the page, so a submission made faster than a person could fill it is marked spam. */
export function startStamp(deps: FormDeps, formId: string): string {
  const t = String(nowOf(deps).getTime());
  return `${t}.${createHmac("sha256", deps.linkKey).update(`form-start:${formId}:${t}`).digest("base64url").slice(0, 22)}`;
}
export function stampAge(deps: FormDeps, formId: string, stamp: string): number | null {
  const [t, mac] = stamp.split(".");
  if (!/^\d{10,16}$/.test(t ?? "") || !mac) return null;
  const want = createHmac("sha256", deps.linkKey).update(`form-start:${formId}:${t}`).digest("base64url").slice(0, 22);
  if (want.length !== mac.length || !timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return null;
  return (nowOf(deps).getTime() - Number(t)) / 1000;
}

type Visitor = { ipHash: string | null; userAgent: string | null };

async function draftFor(deps: FormDeps, pf: PublicForm, token: string | null): Promise<Submission | null> {
  if (!token) return null;
  if (!TOKEN.test(token)) throw new ValidationError("This saved form link is not valid.");
  const draft = await deps.repo.findDraftByTokenHash(hashToken(token));
  if (!draft || draft.form_id !== pf.form.id || draft.status !== "draft") throw new ValidationError("This saved form is no longer available. Start the form again.");
  if (draft.draft_expires_at && Date.parse(draft.draft_expires_at) < nowOf(deps).getTime()) throw new ValidationError("This saved form has expired. Start the form again.");
  return draft;
}

/** The respondent's draft, created on first need (an upload, or saving for later). */
async function ensureDraft(deps: FormDeps, pf: PublicForm, token: string | null, who: Visitor): Promise<{ draft: Submission; token: string }> {
  const existing = await draftFor(deps, pf, token);
  if (existing && token) return { draft: existing, token };
  const fresh = newToken();
  const draft = await deps.repo.insertSubmission({
    id: randomUUID(), form_id: pf.form.id, version_id: pf.version.id, status: "draft", is_test: false, answers: {}, started_at: iso(deps),
    draft_token_hash: hashToken(fresh), draft_expires_at: new Date(nowOf(deps).getTime() + DRAFT_HOURS * 3_600_000).toISOString(), ip_hash: who.ipHash, user_agent: who.userAgent,
  });
  return { draft, token: fresh };
}

function mustOpen(pf: PublicForm | null): PublicForm {
  if (!pf) throw new ValidationError("This form link is not valid.");
  if (pf.state !== "open") throw new ValidationError(pf.settings.closed_message);
  return pf;
}

const fieldByKey = (def: FormDefinition, key: string) => allFields(def).find((f) => f.key === key);

/** A one-time upload link for one file of a file question. The file is checked by content when the form is submitted. */
export async function startUpload(deps: FormDeps, publicId: string, input: { token: string | null; fieldKey: string; fileName: string; sizeBytes: number }, who: Visitor) {
  const pf = mustOpen(await publicForm(deps, publicId));
  const field = fieldByKey(pf.version.definition, input.fieldKey);
  if (!field || field.type !== "file") throw new ValidationError("That question does not take files.");
  const { fileName, kind } = cleanUploadName(input.fileName, field.fileTypes ?? ["pdf"]);
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) throw new ValidationError("The file is empty.");
  if (input.sizeBytes > MAX_FILE_BYTES) throw new ValidationError("Files can be at most 10 MB.");
  const { draft, token } = await ensureDraft(deps, pf, input.token, who);
  const uploads = (await deps.repo.listUploads(draft.id)).filter((u) => u.status !== "rejected");
  if (uploads.filter((u) => u.field_key === field.key && u.kind === "file").length >= (field.maxFiles ?? 1) + 5) throw new ValidationError("Too many files for this question. Remove one first.");
  if (uploads.length >= 40 || uploads.reduce((n, u) => n + u.size_bytes, 0) + input.sizeBytes > MAX_SUBMISSION_FILE_BYTES) throw new ValidationError("This submission has reached its file limit (60 MB in all).");
  const id = randomUUID();
  const upload = await deps.repo.insertUpload({ form_id: pf.form.id, submission_id: draft.id, field_key: field.key, kind: "file", storage_path: uploadPath(deps, pf.form.id, draft.id, id), file_name: fileName, content_type: UPLOAD_CONTENT_TYPES[kind], size_bytes: input.sizeBytes });
  const { url } = await deps.stores.uploads.createUploadUrl(ownPath(deps, upload.storage_path));
  return { uploadId: upload.id, uploadUrl: url, contentType: upload.content_type, token, fileName };
}

/** Removes a not-yet-submitted upload from the respondent's draft. */
export async function removeUpload(deps: FormDeps, publicId: string, token: string, uploadId: string) {
  const pf = mustOpen(await publicForm(deps, publicId));
  const draft = await draftFor(deps, pf, token);
  const upload = UUID.test(uploadId) ? await deps.repo.getUpload(uploadId) : null;
  if (!draft || !upload || upload.submission_id !== draft.id || upload.status === "attached") return;
  await deps.stores.uploads.remove([ownPath(deps, upload.storage_path)]).catch(() => undefined);
  await deps.repo.deleteUploads([upload.id]);
}

/** Save and continue later: keeps the answers for 30 days and returns the resume token for the emailed link. */
export async function saveForLater(deps: FormDeps, publicId: string, input: { token: string | null; answers: RawAnswers; email: string }, who: Visitor): Promise<{ token: string; draft: Submission; pf: PublicForm }> {
  const pf = mustOpen(await publicForm(deps, publicId));
  if (!pf.settings.allow_save_later) throw new ValidationError("This form can't be saved for later.");
  const email = input.email.trim().toLowerCase().slice(0, 254);
  if (!/^[^\s@<>]+@[^\s@<>]+\.[A-Za-z]{2,}$/.test(email)) throw new ValidationError("Enter the email address to send your link to.");
  const { draft, token } = await ensureDraft(deps, pf, input.token, who);
  const answers = seal(deps, pf.version.definition, draft.id, draftAnswers(pf.version.definition, input.answers));
  const saved = await deps.repo.updateSubmission(draft.id, { answers: answers as RawAnswers, resume_email: email, resume_sent_at: iso(deps), draft_expires_at: new Date(nowOf(deps).getTime() + SAVED_DRAFT_DAYS * 86_400_000).toISOString() });
  await event(deps, pf.form.id, draft.id, "draft_saved", null);
  return { token, draft: saved, pf };
}

/** Opens a saved draft: the answers so far (sensitive ones decrypted for the respondent) and their uploads. */
export async function resumeDraft(deps: FormDeps, pf: PublicForm, token: string): Promise<{ answers: RawAnswers; token: string } | null> {
  let draft: Submission | null;
  try {
    draft = await draftFor(deps, pf, token);
  } catch {
    return null;
  }
  if (!draft) return null;
  const answers = openAnswers(deps, draft) as RawAnswers;
  const uploads = await deps.repo.listUploads(draft.id);
  for (const f of inputFields(pf.version.definition)) {
    if (f.type !== "file") continue;
    const ids = Array.isArray(answers[f.key]) ? (answers[f.key] as { id: string }[]).map((x) => (typeof x === "string" ? x : x.id)) : [];
    answers[f.key] = uploads.filter((u) => u.kind === "file" && u.status !== "rejected" && ids.includes(u.id)).map((u) => ({ id: u.id, name: u.file_name }));
  }
  return { answers, token };
}

export type SignatureInput = { consent: boolean; signedName: string; method: "typed" | "drawn"; typed?: string; png?: Uint8Array };
export type SubmitInput = { token: string | null; answers: RawAnswers; signature: SignatureInput | null; honeypot: string; stamp: string; isTest?: boolean };

/**
 * Submits a form. The answers are checked against the published version (hidden and skipped questions dropped),
 * uploads are checked by content, sensitive answers are encrypted, and the submission is numbered and locked.
 * Suspected spam is kept and marked, so nothing is lost silently. Follow-ups (PDF, emails, records, workflows)
 * run afterwards and never undo the submission.
 */
export async function submitForm(deps: FormDeps, publicId: string, input: SubmitInput, who: Visitor): Promise<{ submission: Submission; receiptToken: string; pf: PublicForm }> {
  const pf = await publicForm(deps, publicId);
  if (!pf) throw new ValidationError("This form link is not valid.");
  if (pf.state !== "open" && !input.isTest) throw new ValidationError(pf.settings.closed_message);
  const def = pf.version.definition;
  const profile = await deps.profile();
  const now = nowOf(deps);
  const today = todayIn(profile?.time_zone ?? "America/New_York", now);

  let spam: string | null = null;
  if (input.honeypot.trim()) spam = "hidden field filled in";
  const age = stampAge(deps, pf.form.id, input.stamp);
  if (!input.isTest && (age === null || age < MIN_FILL_SECONDS)) spam ??= age === null ? "missing start stamp" : "submitted too fast";

  const sig = input.signature;
  const checked = checkAnswers(def, input.answers, { today, signed: !!sig });
  const errors = { ...checked.errors };
  let signature: SignatureRecord | null = null;
  const sigField = inputFields(def).find((f) => f.type === "signature");
  if (sig && checked.signatureVisible && sigField) {
    if (!pf.form.signature_consent) throw new ValidationError("This form can't be signed right now. Please contact the sender.");
    const name = sig.signedName.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
    if (!sig.consent) errors[sigField.key] = "Tick the box to agree to sign electronically.";
    else if (name.length < 2) errors[sigField.key] = "Type your full name to sign.";
    else if (sig.method === "typed" && (sig.typed ?? "").trim().length < 2) errors[sigField.key] = "Type your signature.";
    else if (sig.method === "drawn" && !(sig.png && isSignaturePng(sig.png))) errors[sigField.key] = "Draw your signature in the box, or type it instead.";
    else signature = sig.method === "typed" ? { method: "typed", signed_name: name, typed: (sig.typed ?? "").trim().slice(0, 120) } : { method: "drawn", signed_name: name };
  }

  // Uploads: each must belong to this respondent's draft and question, and pass the content check.
  const draft = await draftFor(deps, pf, input.token);
  const uploads = draft ? await deps.repo.listUploads(draft.id) : [];
  const attached: UploadRow[] = [];
  for (const f of inputFields(def).filter((x) => x.type === "file")) {
    const ids = checked.answers[f.key];
    if (!Array.isArray(ids)) continue;
    for (const id of ids) {
      const u = uploads.find((x) => x.id === id && x.field_key === f.key && x.kind === "file" && x.status !== "rejected");
      if (!u) {
        errors[f.key] = `${f.label}: a file did not finish uploading. Remove it and upload it again.`;
        break;
      }
      if (u.status === "pending") {
        const bytes = await deps.stores.uploads.download(ownPath(deps, u.storage_path));
        const kind = kindOfContentType(u.content_type);
        let problem: string | null = null;
        if (!bytes) problem = "did not finish uploading";
        else if (bytes.byteLength !== u.size_bytes) problem = "arrived incomplete";
        else {
          try {
            await checkUpload(bytes, kind ?? "pdf");
          } catch (e) {
            problem = e instanceof ValidationError ? e.message : "could not be read";
          }
        }
        if (problem) {
          await deps.repo.updateUpload(u.id, { status: "rejected" });
          await deps.stores.uploads.remove([ownPath(deps, u.storage_path)]).catch(() => undefined);
          errors[f.key] = `${f.label}: "${u.file_name}" ${/^[A-Z]/.test(problem) ? `was not accepted. ${problem}` : problem}. Upload it again.`;
          break;
        }
        attached.push(await deps.repo.updateUpload(u.id, { status: "attached", sha256: sha256Hex(bytes!) }));
      } else attached.push(u);
    }
  }
  if (Object.keys(errors).length) throw new SubmissionInvalid(errors);

  const id = draft?.id ?? randomUUID();
  // A drawn signature is kept as its own file next to the uploads.
  if (signature?.method === "drawn" && sig?.png) {
    const sigId = randomUUID();
    const path = uploadPath(deps, pf.form.id, id, sigId);
    if (!draft) {
      // No draft yet: create the row first so the signature file has a submission to belong to.
      await deps.repo.insertSubmission({ id, form_id: pf.form.id, version_id: pf.version.id, status: "draft", is_test: !!input.isTest, answers: {}, started_at: iso(deps), ip_hash: who.ipHash, user_agent: who.userAgent, draft_expires_at: new Date(now.getTime() + DRAFT_HOURS * 3_600_000).toISOString() });
    }
    await deps.stores.uploads.upload(ownPath(deps, path), sig.png, "image/png");
    const row = await deps.repo.insertUpload({ form_id: pf.form.id, submission_id: id, field_key: sigField!.key, kind: "signature", storage_path: path, file_name: "signature.png", content_type: "image/png", size_bytes: sig.png.byteLength });
    await deps.repo.updateUpload(row.id, { status: "attached", sha256: sha256Hex(sig.png) });
    signature.upload_id = row.id;
  }

  const settings = pf.settings;
  const opened = checked.answers;
  const respondent = respondentKeys(settings, def);
  const email = respondent.email_key && typeof opened[respondent.email_key] === "string" ? (opened[respondent.email_key] as string) : null;
  const name = respondent.name_key && typeof opened[respondent.name_key] === "string" ? (opened[respondent.name_key] as string).slice(0, 200) : null;
  const number = await deps.repo.takeNumber(pf.form.id);
  const receiptToken = newToken();
  const patch = {
    status: (spam ? "spam" : "new") as SubmissionStatus,
    is_test: !!input.isTest,
    version_id: pf.version.id,
    number,
    answers: seal(deps, def, id, opened) as StoredAnswers,
    respondent_email: email,
    respondent_name: name ?? signature?.signed_name ?? null,
    submitted_at: now.toISOString(),
    ip_hash: who.ipHash,
    user_agent: who.userAgent,
    consent_text: signature ? pf.form.signature_consent : null,
    consented_at: signature ? now.toISOString() : null,
    signature,
    draft_token_hash: null,
    draft_expires_at: null,
    receipt_token_hash: hashToken(receiptToken),
    receipt_expires_at: new Date(now.getTime() + RECEIPT_MINUTES * 60_000).toISOString(),
    spam_reason: spam,
  };
  let submission: Submission | null;
  const existing = draft ?? (signature?.method === "drawn" ? await deps.repo.getSubmission(id) : null);
  if (existing) {
    submission = await deps.repo.transitionSubmission(id, ["draft"], patch);
    if (!submission) throw new ValidationError("This form was already submitted.");
  } else {
    submission = await deps.repo.insertSubmission({ id, form_id: pf.form.id, started_at: iso(deps), ...patch });
  }
  // Files uploaded to the draft but not part of the final answers are discarded.
  const leftovers = uploads.filter((u) => u.kind === "file" && !attached.some((a) => a.id === u.id));
  if (leftovers.length) {
    await deps.stores.uploads.remove(leftovers.map((u) => ownPath(deps, u.storage_path))).catch(() => undefined);
    await deps.repo.deleteUploads(leftovers.map((u) => u.id));
  }
  await event(deps, pf.form.id, submission.id, spam ? "spam" : "submitted", null, { number, ...(spam ? { reason: spam } : {}), ...(input.isTest ? { test: true } : {}) });
  return { submission, receiptToken, pf };
}

// --------------------------------------------------------------------- PDF

/** The answers by page and section, as the respondent saw them (hidden and skipped questions are not included). */
/**
 * The questions the respondent saw, worked out again from the stored answers with the same show/hide and skip logic.
 * Unanswered optional questions they saw are included (shown as "no answer"); hidden and skipped ones are not.
 */
export function seenFieldIds(def: FormDefinition, answers: StoredAnswers): Set<string> {
  const raw: RawAnswers = {};
  for (const [k, v] of Object.entries(answers ?? {})) raw[k] = isSealed(v) ? "(sealed)" : (v as RawAnswers[string]);
  return evaluate(def, raw).visible;
}

export function answerSections(def: FormDefinition, answers: StoredAnswers, uploads: UploadRow[]): PdfSection[] {
  const out: PdfSection[] = [];
  const seen = seenFieldIds(def, answers);
  for (const page of def.pages) {
    for (const [si, s] of page.sections.entries()) {
      const rows = s.fields
        .filter((f) => !DISPLAY_TYPES.includes(f.type) && f.type !== "signature" && (answers[f.key] !== undefined || seen.has(f.id)))
        .map((f) => ({ label: f.label || f.key, value: displayAnswer(f, answers[f.key], uploads) }));
      if (!rows.length) continue;
      out.push({ title: s.title || (si === 0 && def.pages.length > 1 ? page.title : ""), rows });
    }
  }
  return out;
}

/** Makes (or remakes) the submission PDF and files it in the tenant's document storage. */
export async function makePdf(deps: FormDeps, submissionId: string): Promise<Submission> {
  const sub = await deps.repo.getSubmission(submissionId);
  if (!sub || sub.status === "draft" || !sub.number || !sub.submitted_at) throw new ValidationError("Submission not found.");
  const form = await deps.repo.getForm(sub.form_id);
  const version = await deps.repo.getVersion(sub.version_id);
  if (!form || !version) throw new Error("The form or its version is missing.");
  const profile = await deps.profile();
  const uploads = (await deps.repo.listUploads(sub.id)).filter((u) => u.status === "attached");
  const fields = new Map(inputFields(version.definition).map((f) => [f.key, f]));
  const attachments: PdfAttachment[] = [];
  for (const f of inputFields(version.definition).filter((x) => x.type === "file")) {
    const ids = sub.answers[f.key];
    if (!Array.isArray(ids)) continue;
    for (const id of ids) {
      const u = uploads.find((x) => x.id === id);
      if (!u) continue;
      const bytes = await deps.stores.uploads.download(ownPath(deps, u.storage_path));
      if (!bytes) throw new Error(`An uploaded file is missing from storage (${u.file_name}).`);
      attachments.push({ fieldLabel: fields.get(f.key)?.label ?? f.key, fileName: u.file_name, sizeBytes: u.size_bytes, sha256: u.sha256 ?? sha256Hex(bytes), kind: kindOfContentType(u.content_type) ?? "pdf", bytes });
    }
  }
  let png: Uint8Array | undefined;
  if (sub.signature?.method === "drawn" && sub.signature.upload_id) {
    const u = uploads.find((x) => x.id === sub.signature!.upload_id);
    png = u ? (await deps.stores.uploads.download(ownPath(deps, u.storage_path))) ?? undefined : undefined;
  }
  const bytes = await buildSubmissionPdf({
    firmName: profile?.display_name ?? "Tax office",
    formName: form.name,
    formVersion: version.version,
    number: sub.number,
    submissionId: sub.id,
    isTest: sub.is_test,
    timeZone: profile?.time_zone ?? "America/New_York",
    startedAt: new Date(sub.started_at),
    submittedAt: new Date(sub.submitted_at),
    generatedAt: nowOf(deps),
    respondent: [sub.respondent_name, sub.respondent_email].filter(Boolean).join(" · ") || null,
    sections: answerSections(version.definition, sub.answers as StoredAnswers, uploads),
    attachments,
    signature: sub.signature
      ? { method: sub.signature.method, typed: sub.signature.typed, png, signedName: sub.signature.signed_name, consentText: sub.consent_text ?? "", consentedAt: new Date(sub.consented_at ?? sub.submitted_at), ipHash: sub.ip_hash, userAgent: sub.user_agent }
      : null,
  });
  const path = pdfPath(deps, sub.id);
  await deps.stores.pdfs.remove([ownPath(deps, path)]).catch(() => undefined);
  await deps.stores.pdfs.upload(ownPath(deps, path), bytes, "application/pdf");
  const sha = sha256Hex(bytes);
  const done = await deps.repo.updateSubmission(sub.id, { pdf_path: path, pdf_sha256: sha, pdf_generated_at: iso(deps), pdf_error: null, pdf_attempts: sub.pdf_attempts + 1 });
  await event(deps, sub.form_id, sub.id, sub.pdf_sha256 ? "pdf_remade" : "pdf_made", null, { sha256: sha, ...(sub.pdf_sha256 ? { previous_sha256: sub.pdf_sha256 } : {}) });
  return done;
}

/** makePdf that records a failure instead of throwing; the scheduled job retries. */
export async function makePdfSafe(deps: FormDeps, submissionId: string): Promise<Submission | null> {
  try {
    return await makePdf(deps, submissionId);
  } catch (e) {
    const msg = (e instanceof Error ? e.message : "unknown").slice(0, 300);
    const sub = await deps.repo.getSubmission(submissionId).catch(() => null);
    if (sub) await deps.repo.updateSubmission(sub.id, { pdf_error: msg, pdf_attempts: sub.pdf_attempts + 1 }).catch(() => undefined);
    return null;
  }
}

/** The confirmation-screen download: the cookie token must match and be under an hour old. */
export async function receiptLink(deps: FormDeps, submissionId: string, token: string | null): Promise<string> {
  const sub = UUID.test(submissionId) ? await deps.repo.getSubmission(submissionId) : null;
  const ok = sub && token && TOKEN.test(token) && sub.receipt_token_hash && sub.receipt_token_hash === hashToken(token) && sub.receipt_expires_at && Date.parse(sub.receipt_expires_at) > nowOf(deps).getTime();
  if (!ok) throw new ValidationError("This download has expired. It works for an hour after submitting, in the browser you submitted from.");
  const ready = sub.pdf_path ? sub : await makePdf(deps, sub.id);
  const form = await deps.repo.getForm(sub.form_id);
  return deps.stores.pdfs.signedUrl(ownPath(deps, ready.pdf_path!), DOCUMENT_URL_SECONDS, `${(form?.name ?? "Form").replace(/[^A-Za-z0-9 _-]/g, "").slice(0, 80) || "Form"} - submission ${sub.number}.pdf`);
}

// ----------------------------------------------------------- linked records

/** The submission's answers as text, opened, for workflow conditions and document merge fields (`form.<key>`). */
export async function answerStrings(deps: FormDeps, submissionId: string): Promise<Record<string, string> | null> {
  const sub = UUID.test(submissionId) ? await deps.repo.getSubmission(submissionId) : null;
  if (!sub || sub.status === "draft") return null;
  const version = await deps.repo.getVersion(sub.version_id);
  if (!version) return null;
  const opened = openAnswers(deps, sub) as Answers;
  const uploads = await deps.repo.listUploads(sub.id);
  const out: Record<string, string> = {};
  for (const f of inputFields(version.definition)) {
    if (f.type === "signature") {
      if (sub.signature) out[f.key] = sub.signature.signed_name;
      continue;
    }
    const v = opened[f.key];
    if (v === undefined) continue;
    out[f.key] = f.type === "file" && Array.isArray(v) ? v.map((id) => uploads.find((u) => u.id === id)?.file_name ?? "").filter(Boolean).join(", ") : answerText(f, v);
  }
  return out;
}

/** Links the submission to the customer with the respondent's email; creates the customer when allowed. */
export async function linkCustomer(deps: FormDeps, sub: Submission, settings: FormSettings): Promise<string | null> {
  if (sub.customer_id) return sub.customer_id;
  const email = sub.respondent_email;
  if (!email) return null;
  let customer = await deps.commerce.findCustomerByEmail(email);
  let created = false;
  if (!customer) {
    if (!settings.create_customer) return null;
    try {
      customer = await deps.commerce.createCustomer({ email, full_name: sub.respondent_name, stripe_customer_id: null });
      created = true;
    } catch {
      // Someone else created the same customer a moment ago.
      customer = await deps.commerce.findCustomerByEmail(email);
    }
  }
  if (!customer) return null;
  await deps.repo.updateSubmission(sub.id, { customer_id: customer.id });
  await event(deps, sub.form_id, sub.id, created ? "customer_created" : "customer_linked", null, { customer_id: customer.id });
  return customer.id;
}

/**
 * For a submission made before its respondent could be identified (for example, no email question was chosen):
 * finds the respondent from its answers, then links (or creates) the customer and the firm. An administrator action.
 */
export async function relinkRespondent(deps: FormDeps, submissionId: string, actorId: string): Promise<{ customerId: string | null; organizationId: string | null }> {
  let sub = UUID.test(submissionId) ? await deps.repo.getSubmission(submissionId) : null;
  if (!sub || sub.status === "draft" || sub.status === "spam" || sub.is_test) throw new ValidationError("Only real submissions can be linked.");
  const [form, version] = await Promise.all([deps.repo.getForm(sub.form_id), deps.repo.getVersion(sub.version_id)]);
  if (!form || !version) throw new ValidationError("Submission not found.");
  const settings = readSettings(form.settings);
  if (!sub.respondent_email) {
    const keys = respondentKeys(settings, version.definition);
    const opened = openAnswers(deps, sub);
    const email = keys.email_key && typeof opened[keys.email_key] === "string" ? (opened[keys.email_key] as string) : null;
    if (!email) throw new ValidationError("This submission has no email answer, so there is no customer to link it to.");
    const name = keys.name_key && typeof opened[keys.name_key] === "string" ? (opened[keys.name_key] as string).slice(0, 200) : null;
    sub = await deps.repo.updateSubmission(sub.id, { respondent_email: email, respondent_name: sub.respondent_name ?? name });
  }
  await event(deps, sub.form_id, sub.id, "relink_requested", actorId);
  const customerId = await linkCustomer(deps, sub, settings);
  const organizationId = await linkFirm(deps, sub.id, settings);
  return { customerId, organizationId };
}

/**
 * Links the submission to the firm for the respondent's tax office, or creates it in My Service Bureau:
 * first a firm already linked to the customer, then one with the same EFIN, otherwise a new firm from the mapping.
 * A failure is recorded on the submission (an administrator can retry) and never affects the submission itself.
 */
export async function linkFirm(deps: FormDeps, subId: string, settings: FormSettings): Promise<string | null> {
  const sub = await deps.repo.getSubmission(subId);
  if (!sub || !settings.firm.enabled || !deps.firms || sub.organization_id) return sub?.organization_id ?? null;
  const form = await deps.repo.getForm(sub.form_id);
  try {
    const opened = openAnswers(deps, sub) as Answers;
    let org: { id: string } | null = sub.customer_id ? await deps.firms.findForCustomer(sub.customer_id) : null;
    let how: "linked" | "created" = "linked";
    if (!org) {
      const efin = efinFrom(settings.firm, opened);
      const byEfin = efin ? await deps.firms.findByEfinHash(deps.secrets.hashIdentifier("efin", efin)) : null;
      if (byEfin) {
        org = byEfin;
        if (sub.customer_id && !byEfin.customer_id) await deps.firms.linkCustomer(byEfin.id, sub.customer_id);
      }
    }
    if (!org) {
      const payload = buildFirmPayload({ map: settings.firm, answers: opened, secrets: deps.secrets, customerId: sub.customer_id, submissionId: sub.id, number: sub.number ?? 0, formName: form?.name ?? "Form" });
      org = { id: await deps.firms.create(payload) };
      how = "created";
    }
    await deps.repo.updateSubmission(sub.id, { organization_id: org.id, firm_status: how, firm_error: null });
    await event(deps, sub.form_id, sub.id, how === "created" ? "firm_created" : "firm_linked", null, { organization_id: org.id });
    return org.id;
  } catch (e) {
    const raw = e instanceof Error ? e.message : "unknown";
    const msg = /duplicate key|23505|unique/i.test(raw) ? (/credential|ptin/i.test(raw) ? "A PTIN on this submission is already recorded for someone else." : /efin/i.test(raw) ? "That EFIN is already recorded for another firm." : "Some of these details are already recorded.") : raw;
    await deps.repo.updateSubmission(sub.id, { firm_status: "failed", firm_error: msg.slice(0, 480) });
    await event(deps, sub.form_id, sub.id, "firm_failed", null, { reason: msg.slice(0, 200) });
    return null;
  }
}

// ---------------------------------------------------------------- admin views

export async function setSubmissionStatus(deps: FormDeps, submissionId: string, status: SubmissionStatus, actorId: string) {
  if (status === "draft") throw new ValidationError("Choose a status.");
  const sub = await deps.repo.getSubmission(submissionId);
  if (!sub || sub.status === "draft") throw new ValidationError("Submission not found.");
  await deps.repo.updateSubmission(sub.id, { status });
  await event(deps, sub.form_id, sub.id, "status_changed", actorId, { from: sub.status, to: status });
}

/**
 * Staff fill in a submission's staff-only fields. Only fields marked internal in the version the respondent used can
 * be set; the respondent's own (locked) answers are never touched. Recorded.
 */
export async function saveInternalValues(deps: FormDeps, submissionId: string, values: Record<string, string>, actorId: string) {
  const sub = await deps.repo.getSubmission(submissionId);
  if (!sub || sub.status === "draft") throw new ValidationError("Submission not found.");
  const version = await deps.repo.getVersion(sub.version_id);
  const fields = new Map(inputFields(version?.definition ?? emptyDefinition()).filter((f) => f.internal).map((f) => [f.key, f]));
  const existing = await deps.repo.listInternalValues(sub.id);
  let changed = 0;
  for (const [key, raw] of Object.entries(values)) {
    const f = fields.get(key);
    if (!f) continue;
    const value = f.type === "short_text" ? raw.replace(/\s+/g, " ").trim().slice(0, 2000) : raw.replace(/\r\n?/g, "\n").trim().slice(0, 25000);
    if ((existing[key] ?? "") === value) continue;
    await deps.repo.setInternalValue(sub.id, key, value, actorId);
    changed++;
  }
  if (changed) await event(deps, sub.form_id, sub.id, "internal_saved", actorId, { fields: changed });
}

export async function recordView(deps: FormDeps, sub: Submission, actorId: string) {
  await event(deps, sub.form_id, sub.id, "viewed", actorId);
}

/** An administrator reveals one sensitive answer. Recorded. */
export async function revealAnswer(deps: FormDeps, submissionId: string, key: string, actorId: string): Promise<string> {
  const sub = await deps.repo.getSubmission(submissionId);
  if (!sub || sub.status === "draft") throw new ValidationError("Submission not found.");
  const v = (openAnswers(deps, sub) as Record<string, unknown>)[key];
  if (typeof v !== "string") throw new ValidationError("Nothing to show.");
  await event(deps, sub.form_id, sub.id, "revealed", actorId, { key });
  return v;
}

/** A 60-second link to an uploaded file, for an administrator. Recorded. */
export async function uploadLink(deps: FormDeps, uploadId: string, actorId: string, download: boolean): Promise<string> {
  const u = UUID.test(uploadId) ? await deps.repo.getUpload(uploadId) : null;
  if (!u || u.status !== "attached") throw new ValidationError("File not found.");
  await event(deps, u.form_id, u.submission_id, "file_viewed", actorId, { upload_id: u.id });
  return deps.stores.uploads.signedUrl(ownPath(deps, u.storage_path), DOCUMENT_URL_SECONDS, download ? u.file_name : null);
}

/** A 60-second link to the submission PDF, for an administrator. Makes it first if it is still pending. Recorded. */
export async function adminPdfLink(deps: FormDeps, submissionId: string, actorId: string): Promise<string> {
  let sub = UUID.test(submissionId) ? await deps.repo.getSubmission(submissionId) : null;
  if (!sub || sub.status === "draft") throw new ValidationError("Submission not found.");
  if (!sub.pdf_path) sub = await makePdf(deps, sub.id);
  const form = await deps.repo.getForm(sub.form_id);
  await event(deps, sub.form_id, sub.id, "pdf_downloaded", actorId);
  return deps.stores.pdfs.signedUrl(ownPath(deps, sub.pdf_path!), DOCUMENT_URL_SECONDS, `${(form?.name ?? "Form").replace(/[^A-Za-z0-9 _-]/g, "").slice(0, 80) || "Form"} - submission ${sub.number}.pdf`);
}

async function removeSubmissions(deps: FormDeps, subs: Submission[]) {
  if (!subs.length) return;
  for (const s of subs) {
    const uploads = await deps.repo.listUploads(s.id);
    if (uploads.length) await deps.stores.uploads.remove(uploads.map((u) => ownPath(deps, u.storage_path))).catch(() => undefined);
    if (s.pdf_path) await deps.stores.pdfs.remove([ownPath(deps, s.pdf_path)]).catch(() => undefined);
  }
  await deps.repo.deleteSubmissions(subs.map((s) => s.id));
}

/** Empties a form's spam. Real submissions can't be deleted (the database refuses). */
export async function emptySpam(deps: FormDeps, formId: string, actorId: string): Promise<number> {
  const spam = await deps.repo.listSpam(formId, 500);
  await removeSubmissions(deps, spam);
  if (spam.length) await event(deps, formId, null, "spam_emptied", actorId, { count: spam.length });
  return spam.length;
}

// ------------------------------------------------------------------- CSV

const csvCell = (v: string) => {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Every submission of a form as CSV. Sensitive answers stay masked and file uploads are left out. Recorded. */
export async function exportCsv(deps: FormDeps, formId: string, actorId: string): Promise<{ csv: string; fileName: string }> {
  const form = await mustForm(deps, formId);
  const { rows } = await deps.repo.listSubmissions(form.id, { status: "all", limit: 10_000 });
  const versions = new Map((await deps.repo.listVersions(form.id)).map((v) => [v.id, v]));
  const latest = form.current_version_id ? versions.get(form.current_version_id) : undefined;
  // Columns: every question ever published, newest version's order first.
  const columns: Field[] = [];
  const seen = new Set<string>();
  for (const v of [latest, ...versions.values()].filter(Boolean) as FormVersion[]) {
    for (const f of inputFields(v.definition)) {
      if (f.type === "file" || seen.has(f.key)) continue;
      seen.add(f.key);
      columns.push(f);
    }
  }
  const profile = await deps.profile();
  const tz = profile?.time_zone ?? "America/New_York";
  const head = ["Number", "Status", "Submitted (UTC)", `Submitted (${tz})`, "Respondent name", "Respondent email", "Test", ...columns.map((c) => c.label || c.key)];
  const lines = [head.map(csvCell).join(",")];
  for (const s of rows) {
    lines.push([
      String(s.number ?? ""), s.status, s.submitted_at ?? "", s.submitted_at ? new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "short", timeStyle: "short" }).format(new Date(s.submitted_at)) : "",
      s.respondent_name ?? "", s.respondent_email ?? "", s.is_test ? "yes" : "",
      ...columns.map((c) => (c.type === "signature" ? (s.signature ? `Signed (${s.signature.method}) by ${s.signature.signed_name}` : "") : displayAnswer(c, (s.answers as StoredAnswers)[c.key]))),
    ].map(csvCell).join(","));
  }
  await event(deps, form.id, null, "exported", actorId, { rows: rows.length });
  return { csv: `${lines.join("\r\n")}\r\n`, fileName: `${form.name.replace(/[^A-Za-z0-9 _-]/g, "").slice(0, 60) || "form"} submissions.csv` };
}

// ------------------------------------------------------------------- sweep

/** Deletes expired drafts (and their files) and retries submission PDFs that failed. Safe to run often. */
export async function sweepForms(deps: FormDeps): Promise<{ draftsRemoved: number; pdfsMade: number }> {
  const due = await deps.repo.listDueDrafts(iso(deps), 100);
  await removeSubmissions(deps, due);
  let pdfsMade = 0;
  for (const s of await deps.repo.listPendingPdfs(10)) {
    if (s.pdf_attempts >= 5) continue;
    if (await makePdfSafe(deps, s.id)) pdfsMade++;
  }
  return { draftsRemoved: due.length, pdfsMade };
}

export type { AddressAnswer };
