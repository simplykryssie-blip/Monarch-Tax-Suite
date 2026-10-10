// Automation Center data model. Events and executions hold ids, statuses and error categories only:
// never lead contents, license keys, OAuth tokens, webhook URLs or secrets.

export type WorkflowStatus = "active" | "paused" | "archived";
export type ExecutionStatus = "queued" | "running" | "retrying" | "succeeded" | "failed" | "skipped";
export type ErrorKind = "config" | "transient" | "permanent" | "skipped";

export type Condition = { field: string; op: "eq" | "neq" | "in"; value: string };

export type SendEmailAction = { type: "send_email"; template_id: string; to: "customer" | "support"; include_setup_link: boolean };
export type RecordNoteAction = { type: "record_note"; note: string };
export type Action = SendEmailAction | RecordNoteAction;

export type Workflow = {
  id: string;
  workflow_key: string | null;
  name: string;
  description: string | null;
  trigger_event: string;
  conditions: Condition[];
  actions: Action[];
  status: WorkflowStatus;
  max_attempts: number;
  cooldown_hours: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};
export type NewWorkflow = Omit<Workflow, "id" | "created_at" | "updated_at">;

export type Template = {
  id: string;
  template_key: string | null;
  name: string;
  subject: string;
  body: string;
  active: boolean;
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
  data: Record<string, string | number | boolean | null>;
  created_at: string;
};
export type NewEvent = Omit<AutomationEvent, "id" | "created_at">;

export type ActionResult = { index: number; type: Action["type"]; status: "ok" | "failed" | "skipped"; detail: string; message_id?: string | null; at: string };

export type Execution = {
  id: string;
  workflow_id: string;
  event_id: string;
  status: ExecutionStatus;
  is_test: boolean;
  attempts: number;
  max_attempts: number;
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
