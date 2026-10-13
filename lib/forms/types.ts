import type { DocumentStore } from "../documents/types.ts";
import type { FormDefinition } from "./definition.ts";
import type { Answers } from "./answers.ts";
import type { RawAnswers } from "./logic.ts";

// Form Builder rows. Every row belongs to one tenant; repositories are built on the tenant-scoped database client,
// so a tenant only ever sees and writes its own rows (migration 20261016090000_forms.sql).

export type FormStatus = "draft" | "published" | "closed" | "archived";
export type FormRow = {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  status: FormStatus;
  public_id: string;
  draft_definition: FormDefinition | Record<string, never>;
  draft_updated_at: string | null;
  current_version_id: string | null;
  settings: unknown;
  signature_consent: string | null;
  submission_seq: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type FormVersion = { id: string; tenant_id: string; form_id: string; version: number; definition: FormDefinition; published_by: string | null; published_at: string };

export type SubmissionStatus = "draft" | "new" | "in_review" | "done" | "spam";
export const REVIEW_STATUSES: SubmissionStatus[] = ["new", "in_review", "done", "spam"];
/** Encrypted answer to a sensitive question: the value is AES-GCM with the submission and key as associated data. */
export type SealedAnswer = { sealed: string; last4: string };
export type StoredAnswers = Record<string, Answers[string] | SealedAnswer>;
export type SignatureRecord = { method: "typed" | "drawn"; signed_name: string; typed?: string; upload_id?: string };
export type FirmStatus = "none" | "linked" | "created" | "failed";

export type Submission = {
  id: string;
  tenant_id: string;
  form_id: string;
  version_id: string;
  number: number | null;
  status: SubmissionStatus;
  is_test: boolean;
  /** Draft: the answers as typed (sensitive ones sealed). Submitted: checked answers, never changed afterwards. */
  answers: StoredAnswers | RawAnswers;
  respondent_email: string | null;
  respondent_name: string | null;
  customer_id: string | null;
  organization_id: string | null;
  firm_status: FirmStatus;
  firm_error: string | null;
  draft_token_hash: string | null;
  draft_expires_at: string | null;
  resume_email: string | null;
  resume_sent_at: string | null;
  started_at: string;
  submitted_at: string | null;
  ip_hash: string | null;
  user_agent: string | null;
  consent_text: string | null;
  consented_at: string | null;
  signature: SignatureRecord | null;
  pdf_path: string | null;
  pdf_sha256: string | null;
  pdf_generated_at: string | null;
  pdf_attempts: number;
  pdf_error: string | null;
  receipt_token_hash: string | null;
  receipt_expires_at: string | null;
  notified_at: string | null;
  notify_error: string | null;
  confirmation_sent_at: string | null;
  spam_reason: string | null;
  created_at: string;
  updated_at: string;
};
export type SubmissionPatch = Partial<Omit<Submission, "id" | "tenant_id" | "form_id" | "created_at">>;

export type UploadRow = {
  id: string;
  tenant_id: string;
  form_id: string;
  submission_id: string;
  field_key: string;
  kind: "file" | "signature";
  storage_path: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string | null;
  status: "pending" | "attached" | "rejected";
  created_at: string;
};

export type FormEvent = { id: string; form_id: string | null; submission_id: string | null; type: string; actor_id: string | null; detail: Record<string, unknown>; created_at: string };

export type SubmissionQuery = { status?: SubmissionStatus | "all"; search?: string; limit: number; offset?: number; includeTests?: boolean };

export interface FormsRepo {
  listForms(): Promise<FormRow[]>;
  getForm(id: string): Promise<FormRow | null>;
  getFormByPublicId(publicId: string): Promise<FormRow | null>;
  insertForm(input: Pick<FormRow, "name" | "description" | "public_id" | "draft_definition" | "settings" | "created_by"> & Partial<Pick<FormRow, "signature_consent">>): Promise<FormRow>;
  updateForm(id: string, patch: Partial<Pick<FormRow, "name" | "description" | "status" | "draft_definition" | "draft_updated_at" | "current_version_id" | "settings" | "signature_consent" | "public_id">>): Promise<FormRow>;
  deleteForm(id: string): Promise<void>;
  /** Atomically takes the form's next submission number. */
  takeNumber(formId: string): Promise<number>;

  insertVersion(input: Pick<FormVersion, "form_id" | "version" | "definition" | "published_by">): Promise<FormVersion>;
  getVersion(id: string): Promise<FormVersion | null>;
  listVersions(formId: string): Promise<FormVersion[]>;

  insertSubmission(input: Pick<Submission, "id" | "form_id" | "version_id" | "status" | "is_test" | "answers" | "started_at"> & Partial<Submission>): Promise<Submission>;
  getSubmission(id: string): Promise<Submission | null>;
  findDraftByTokenHash(hash: string): Promise<Submission | null>;
  /** Updates only while the submission is in one of `from`; null when it was not. */
  transitionSubmission(id: string, from: SubmissionStatus[], patch: SubmissionPatch): Promise<Submission | null>;
  updateSubmission(id: string, patch: SubmissionPatch): Promise<Submission>;
  listSubmissions(formId: string, q: SubmissionQuery): Promise<{ rows: Submission[]; total: number }>;
  listSubmissionsForCustomer(customerId: string): Promise<Submission[]>;
  countSubmitted(formId: string): Promise<number>;
  listDueDrafts(nowIso: string, limit: number): Promise<Submission[]>;
  listPendingPdfs(limit: number): Promise<Submission[]>;
  /** Real submissions since `sinceIso` whose firm notice has not gone out yet. */
  listUnnotified(sinceIso: string, limit: number): Promise<Submission[]>;
  /** Deletes drafts and spam only; the database refuses anything else. */
  deleteSubmissions(ids: string[]): Promise<void>;
  listSpam(formId: string, limit: number): Promise<Submission[]>;

  insertUpload(input: Pick<UploadRow, "form_id" | "submission_id" | "field_key" | "kind" | "storage_path" | "file_name" | "content_type" | "size_bytes">): Promise<UploadRow>;
  getUpload(id: string): Promise<UploadRow | null>;
  listUploads(submissionId: string): Promise<UploadRow[]>;
  updateUpload(id: string, patch: Partial<Pick<UploadRow, "status" | "sha256">>): Promise<UploadRow>;
  deleteUploads(ids: string[]): Promise<void>;

  addEvent(input: Omit<FormEvent, "id" | "created_at">): Promise<void>;
  listEvents(submissionId: string, limit: number): Promise<FormEvent[]>;

  /** The customer's most recent paid order, for workflows and merge fields. */
  latestPaidOrderId(customerId: string): Promise<string | null>;
}

/** The firm (My Service Bureau organization) a submission links to or creates. */
export interface FirmsRepo {
  findForCustomer(customerId: string): Promise<{ id: string; legal_name: string } | null>;
  findByEfinHash(hash: string): Promise<{ id: string; legal_name: string; customer_id: string | null } | null>;
  linkCustomer(organizationId: string, customerId: string): Promise<void>;
  /** Creates the organization, office, people, PTINs and EFIN in one transaction. Returns the organization id. */
  create(payload: Record<string, unknown>): Promise<string>;
}

export type FormStores = { uploads: DocumentStore; pdfs: DocumentStore };
