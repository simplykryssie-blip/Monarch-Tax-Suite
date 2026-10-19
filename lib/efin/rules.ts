import { sentence, words } from "./text.ts";
import { REMINDER_STAGES, type AssignmentRole, type AssignmentRow, type AssignmentState, type CredentialRow, type EfinRow, type EfinStatus, type RenewalTaskRow, type RoleRow } from "./types.ts";

// Pure business rules for EFIN management. No database, no clock reads: callers pass "today" so every rule is testable.

export class EfinRuleError extends Error {
  /** Name of the form field the message is about, so the form can mark it and keep everything else typed. */
  field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.field = field;
  }
}

/** Runs a validator and tags any rule error with the field it belongs to. */
export function forField<T>(field: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof EfinRuleError && !e.field) e.field = field;
    throw e;
  }
}

// ------------------------------------------------------------------------------------------ identifiers
/** An EFIN is six digits. Spaces and dashes are tolerated on input. */
export function normalizeEfin(raw: string): string {
  const v = raw.replace(/[\s-]/g, "");
  if (!/^\d{6}$/.test(v)) throw new EfinRuleError("An EFIN is six digits.");
  return v;
}

/** A PTIN is the letter P followed by eight digits. */
export function normalizePtin(raw: string): string {
  const v = raw.replace(/[\s-]/g, "").toUpperCase();
  if (!/^P\d{8}$/.test(v)) throw new EfinRuleError("A PTIN is the letter P followed by eight digits.");
  return v;
}

export function normalizeEin(raw: string): string {
  const v = raw.replace(/[\s-]/g, "");
  if (!/^\d{9}$/.test(v)) throw new EfinRuleError("An EIN is nine digits.");
  return v;
}

export const last4 = (value: string) => value.slice(-4);
export const maskEfin = (l4: string | null | undefined) => (l4 ? `••${l4}`.padStart(6, "•").slice(-6) : "••••••");
export const maskPtin = (l4: string | null | undefined) => (l4 ? `P••••${l4}` : "P••••••••");
export const maskEin = (l4: string | null | undefined) => (l4 ? `••-•••${l4}` : "••-•••••••");

// ------------------------------------------------------------------------------------------ dates
const DAY = 86_400_000;
export function parseDay(iso: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new EfinRuleError("Dates must look like 2026-12-31.");
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) throw new EfinRuleError("That date does not exist.");
  return t;
}
/** Whole days from today until the date (negative once it has passed). */
export const daysUntil = (dueOn: string, today: string) => Math.round((parseDay(dueOn) - parseDay(today)) / DAY);
export const todayIso = (now = new Date()) => now.toISOString().slice(0, 10);

// ------------------------------------------------------------------------------------------ assignments
type Transition = { to: AssignmentState; action: string; reasonRequired: boolean; highImpact: boolean };
const TRANSITIONS: Record<AssignmentState, Transition[]> = {
  draft: [{ to: "pending_review", action: "submit", reasonRequired: false, highImpact: false }],
  pending_review: [
    { to: "approved", action: "approve", reasonRequired: false, highImpact: false },
    { to: "draft", action: "return", reasonRequired: true, highImpact: false },
  ],
  approved: [
    { to: "active", action: "activate", reasonRequired: false, highImpact: true },
    { to: "revoked", action: "revoke", reasonRequired: true, highImpact: true },
  ],
  active: [
    { to: "suspended", action: "suspend", reasonRequired: true, highImpact: true },
    { to: "revoked", action: "revoke", reasonRequired: true, highImpact: true },
    { to: "expired", action: "expire", reasonRequired: false, highImpact: false },
  ],
  suspended: [
    { to: "active", action: "reinstate", reasonRequired: true, highImpact: true },
    { to: "revoked", action: "revoke", reasonRequired: true, highImpact: true },
    { to: "expired", action: "expire", reasonRequired: false, highImpact: false },
  ],
  // Revoked and expired are terminal: a revoked assignment can never be reactivated. A new request starts a new record.
  revoked: [],
  expired: [],
};

export const availableTransitions = (from: AssignmentState) => TRANSITIONS[from];

