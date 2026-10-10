import { ValidationError } from "../commerce/validation.ts";
import { renderTemplate, SAMPLE_VALUES } from "./template.ts";
import { validateTemplateInput, validateWorkflowInput, type WorkflowFormInput } from "./validate.ts";
import type { EmailSender } from "./email.ts";
import type { AutomationRepo, Execution, Template, Workflow } from "./types.ts";

// Administrator operations. Every function writes an audit entry; callers must have checked requireAdmin.

type Actor = { id: string; email: string };

export async function createTemplate(repo: AutomationRepo, actor: Actor, input: { name: unknown; subject: unknown; body: unknown }): Promise<Template> {
  const v = validateTemplateInput(input);
  const t = await repo.insertTemplate({ template_key: null, ...v, active: true, created_by: actor.id, updated_by: actor.id });
  await repo.addAudit({ actor_id: actor.id, action: "template_created", target_type: "template", target_id: t.id, detail: { name: t.name } });
  return t;
}

export async function updateTemplate(repo: AutomationRepo, actor: Actor, id: string, input: { name: unknown; subject: unknown; body: unknown }): Promise<Template> {
  if (!(await repo.getTemplate(id))) throw new ValidationError("Template not found.");
  const t = await repo.updateTemplate(id, { ...validateTemplateInput(input), updated_by: actor.id });
  await repo.addAudit({ actor_id: actor.id, action: "template_updated", target_type: "template", target_id: id, detail: { name: t.name } });
  return t;
}

export async function setTemplateActive(repo: AutomationRepo, actor: Actor, id: string, active: boolean): Promise<Template> {
  if (!(await repo.getTemplate(id))) throw new ValidationError("Template not found.");
  const t = await repo.updateTemplate(id, { active, updated_by: actor.id });
  await repo.addAudit({ actor_id: actor.id, action: active ? "template_activated" : "template_deactivated", target_type: "template", target_id: id, detail: {} });
  return t;
}

/** Which workflows use a template (for the manager's "used by" list). */
export function workflowsUsing(templateId: string, workflows: Workflow[]) {
  return workflows.filter((w) => w.status !== "archived" && w.actions.some((a) => a.type === "send_email" && a.template_id === templateId));
}

const MAX_TEST_SENDS_PER_HOUR = 10;

/** Sends a template, filled with obviously fake sample values, to the administrator's own address only. */
export async function sendTemplateTest(repo: AutomationRepo, email: EmailSender, supportEmail: string, actor: Actor, templateId: string): Promise<string> {
  const t = await repo.getTemplate(templateId);
  if (!t) throw new ValidationError("Template not found.");
  const since = new Date(Date.now() - 3_600_000).toISOString();
  if ((await repo.countAuditSince(actor.id, "template_test_sent", since)) >= MAX_TEST_SENDS_PER_HOUR) throw new ValidationError("Too many test emails this hour. Try again later.");
  let rendered;
  try {
    rendered = renderTemplate(t.subject, t.body, SAMPLE_VALUES, { supportEmail });
  } catch (e) {
    throw new ValidationError(e instanceof Error ? e.message : "The template could not be rendered.");
  }
  const result = await email.send({ to: actor.email, subject: `[TEST] ${rendered.subject}`, html: rendered.html, text: `*** TEST EMAIL: sample data only ***\n\n${rendered.text}`, idempotencyKey: `test:${t.id}:${Date.now()}` });
  await repo.addAudit({ actor_id: actor.id, action: "template_test_sent", target_type: "template", target_id: t.id, detail: { ok: result.ok, ...(result.ok ? { message_id: result.id } : { kind: result.kind }) } });
  if (!result.ok) throw new ValidationError(result.message);
  return result.id;
}

export async function createWorkflow(repo: AutomationRepo, actor: Actor, input: WorkflowFormInput): Promise<Workflow> {
  const v = validateWorkflowInput(input, await repo.listTemplates());
  const w = await repo.insertWorkflow({ workflow_key: null, ...v, status: "paused", created_by: actor.id, updated_by: actor.id });
  await repo.addAudit({ actor_id: actor.id, action: "workflow_created", target_type: "workflow", target_id: w.id, detail: { name: w.name, trigger: w.trigger_event } });
  return w;
}

