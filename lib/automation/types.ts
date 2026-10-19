import type { ArchiveFields } from "../archive.ts";
// Automation Center data model. Events and executions hold ids, statuses and error categories only:
// never lead contents, license keys, OAuth tokens, webhook URLs or secrets.

export type WorkflowStatus = "active" | "paused" | "archived";
export type ExecutionStatus = "queued" | "running" | "retrying" | "waiting" | "succeeded" | "failed" | "skipped";
export type ErrorKind = "config" | "transient" | "permanent" | "skipped";

export type Condition = { field: string; op: "eq" | "neq" | "in" | "contains" | "not_contains"; value: string };

export type SendEmailAction = { type: "send_email"; template_id: string; to: "customer" | "support"; include_setup_link: boolean };
export type RecordNoteAction = { type: "record_note"; note: string };
/** Fills a library document for the event's customer and emails a secure link. `sender_id` null = the default sender. */
export type SendDocumentAction = { type: "send_document"; document_id: string; sender_id: string | null; message: string; link_days: number };
/** Like send_document, but the customer signs the PDF in the app. */
export type RequestSignatureAction = { type: "request_signature"; document_id: string; sender_id: string | null; message: string; link_days: number; reminder_days: number | null };
/** Adds a task for staff (Automation → Tasks), due a number of days after the run. */
export type CreateTaskAction = { type: "create_task"; title: string; due_days: number | null };
/** Adds or removes a tag on the person the event is about (their lead and client records). */
export type AddTagAction = { type: "add_tag"; tag: string };
export type RemoveTagAction = { type: "remove_tag"; tag: string };
/** Changes a field on the person's lead record. */
export type UpdateContactAction = { type: "update_contact"; field: "lead_status"; value: string };
/** A text from the office's own number, sent only to a person who agreed to texts. */
export type SendTextAction = { type: "send_text"; body: string };
export type Action = SendEmailAction | RecordNoteAction | SendDocumentAction | RequestSignatureAction | CreateTaskAction | AddTagAction | RemoveTagAction | UpdateContactAction | SendTextAction;

/** Holds the run until a time has passed. Business mode counts only the office's open hours (Settings → Business hours). */
export type WaitStep = { type: "wait"; amount: number; unit: "minutes" | "hours" | "days"; mode: "business" | "calendar" };
/** If every condition holds, the first list runs, otherwise the second. */
export type BranchStep = { type: "branch"; conditions: Condition[]; then: Step[]; else: Step[] };
export type Step = Action | WaitStep | BranchStep;

export type Workflow = {
  id: string;
  workflow_key: string | null;
  name: string;
  description: string | null;
  trigger_event: string;
  conditions: Condition[];
  actions: Action[];
  /** The step tree. Null on a workflow made before branches and waits: then `actions` is the whole workflow. */
  steps?: Step[] | null;
  /** Trigger settings, e.g. { offset_days: -7 } for a date-based trigger. */
  trigger_config?: Record<string, number | string>;
  status: WorkflowStatus;
  max_attempts: number;
  cooldown_hours: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
} & ArchiveFields;
export type NewWorkflow = Omit<Workflow, "id" | "created_at" | "updated_at">;

export type Template = {
  id: string;
  template_key: string | null;
  name: string;
  subject: string;
  body: string;
  active: boolean;
  /** Which of the tenant's sending addresses this email goes from; null = the default sender. */
  sender_id?: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};
export type NewTemplate = Omit<Template, "id" | "created_at" | "updated_at">;

export type AutomationEvent = {
  id: string;
  event_key: string;
  event_type: string;
  license_id: string | null;
  customer_id: string | null;
  order_id: string | null;
  /** What the event is about, by id; the person's details are looked up when a step runs. */
  subject_type?: SubjectType | null;
  subject_id?: string | null;
  data: Record<string, string | number | boolean | null>;
  created_at: string;
};
export type SubjectType = "appointment" | "lead" | "client" | "invoice" | "return";
export type NewEvent = Omit<AutomationEvent, "id" | "created_at">;

export type ActionResult = { index: number; type: Step["type"]; path?: string; status: "ok" | "failed" | "skipped"; detail: string; message_id?: string | null; at: string };

export type Execution = {
  id: string;
  workflow_id: string;
  event_id: string;
  status: ExecutionStatus;
  is_test: boolean;
  attempts: number;
  max_attempts: number;
  /** The next instruction to run (see steps.ts); a retry or a wait carries on from here. */
  pc?: number;
  next_attempt_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  action_log: ActionResult[];
  error: string | null;
  error_kind: ErrorKind | null;
  provider_message_id: string | null;
  created_at: string;
  updated_at: string;
};
export type NewExecution = Pick<Execution, "workflow_id" | "event_id" | "is_test" | "max_attempts" | "next_attempt_at">;