export function findTransition(from: AssignmentState, to: AssignmentState): Transition {
  const t = TRANSITIONS[from].find((x) => x.to === to);
  if (!t) {
    throw new EfinRuleError(from === "revoked" ? "A revoked assignment cannot be reactivated. Create a new assignment request instead." : `An assignment cannot move from ${words(from)} to ${words(to)}.`);
  }
  return t;
}

export type TransitionContext = {
  assignment: Pick<AssignmentRow, "state" | "role" | "person_id" | "organization_id" | "requested_by" | "effective_from" | "effective_to">;
  efin: Pick<EfinRow, "internal_status" | "archived_at" | "organization_id">;
  actorId: string;
  to: AssignmentState;
  reason: string;
  confirmed: boolean;
  roles: Pick<RoleRow, "organization_id" | "person_id" | "role" | "status">[];
  credentials: Pick<CredentialRow, "person_id" | "kind" | "archived_at">[];
};

export type TransitionPlan = { to: AssignmentState; action: string; highImpact: boolean; selfApproval: boolean };

/** Validates a requested move and returns what to record. Throws EfinRuleError with a plain-language message otherwise. */
export function planTransition(ctx: TransitionContext): TransitionPlan {
  const t = findTransition(ctx.assignment.state, ctx.to);
  const reason = ctx.reason.trim();
  if (t.reasonRequired && reason.length < 5) throw new EfinRuleError("A reason is required for this change (at least a few words).");
  if (t.highImpact && !ctx.confirmed) throw new EfinRuleError("This is a high-impact change. Confirm it to continue.");

  const selfApproval = t.action === "approve" && ctx.assignment.requested_by === ctx.actorId;
  if (selfApproval && reason.length < 5) throw new EfinRuleError("You requested this assignment. Add a reason to approve your own request; it is recorded in the history.");

  if (t.action === "submit" || t.action === "approve" || t.action === "activate" || t.action === "reinstate") {
    const problems = assignmentProblems(ctx);
    if (problems.length) throw new EfinRuleError(problems[0]);
  }
  return { to: t.to, action: t.action, highImpact: t.highImpact, selfApproval };
}

/** Everything that must be true before an assignment can be submitted, approved or made active. */
export function assignmentProblems(ctx: Pick<TransitionContext, "assignment" | "efin" | "roles" | "credentials">): string[] {
  const { assignment: a, efin } = ctx;
  const problems: string[] = [];
  if (efin.archived_at) problems.push("This EFIN is archived.");
  if (efin.internal_status === "inactive" || efin.internal_status === "suspended") problems.push(`This EFIN is ${efin.internal_status}; it cannot receive new assignments.`);
  if (a.role !== "bureau_administrator" && !a.person_id) problems.push("Choose the person this assignment is for.");
  if (a.person_id && a.role !== "bureau_administrator") {
    const held = ctx.roles.some((r) => r.status === "active" && r.person_id === a.person_id && r.organization_id === a.organization_id && r.role === a.role);
    if (!held) problems.push(`This person does not hold the ${words(a.role)} role at this organization yet. Record it under People first.`);
  }
  // A PTIN is recorded evidence that a preparer has one. It never authorizes e-file on its own.
  if (a.role === "tax_preparer" && a.person_id) {
    const hasPtin = ctx.credentials.some((c) => c.person_id === a.person_id && c.kind === "ptin" && !c.archived_at);
    if (!hasPtin) problems.push("A tax preparer assignment needs a PTIN recorded for that person.");
  }
  if (a.effective_from && a.effective_to && a.effective_to < a.effective_from) problems.push("The end date is before the start date.");
  return problems;
}

/** Whether an active assignment's end date has passed, so the daily job can expire it. */
export const assignmentLapsed = (a: Pick<AssignmentRow, "state" | "effective_to">, today: string) => a.state === "active" && !!a.effective_to && a.effective_to < today;

// ------------------------------------------------------------------------------------------ renewals
export type RenewalUrgency = "none" | "open" | "urgent" | "escalated" | "overdue";

export function urgencyFor(daysLeft: number): Exclude<RenewalUrgency, "none"> {
  if (daysLeft < 0) return "overdue";
  if (daysLeft <= 7) return "escalated";
  if (daysLeft <= 14) return "urgent";
  return "open";
}

