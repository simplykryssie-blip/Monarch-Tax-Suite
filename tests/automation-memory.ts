import { randomUUID } from "node:crypto";
import type { AuditEntry, AutomationEvent, AutomationRepo, Execution, ExecutionStatus, NewEvent, NewExecution, NewTemplate, NewWorkflow, OnboardingLink, OnboardingProfile, ProfilePatch, Template, Workflow } from "../lib/automation/types.ts";

// In-memory AutomationRepo with the same uniqueness rules as the database.
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const now = () => new Date().toISOString();

export class MemoryAutomationRepo implements AutomationRepo {
  templates: Template[] = [];
  workflows: Workflow[] = [];
  events: AutomationEvent[] = [];
  executions: Execution[] = [];
  links: OnboardingLink[] = [];
  audit: AuditEntry[] = [];

  async listTemplates() { return clone(this.templates); }
  async getTemplate(id: string) { return clone(this.templates.find((t) => t.id === id) ?? null); }
  async findTemplateByKey(key: string) { return clone(this.templates.find((t) => t.template_key === key) ?? null); }
  async insertTemplate(input: NewTemplate) { const t: Template = { ...input, id: randomUUID(), created_at: now(), updated_at: now() }; this.templates.push(t); return clone(t); }
  async updateTemplate(id: string, patch: Partial<NewTemplate>) { const t = this.templates.find((x) => x.id === id)!; Object.assign(t, patch, { updated_at: now() }); return clone(t); }

  async listWorkflows() { return clone(this.workflows); }
  async getWorkflow(id: string) { return clone(this.workflows.find((w) => w.id === id) ?? null); }
  async findWorkflowByKey(key: string) { return clone(this.workflows.find((w) => w.workflow_key === key) ?? null); }
  async insertWorkflow(input: NewWorkflow) { const w: Workflow = { ...clone(input), id: randomUUID(), created_at: now(), updated_at: now() }; this.workflows.push(w); return clone(w); }
  async updateWorkflow(id: string, patch: Partial<NewWorkflow>) { const w = this.workflows.find((x) => x.id === id)!; Object.assign(w, clone(patch), { updated_at: now() }); return clone(w); }
  async deleteWorkflow(id: string) { this.workflows = this.workflows.filter((w) => w.id !== id); }

  async insertEvent(input: NewEvent) {
    const existing = this.events.find((e) => e.event_key === input.event_key);
    if (existing) return { event: clone(existing), created: false };
    const e: AutomationEvent = { ...clone(input), id: randomUUID(), created_at: now() };
    this.events.push(e);
    return { event: clone(e), created: true };
  }
  async getEvent(id: string) { return clone(this.events.find((e) => e.id === id) ?? null); }
  async listEventsByType(type: string, limit: number) { return clone(this.events.filter((e) => e.event_type === type).slice(-limit).reverse()); }

  async insertExecution(input: NewExecution) {
    if (!input.is_test) {
      const existing = this.executions.find((x) => x.workflow_id === input.workflow_id && x.event_id === input.event_id && !x.is_test);
      if (existing) return { execution: clone(existing), created: false };
    }
    const x: Execution = { ...input, id: randomUUID(), status: "queued", attempts: 0, started_at: null, finished_at: null, action_log: [], error: null, error_kind: null, provider_message_id: null, created_at: now(), updated_at: now() };
    this.executions.push(x);
    return { execution: clone(x), created: true };
  }
  async getExecution(id: string) { return clone(this.executions.find((x) => x.id === id) ?? null); }
  async listExecutions(f: { status?: ExecutionStatus; workflow_id?: string; limit: number }) {
    return clone(this.executions.filter((x) => (!f.status || x.status === f.status) && (!f.workflow_id || x.workflow_id === f.workflow_id)).slice(-f.limit).reverse());
  }
  async listDue(nowIso: string, limit: number) {
    return clone(this.executions.filter((x) => (x.status === "queued" || x.status === "retrying") && (x.next_attempt_at ?? "") <= nowIso).slice(0, limit));
  }
  async claimExecution(id: string, nowIso: string, staleBeforeIso: string) {
    const x = this.executions.find((e) => e.id === id);
    if (!x) return null;
    const ok = x.status === "queued" || x.status === "retrying" || (x.status === "running" && (x.started_at ?? "") < staleBeforeIso);
    if (!ok) return null;
    Object.assign(x, { status: "running", started_at: nowIso, attempts: x.attempts + 1, next_attempt_at: null, updated_at: now() });
    return clone(x);
  }
  async updateExecution(id: string, patch: Partial<Execution>) { const x = this.executions.find((e) => e.id === id)!; Object.assign(x, clone(patch), { updated_at: now() }); return clone(x); }
  async hasExecutions(workflowId: string) { return this.executions.some((x) => x.workflow_id === workflowId); }
  async findRecentSuccess(workflowId: string, licenseId: string, sinceIso: string) {
    const found = this.executions.find((x) => {
      const ev = this.events.find((e) => e.id === x.event_id);
      return x.workflow_id === workflowId && x.status === "succeeded" && !x.is_test && ev?.license_id === licenseId && (x.finished_at ?? "") >= sinceIso;
    });
    return clone(found ?? null);
  }

