"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { retryExecution, runTest } from "@/lib/automation/engine.ts";
import { automationDeps } from "@/lib/automation/server";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { installDefaults } from "@/lib/automation/defaults.ts";
import { createTemplate, createWorkflow, duplicateWorkflow, removeWorkflow, sendTemplateTest, setTemplateActive, setWorkflowStatus, updateTemplate, updateWorkflow } from "@/lib/automation/admin.ts";
import type { WorkflowFormInput } from "@/lib/automation/validate.ts";

// Every action re-checks administrator access on the server and writes an audit entry (in lib/automation/admin.ts).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (form: FormData, name = "id") => {
  const v = String(form.get(name) ?? "");
  if (!UUID.test(v)) throw new ValidationError("That item could not be found.");
  return v;
};
const str = (form: FormData, name: string) => String(form.get(name) ?? "");
const withParam = (path: string, key: "notice" | "error", message: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;

async function mutate(back: string, fn: (admin: { id: string; email: string }) => Promise<{ to?: string; notice: string }>) {
  const session = await requireAdmin();
  let target: string;
  try {
    const result = await fn({ id: session.userId, email: session.email });
    target = withParam(result.to ?? back, "notice", result.notice);
  } catch (e) {
    if (e instanceof ValidationError) target = withParam(back, "error", e.message);
    else {
      console.error(`automation admin action failed: ${sanitizeError(e, 200)}`);
      target = withParam(back, "error", e instanceof Error && /migration|relation|schema cache/i.test(e.message) ? "The Automation Center database tables are not installed yet. Apply the automation migration first." : "That did not work. Nothing was changed. Please try again.");
    }
  }
  revalidatePath("/automation", "layout");
  redirect(target);
}

function workflowFromForm(form: FormData): WorkflowFormInput {
  const conditions = [0, 1, 2].map((i) => ({ field: str(form, `cond_field_${i}`), op: str(form, `cond_op_${i}`), value: str(form, `cond_value_${i}`) }));
  const actions = [0, 1, 2, 3, 4].map((i) => ({
    type: str(form, `act_type_${i}`),
    template_id: str(form, `act_template_${i}`),
    to: str(form, `act_to_${i}`),
    include_setup_link: form.get(`act_setup_${i}`) === "on",
    note: str(form, `act_note_${i}`),
  })).filter((a) => a.type === "send_email" || a.type === "record_note");
  return { name: str(form, "name"), description: str(form, "description"), trigger_event: str(form, "trigger_event"), conditions, actions, max_attempts: str(form, "max_attempts") || 4, cooldown_hours: str(form, "cooldown_hours") || 0 };
}

export async function saveWorkflowAction(form: FormData) {
  const existing = str(form, "id");
  await mutate(existing ? `/automation/workflows/${existing}` : "/automation/workflows/new", async (a) => {
    const repo = automationDeps().repo;
    const w = existing ? await updateWorkflow(repo, a, id(form), workflowFromForm(form)) : await createWorkflow(repo, a, workflowFromForm(form));
    return { to: `/automation/workflows/${w.id}`, notice: existing ? "Workflow saved." : "Workflow created. It is paused until you turn it on." };
  });
}

export async function workflowStatusAction(form: FormData) {
  await mutate("/automation/workflows", async (a) => {
    const status = str(form, "status") === "active" ? "active" : "paused";
    const w = await setWorkflowStatus(automationDeps().repo, a, id(form), status);
    return { notice: status === "active" ? `"${w.name}" is on.` : `"${w.name}" is paused. New events will not start it.` };
  });
}

export async function duplicateWorkflowAction(form: FormData) {
  await mutate("/automation/workflows", async (a) => {
    const copy = await duplicateWorkflow(automationDeps().repo, a, id(form));
    return { to: `/automation/workflows/${copy.id}`, notice: "Copy created and paused." };
  });
}

export async function removeWorkflowAction(form: FormData) {
  await mutate(`/automation/workflows/${str(form, "id")}`, async (a) => {
    const outcome = await removeWorkflow(automationDeps().repo, a, id(form), str(form, "confirm_name"));
    return { to: "/automation/workflows", notice: outcome === "deleted" ? "Workflow deleted." : "This workflow has run before, so it was archived instead. Its history is kept." };
  });
}

export async function testWorkflowAction(form: FormData) {
  await mutate(`/automation/workflows/${str(form, "id")}`, async (a) => {
    const exec = await runTest(automationDeps(), id(form), a);
    const ok = exec.status === "succeeded";
    return { notice: ok ? `Test finished. Any email went only to ${a.email}, with sample data.` : `Test ${exec.status}: ${exec.error ?? "see Activity for details"}` };
  });
}

export async function saveTemplateAction(form: FormData) {
  const existing = str(form, "id");
  await mutate(existing ? `/automation/templates/${existing}` : "/automation/templates/new", async (a) => {
    const repo = automationDeps().repo;
    const input = { name: str(form, "name"), subject: str(form, "subject"), body: str(form, "body") };
    const t = existing ? await updateTemplate(repo, a, id(form), input) : await createTemplate(repo, a, input);
    return { to: `/automation/templates/${t.id}`, notice: "Template saved." };
  });
}

export async function templateActiveAction(form: FormData) {
  await mutate(`/automation/templates/${str(form, "id")}`, async (a) => {
    const active = str(form, "active") === "yes";
    if (!active) {
      const repo = automationDeps().repo;
      const used = (await repo.listWorkflows()).filter((w) => w.status === "active" && w.actions.some((x) => x.type === "send_email" && x.template_id === str(form, "id")));
      if (used.length) throw new ValidationError(`Turn off or edit these active workflows first: ${used.map((w) => w.name).join(", ")}.`);
    }
    await setTemplateActive(automationDeps().repo, a, id(form), active);
    return { notice: active ? "Template is on." : "Template is off." };
  });
}

export async function testTemplateAction(form: FormData) {
  await mutate(`/automation/templates/${str(form, "id")}`, async (a) => {
    const deps = automationDeps();
    await sendTemplateTest(deps.repo, deps.email, deps.config.supportEmail, a, id(form));
    return { notice: `Test email sent to ${a.email} with sample data.` };
  });
}

export async function retryExecutionAction(form: FormData) {
  await mutate("/automation/activity", async (a) => {
    const exec = await retryExecution(automationDeps(), id(form), a.id);
    return { notice: exec.status === "succeeded" ? "Retried. It worked this time." : `Retried. Status: ${exec.status}.` };
  });
}

export async function revokeLinkAction(form: FormData) {
  await mutate("/automation/activity", async (a) => {
    await automationDeps().repo.revokeLink(id(form), new Date().toISOString());
    await automationDeps().repo.addAudit({ actor_id: a.id, action: "setup_link_revoked", target_type: "link", target_id: id(form), detail: {} });
    return { notice: "Setup link revoked." };
  });
}

export async function installDefaultsAction() {
  await mutate("/automation", async (a) => {
    const r = await installDefaults(automationDeps().repo, a.id);
    return { notice: r.workflows || r.templates ? `Added ${r.templates} templates and ${r.workflows} workflows (all paused). Review them, then turn on what you want.` : "The standard templates and workflows are already installed." };
  });
}