/** Whether renewal tracking should run for this EFIN, and if not, why (shown as a compliance exception). */
export function renewalTracking(efin: Pick<EfinRow, "recorded_expiration" | "expiration_verified" | "internal_status" | "archived_at">): { track: true } | { track: false; reason: "archived" | "suspended" | "inactive" | "missing_date" | "unverified_date" } {
  if (efin.archived_at) return { track: false, reason: "archived" };
  if (efin.internal_status === "suspended") return { track: false, reason: "suspended" };
  if (efin.internal_status === "inactive") return { track: false, reason: "inactive" };
  if (!efin.recorded_expiration) return { track: false, reason: "missing_date" };
  // Reminders run from a deadline someone verified. An unverified date is flagged instead of trusted.
  if (!efin.expiration_verified) return { track: false, reason: "unverified_date" };
  return { track: true };
}

export type TaskPlan =
  | { kind: "create"; efinId: string; organizationId: string; dueOn: string; title: string }
  | { kind: "update"; taskId: string; dueOn: string; status: RenewalTaskRow["status"] }
  | { kind: "cancel"; taskId: string; reason: string };

/** Reconciles renewal tasks with the EFIN records. original_due_on is never touched by an update. */
export function planRenewalTasks(efins: Pick<EfinRow, "id" | "organization_id" | "efin_last4" | "recorded_expiration" | "expiration_verified" | "internal_status" | "archived_at">[], tasks: RenewalTaskRow[], today: string): TaskPlan[] {
  const live = new Map<string, RenewalTaskRow>();
  for (const t of tasks) if (t.subject_type === "efin" && ["open", "urgent", "escalated", "overdue"].includes(t.status)) live.set(t.subject_id, t);
  const plans: TaskPlan[] = [];
  const seen = new Set<string>();
  for (const e of efins) {
    seen.add(e.id);
    const tracking = renewalTracking(e);
    const task = live.get(e.id);
    if (!tracking.track) {
      if (task) plans.push({ kind: "cancel", taskId: task.id, reason: `Renewal tracking stopped: ${tracking.reason.replace(/_/g, " ")}.` });
      continue;
    }
    const dueOn = e.recorded_expiration as string;
    const status = urgencyFor(daysUntil(dueOn, today));
    if (!task) plans.push({ kind: "create", efinId: e.id, organizationId: e.organization_id, dueOn, title: `Renew EFIN ending ${e.efin_last4}` });
    else if (task.due_on !== dueOn || task.status !== status) plans.push({ kind: "update", taskId: task.id, dueOn, status });
  }
  for (const [subject, task] of live) if (!seen.has(subject)) plans.push({ kind: "cancel", taskId: task.id, reason: "EFIN is no longer tracked." });
  return plans;
}

/**
 * Which reminder stage (if any) should be sent now. Only the most recent stage that has been reached is returned, so a
 * job that was down for a week sends one reminder rather than a burst. Overdue items escalate at stage 0.
 * Callers still dedupe with notification_events (task, due date, stage, recipient).
 */
export function dueReminderStage(dueOn: string, today: string): number | null {
  const left = daysUntil(dueOn, today);
  if (left < 0) return 0;
  const reached = [...REMINDER_STAGES].filter((s) => left <= s).sort((a, b) => a - b);
  return reached.length ? reached[0] : null;
}

export const roleLabel = (r: AssignmentRole) => sentence(r);

export const isEfinStatus = (v: string): v is EfinStatus => ["draft", "pending_verification", "active", "renewal_review", "inactive", "suspended"].includes(v);

/** Clients that only bought software or services: no team, PTIN or internal assignment records are kept for them. */
export const tracksTeam = (relationship: string) => relationship !== "client";

/** An EFIN that was ever used in a live assignment (active, or later suspended, revoked or expired) is archived, never deleted. */
export const hasLiveHistory = (assignments: Pick<AssignmentRow, "state" | "activated_at">[]) =>
  assignments.some((a) => Boolean(a.activated_at) || ["active", "suspended", "revoked", "expired"].includes(a.state));
