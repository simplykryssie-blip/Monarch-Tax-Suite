import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUniqueViolation, unwrap } from "../commerce/supabase-repo.ts";
import type { AuditEntry, AutomationEvent, AutomationRepo, Execution, ExecutionStatus, OnboardingLink, Template, Workflow } from "./types.ts";

// Service-role store for the Automation Center. RLS is on for every table with no anon/authenticated
// grants; callers authorize (administrator, or a hashed setup link) before using it.
type Row = Record<string, unknown>;

export class SupabaseAutomationRepo implements AutomationRepo {
  private db: SupabaseClient;
  constructor(db: SupabaseClient) {
    this.db = db;
  }

  async listTemplates() { return unwrap(await this.db.from("automation_templates").select("*").order("name")) as Template[]; }
  async getTemplate(id: string) { return unwrap(await this.db.from("automation_templates").select("*").eq("id", id).maybeSingle()) as Template | null; }
  async findTemplateByKey(key: string) { return unwrap(await this.db.from("automation_templates").select("*").eq("template_key", key).maybeSingle()) as Template | null; }
  async insertTemplate(input: Row) { return unwrap(await this.db.from("automation_templates").insert(input).select("*").single()) as Template; }
  async updateTemplate(id: string, patch: Row) { return unwrap(await this.db.from("automation_templates").update(patch).eq("id", id).select("*").single()) as Template; }

  async listWorkflows() { return unwrap(await this.db.from("automation_workflows").select("*").order("created_at")) as Workflow[]; }
  async getWorkflow(id: string) { return unwrap(await this.db.from("automation_workflows").select("*").eq("id", id).maybeSingle()) as Workflow | null; }
  async findWorkflowByKey(key: string) { return unwrap(await this.db.from("automation_workflows").select("*").eq("workflow_key", key).maybeSingle()) as Workflow | null; }
  async insertWorkflow(input: Row) { return unwrap(await this.db.from("automation_workflows").insert(input).select("*").single()) as Workflow; }
  async updateWorkflow(id: string, patch: Row) { return unwrap(await this.db.from("automation_workflows").update(patch).eq("id", id).select("*").single()) as Workflow; }
  async deleteWorkflow(id: string) { unwrap(await this.db.from("automation_workflows").delete().eq("id", id)); }

  async insertEvent(input: Row) {
    const { data, error } = await this.db.from("automation_events").insert(input).select("*").single();
    if (error && isUniqueViolation(error)) {
      const existing = unwrap(await this.db.from("automation_events").select("*").eq("event_key", input.event_key as string).single()) as AutomationEvent;
      return { event: existing, created: false };
    }
    return { event: unwrap({ data, error }) as AutomationEvent, created: true };
  }
  async getEvent(id: string) { return unwrap(await this.db.from("automation_events").select("*").eq("id", id).maybeSingle()) as AutomationEvent | null; }
  async listEventsByType(type: string, limit: number) { return unwrap(await this.db.from("automation_events").select("*").eq("event_type", type).order("created_at", { ascending: false }).limit(limit)) as AutomationEvent[]; }