  async insertLink(input: Omit<OnboardingLink, "id" | "created_at" | "first_opened_at" | "revoked_at">) { const l: OnboardingLink = { ...input, id: randomUUID(), created_at: now(), first_opened_at: null, revoked_at: null }; this.links.push(l); return clone(l); }
  async findLinkByHash(hash: string) { return clone(this.links.find((l) => l.token_hash === hash) ?? null); }
  async getLink(id: string) { return clone(this.links.find((l) => l.id === id) ?? null); }
  async markLinkOpened(id: string, nowIso: string) { const l = this.links.find((x) => x.id === id)!; if (l.first_opened_at) return false; l.first_opened_at = nowIso; return true; }
  async revokeLink(id: string, nowIso: string) { const l = this.links.find((x) => x.id === id); if (l && !l.revoked_at) l.revoked_at = nowIso; }
  async revokeLinksForLicense(licenseId: string, nowIso: string, exceptId?: string) {
    let n = 0;
    for (const l of this.links) if (l.license_id === licenseId && !l.revoked_at && l.id !== exceptId) { l.revoked_at = nowIso; n++; }
    return n;
  }
  async listLinks(limit: number) { return clone(this.links.slice(-limit).reverse()); }

  profiles: OnboardingProfile[] = [];
  async getProfile(licenseId: string) { return clone(this.profiles.find((p) => p.license_id === licenseId) ?? null); }
  async saveProfile(licenseId: string, patch: ProfilePatch) {
    let p = this.profiles.find((x) => x.license_id === licenseId);
    if (!p) { p = { license_id: licenseId, contact_name: null, business_name: null, business_email: null, phone: null, ghl_account: null, completed_at: null, last_activity_at: null, created_at: now(), updated_at: now() }; this.profiles.push(p); }
    Object.assign(p, clone(patch), { updated_at: now() });
    return clone(p);
  }
  async completeProfile(licenseId: string, nowIso: string) {
    const p = this.profiles.find((x) => x.license_id === licenseId);
    if (!p || p.completed_at) return false;
    p.completed_at = nowIso;
    return true;
  }
  async listEventsByLicense(licenseId: string, limit: number) { return clone(this.events.filter((e) => e.license_id === licenseId).slice(-limit).reverse()); }
  async listExecutionsForEvents(eventIds: string[]) { return clone(this.executions.filter((x) => eventIds.includes(x.event_id))); }
  async listLinksForLicense(licenseId: string, limit: number) { return clone(this.links.filter((l) => l.license_id === licenseId).slice(-limit).reverse()); }

  async addAudit(input: Omit<AuditEntry, "id" | "created_at">) { this.audit.push({ ...clone(input), id: randomUUID(), created_at: now() }); }
  async listAudit(limit: number) { return clone(this.audit.slice(-limit).reverse()); }
  async countAuditSince(actorId: string, action: string, sinceIso: string) { return this.audit.filter((a) => a.actor_id === actorId && a.action === action && a.created_at >= sinceIso).length; }
}