export async function updateWorkflow(repo: AutomationRepo, actor: Actor, id: string, input: WorkflowFormInput): Promise<Workflow> {
  const existing = await repo.getWorkflow(id);
  if (!existing || existing.status === "archived") throw new ValidationError("Workflow not found.");
  const v = validateWorkflowInput(input, await repo.listTemplates());
  const w = await repo.updateWorkflow(id, { ...v, updated_by: actor.id });
  await repo.addAudit({ actor_id: actor.id, action: "workflow_updated", target_type: "workflow", target_id: id, detail: { name: w.name } });
  return w;
}

export async function setWorkflowStatus(repo: AutomationRepo, actor: Actor, id: string, status: "active" | "paused"): Promise<Workflow> {
  const existing = await repo.getWorkflow(id);
  if (!existing || existing.status === "archived") throw new ValidationError("Workflow not found.");
  if (status === "active") {
    // Turning a workflow on must not leave it pointing at missing or switched-off templates.
    const templates = await repo.listTemplates();
    for (const a of existing.actions) {
      if (a.type !== "send_email") continue;
      const t = templates.find((x) => x.id === a.template_id);
      if (!t) throw new ValidationError("This workflow uses an email template that no longer exists. Edit the workflow first.");
      if (!t.active) throw new ValidationError(`The template "${t.name}" is switched off. Turn it on before activating this workflow.`);
    }
  }
  const w = await repo.updateWorkflow(id, { status, updated_by: actor.id });
  await repo.addAudit({ actor_id: actor.id, action: status === "active" ? "workflow_activated" : "workflow_paused", target_type: "workflow", target_id: id, detail: { name: w.name } });
  return w;
}

export async function duplicateWorkflow(repo: AutomationRepo, actor: Actor, id: string): Promise<Workflow> {
  const src = await repo.getWorkflow(id);
  if (!src) throw new ValidationError("Workflow not found.");
  const copy = await repo.insertWorkflow({ workflow_key: null, name: `${src.name} (copy)`.slice(0, 120), description: src.description, trigger_event: src.trigger_event, conditions: src.conditions, actions: src.actions, status: "paused", max_attempts: src.max_attempts, cooldown_hours: src.cooldown_hours, created_by: actor.id, updated_by: actor.id });
  await repo.addAudit({ actor_id: actor.id, action: "workflow_duplicated", target_type: "workflow", target_id: copy.id, detail: { from: id } });
  return copy;
}

/** A workflow that never ran can be deleted (only when `confirmName` matches); one with history is archived instead. */
export async function removeWorkflow(repo: AutomationRepo, actor: Actor, id: string, confirmName: string): Promise<"deleted" | "archived"> {
  const w = await repo.getWorkflow(id);
  if (!w) throw new ValidationError("Workflow not found.");
  if (confirmName.trim() !== w.name) throw new ValidationError("Type the workflow's exact name to confirm.");
  if (await repo.hasExecutions(id)) {
    await repo.updateWorkflow(id, { status: "archived", updated_by: actor.id });
    await repo.addAudit({ actor_id: actor.id, action: "workflow_archived", target_type: "workflow", target_id: id, detail: { name: w.name } });
    return "archived";
  }
  await repo.deleteWorkflow(id);
  await repo.addAudit({ actor_id: actor.id, action: "workflow_deleted", target_type: "workflow", target_id: id, detail: { name: w.name } });
  return "deleted";
}

export type DashboardStats = {
  active: number;
  paused: number;
  succeeded: number;
  failed: number;
  retrying: number;
  queued: number;
  emailsSent: number;
  recent: Execution[];
};

export async function dashboardStats(repo: AutomationRepo): Promise<DashboardStats> {
  const [workflows, executions] = await Promise.all([repo.listWorkflows(), repo.listExecutions({ limit: 1000 })]);
  const real = executions.filter((e) => !e.is_test);
  const count = (s: Execution["status"]) => real.filter((e) => e.status === s).length;
  return {
    active: workflows.filter((w) => w.status === "active").length,
    paused: workflows.filter((w) => w.status === "paused").length,
    succeeded: count("succeeded"),
    failed: count("failed"),
    retrying: count("retrying"),
    queued: count("queued"),
    emailsSent: real.reduce((n, e) => n + e.action_log.filter((a) => a.type === "send_email" && a.status === "ok").length, 0),
    recent: executions.slice(0, 15),
  };
}