  async insertExecution(input: Row) {
    const { data, error } = await this.db.from("automation_executions").insert(input).select("*").single();
    if (error && isUniqueViolation(error)) {
      const existing = unwrap(await this.db.from("automation_executions").select("*").eq("workflow_id", input.workflow_id as string).eq("event_id", input.event_id as string).eq("is_test", false).single()) as Execution;
      return { execution: existing, created: false };
    }
    return { execution: unwrap({ data, error }) as Execution, created: true };
  }
  async getExecution(id: string) { return unwrap(await this.db.from("automation_executions").select("*").eq("id", id).maybeSingle()) as Execution | null; }
  async listExecutions(filter: { status?: ExecutionStatus; workflow_id?: string; limit: number }) {
    let q = this.db.from("automation_executions").select("*");
    if (filter.status) q = q.eq("status", filter.status);
    if (filter.workflow_id) q = q.eq("workflow_id", filter.workflow_id);
    return unwrap(await q.order("created_at", { ascending: false }).limit(filter.limit)) as Execution[];
  }
  async listDue(nowIso: string, limit: number) {
    const stale = new Date(Date.parse(nowIso) - 10 * 60_000).toISOString();
    const due = unwrap(await this.db.from("automation_executions").select("*").in("status", ["queued", "retrying"]).lte("next_attempt_at", nowIso).order("next_attempt_at").limit(limit)) as Execution[];
    const stuck = unwrap(await this.db.from("automation_executions").select("*").eq("status", "running").lt("started_at", stale).limit(limit)) as Execution[];
    return [...due, ...stuck].slice(0, limit);
  }
  async claimExecution(id: string, nowIso: string, staleBeforeIso: string) {
    const current = await this.getExecution(id);
    if (!current) return null;
    const claimable = current.status === "queued" || current.status === "retrying" || (current.status === "running" && (current.started_at ?? "") < staleBeforeIso);
    if (!claimable) return null;
    // Compare-and-set on the status and attempt count we just read: only one caller can win.
    const rows = unwrap(
      await this.db.from("automation_executions").update({ status: "running", started_at: nowIso, attempts: current.attempts + 1, next_attempt_at: null }).eq("id", id).eq("status", current.status).eq("attempts", current.attempts).select("*"),
    ) as Execution[];
    return rows[0] ?? null;
  }
  async updateExecution(id: string, patch: Row) { return unwrap(await this.db.from("automation_executions").update(patch).eq("id", id).select("*").single()) as Execution; }
  async hasExecutions(workflowId: string) {
    const rows = unwrap(await this.db.from("automation_executions").select("id").eq("workflow_id", workflowId).limit(1)) as Row[];
    return rows.length > 0;
  }
  async findRecentSuccess(workflowId: string, licenseId: string, sinceIso: string) {
    const rows = unwrap(
      await this.db.from("automation_executions").select("*, automation_events!inner(license_id)").eq("workflow_id", workflowId).eq("status", "succeeded").eq("is_test", false).eq("automation_events.license_id", licenseId).gte("finished_at", sinceIso).order("finished_at", { ascending: false }).limit(1),
    ) as (Execution & { automation_events?: unknown })[];
    if (!rows[0]) return null;
    const { automation_events: _e, ...exec } = rows[0];
    void _e;
    return exec as Execution;
  }

  async insertLink(input: Row) { return unwrap(await this.db.from("onboarding_links").insert(input).select("*").single()) as OnboardingLink; }
  async findLinkByHash(hash: string) { return unwrap(await this.db.from("onboarding_links").select("*").eq("token_hash", hash).maybeSingle()) as OnboardingLink | null; }
  async getLink(id: string) { return unwrap(await this.db.from("onboarding_links").select("*").eq("id", id).maybeSingle()) as OnboardingLink | null; }
  async markLinkOpened(id: string, nowIso: string) {
    const rows = unwrap(await this.db.from("onboarding_links").update({ first_opened_at: nowIso }).eq("id", id).is("first_opened_at", null).select("id")) as Row[];
    return rows.length === 1;
  }
  async revokeLink(id: string, nowIso: string) { unwrap(await this.db.from("onboarding_links").update({ revoked_at: nowIso }).eq("id", id).is("revoked_at", null)); }
  async revokeLinksForLicense(licenseId: string, nowIso: string, exceptId?: string) {
    let q = this.db.from("onboarding_links").update({ revoked_at: nowIso }).eq("license_id", licenseId).is("revoked_at", null);
    if (exceptId) q = q.neq("id", exceptId);
    return (unwrap(await q.select("id")) as Row[]).length;
  }
  async listLinks(limit: number) { return unwrap(await this.db.from("onboarding_links").select("*").order("created_at", { ascending: false }).limit(limit)) as OnboardingLink[]; }

  async addAudit(input: Row) { unwrap(await this.db.from("automation_audit_log").insert(input)); }
  async listAudit(limit: number) { return unwrap(await this.db.from("automation_audit_log").select("*").order("created_at", { ascending: false }).limit(limit)) as AuditEntry[]; }
  async countAuditSince(actorId: string, action: string, sinceIso: string) {
    const rows = unwrap(await this.db.from("automation_audit_log").select("id").eq("actor_id", actorId).eq("action", action).gte("created_at", sinceIso)) as Row[];
    return rows.length;
  }
}