export type OnboardingLink = {
  id: string;
  license_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  first_opened_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type OnboardingProfile = {
  license_id: string;
  contact_name: string | null;
  business_name: string | null;
  business_email: string | null;
  phone: string | null;
  ghl_account: string | null;
  completed_at: string | null;
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
};
export type ProfilePatch = Partial<Pick<OnboardingProfile, "contact_name" | "business_name" | "business_email" | "phone" | "ghl_account" | "completed_at" | "last_activity_at">>;

export type AuditEntry = { id: string; actor_id: string | null; action: string; target_type: string | null; target_id: string | null; detail: Record<string, unknown>; created_at: string };

export interface AutomationRepo {
  listTemplates(): Promise<Template[]>;
  getTemplate(id: string): Promise<Template | null>;
  findTemplateByKey(key: string): Promise<Template | null>;
  insertTemplate(input: NewTemplate): Promise<Template>;
  updateTemplate(id: string, patch: Partial<NewTemplate>): Promise<Template>;

  listWorkflows(): Promise<Workflow[]>;
  getWorkflow(id: string): Promise<Workflow | null>;
  findWorkflowByKey(key: string): Promise<Workflow | null>;
  insertWorkflow(input: NewWorkflow): Promise<Workflow>;
  updateWorkflow(id: string, patch: Partial<NewWorkflow>): Promise<Workflow>;
  /** Only workflows that never ran may be deleted; the rest are archived. */
  deleteWorkflow(id: string): Promise<void>;

  /** Inserts unless the event key exists. `created` is false for a duplicate. */
  insertEvent(input: NewEvent): Promise<{ event: AutomationEvent; created: boolean }>;
  getEvent(id: string): Promise<AutomationEvent | null>;
  listEventsByType(type: string, limit: number): Promise<AutomationEvent[]>;

  /** Unique per (workflow, event) for real runs. */
  insertExecution(input: NewExecution): Promise<{ execution: Execution; created: boolean }>;
  getExecution(id: string): Promise<Execution | null>;
  listExecutions(filter: { status?: ExecutionStatus; workflow_id?: string; limit: number }): Promise<Execution[]>;
  listDue(nowIso: string, limit: number): Promise<Execution[]>;
  /** Atomically moves queued/retrying (or stale running) to running and counts the attempt; null when someone else holds it. */
  claimExecution(id: string, nowIso: string, staleBeforeIso: string): Promise<Execution | null>;
  updateExecution(id: string, patch: Partial<Omit<Execution, "id" | "workflow_id" | "event_id" | "created_at">>): Promise<Execution>;
  hasExecutions(workflowId: string): Promise<boolean>;
  /** Most recent succeeded real execution of a workflow for the same license, newer than `sinceIso`. */
  findRecentSuccess(workflowId: string, licenseId: string, sinceIso: string): Promise<Execution | null>;

  insertLink(input: Omit<OnboardingLink, "id" | "created_at" | "first_opened_at" | "revoked_at">): Promise<OnboardingLink>;
  findLinkByHash(hash: string): Promise<OnboardingLink | null>;
  getLink(id: string): Promise<OnboardingLink | null>;
  /** Sets first_opened_at only if empty; returns true when this call set it. */
  markLinkOpened(id: string, nowIso: string): Promise<boolean>;
  revokeLink(id: string, nowIso: string): Promise<void>;
  /** Revokes every unrevoked link of a license except `exceptId`. */
  revokeLinksForLicense(licenseId: string, nowIso: string, exceptId?: string): Promise<number>;
  listLinks(limit: number): Promise<OnboardingLink[]>;

  getProfile(licenseId: string): Promise<OnboardingProfile | null>;
  /** Creates or updates the one profile row of a license. */
  saveProfile(licenseId: string, patch: ProfilePatch): Promise<OnboardingProfile>;
  /** Sets completed_at only if empty; returns true when this call completed it. */
  completeProfile(licenseId: string, nowIso: string): Promise<boolean>;
  listEventsByLicense(licenseId: string, limit: number): Promise<AutomationEvent[]>;
  listExecutionsForEvents(eventIds: string[]): Promise<Execution[]>;
  listLinksForLicense(licenseId: string, limit: number): Promise<OnboardingLink[]>;

  addAudit(input: Omit<AuditEntry, "id" | "created_at">): Promise<void>;
  listAudit(limit: number): Promise<AuditEntry[]>;
  countAuditSince(actorId: string, action: string, sinceIso: string): Promise<number>;
}
