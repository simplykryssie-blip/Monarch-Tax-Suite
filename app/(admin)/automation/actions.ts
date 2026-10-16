"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { retryExecution, runClientTest, runTest } from "@/lib/automation/engine.ts";
import { archivePipeline, createPipeline, DEFAULT_RETURN_STAGES, deletePipeline, makeDefault, savePipeline } from "@/lib/pipelines/service.ts";
import { pipelinesRepo } from "@/lib/pipelines/server";
import { createSms, setSmsActive, updateSms } from "@/lib/automation/sms.ts";
import { SupabaseSmsRepo } from "@/lib/automation/sms-repo";
import { appOrigin, imageStore, tenantDb } from "@/lib/admin";
import { currentTenantId } from "@/lib/tenants.ts";
import { mediaUrl } from "@/lib/storage/paths.ts";
import { deleteLibraryImage, uploadLibraryImage } from "@/lib/images/service.ts";
import { SupabaseImagesRepo } from "@/lib/images/supabase-repo";
import { automationDeps, workflowCatalog } from "@/lib/automation/server";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { installDefaults } from "@/lib/automation/defaults.ts";
import { createTemplate, createWorkflow, duplicateWorkflow, sendTemplateTest, setTemplateActive, setWorkflowStatus, updateTemplate, updateWorkflow } from "@/lib/automation/admin.ts";
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
    document_id: str(form, `act_document_${i}`),
    sender_id: str(form, `act_sender_${i}`),
    message: str(form, `act_message_${i}`),
    link_days: str(form, `act_link_days_${i}`),
    reminder_days: str(form, `act_reminder_${i}`),
  })).filter((a) => ["send_email", "record_note", "send_document", "request_signature"].includes(a.type));
  return { name: str(form, "name"), description: str(form, "description"), trigger_event: str(form, "trigger_event"), conditions, actions, max_attempts: str(form, "max_attempts") || 4, cooldown_hours: str(form, "cooldown_hours") || 0 };
}

export async function saveWorkflowAction(form: FormData) {
  const existing = str(form, "id");
  await mutate(existing ? `/automation/workflows/${existing}` : "/automation/workflows/new", async (a) => {
    const deps = automationDeps();
    const catalog = await workflowCatalog(deps);
    const w = existing ? await updateWorkflow(deps.repo, a, id(form), workflowFromForm(form), catalog) : await createWorkflow(deps.repo, a, workflowFromForm(form), catalog);
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
    const deps = automationDeps();
    const repo = deps.repo;
    const senderId = str(form, "sender_id");
    if (senderId && !(await workflowCatalog(deps)).senders.some((s) => s.id === senderId)) throw new ValidationError("Choose one of your verified sending addresses.");
    const input = { name: str(form, "name"), subject: str(form, "subject"), body: str(form, "body"), sender_id: senderId || null };
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
  await mutate("/automation/workflows", async (a) => {
    const exec = await retryExecution(automationDeps(), id(form), a.id);
    return { notice: exec.status === "succeeded" ? "Retried. It worked this time." : `Retried. Status: ${exec.status}.` };
  });
}

export async function revokeLinkAction(form: FormData) {
  await mutate("/settings/integrations", async (a) => {
    await automationDeps().repo.revokeLink(id(form), new Date().toISOString());
    await automationDeps().repo.addAudit({ actor_id: a.id, action: "setup_link_revoked", target_type: "link", target_id: id(form), detail: {} });
    return { notice: "Setup link revoked." };
  });
}

export async function installDefaultsAction() {
  await mutate("/automation/workflows", async (a) => {
    const r = await installDefaults(automationDeps().repo, a.id);
    return { notice: r.workflows || r.templates ? `Added ${r.templates} template${r.templates === 1 ? "" : "s"} and ${r.workflows} workflow${r.workflows === 1 ? "" : "s"}, each with the status listed before you added it. Existing templates and workflows were not changed.` : "The standard templates and workflows are already installed." };
  });
}

// ---- Testing with a client

export async function testWorkflowWithClientAction(form: FormData) {
  await mutate(`/automation/workflows/${str(form, "id")}`, async (a) => {
    const exec = await runClientTest(automationDeps(), id(form), id(form, "customer_id"), a);
    const skipped = exec.action_log.filter((l) => l.status === "skipped").length;
    return {
      notice: exec.status === "succeeded"
        ? `Test finished: ${exec.action_log.length} step${exec.action_log.length === 1 ? "" : "s"} checked${skipped ? `, ${skipped} not sent (emails and documents are never sent in a test)` : ""}. See Run history for each step.`
        : `Test ${exec.status}: ${exec.error ?? "see Run history for details"}`,
    };
  });
}

// ---- Pipelines

export async function createPipelineAction(form: FormData) {
  await mutate("/automation/pipelines", async (a) => {
    const kind = str(form, "kind") === "returns" ? "returns" : "custom";
    const p = await createPipeline(pipelinesRepo(), { name: str(form, "name"), kind, quickStart: str(form, "quick") === "1", stages: str(form, "stages") || (kind === "returns" ? DEFAULT_RETURN_STAGES : [{ name: "To do" }, { name: "Doing" }, { name: "Done", done: true }]) }, a.id);
    return { to: `/automation/pipelines/${p.id}`, notice: "Pipeline created. Add, rename and reorder its stages below." };
  });
}

export async function savePipelineAction(form: FormData) {
  await mutate(`/automation/pipelines/${str(form, "id")}`, async () => {
    await savePipeline(pipelinesRepo(), id(form), { name: str(form, "name"), stages: str(form, "stages") });
    return { notice: "Pipeline saved." };
  });
}

export async function defaultPipelineAction(form: FormData) {
  await mutate(`/automation/pipelines/${str(form, "id")}`, async () => {
    await makeDefault(pipelinesRepo(), id(form));
    return { notice: "This pipeline now runs the My Work board." };
  });
}

export async function archivePipelineAction(form: FormData) {
  await mutate("/automation/pipelines", async () => {
    const archive = str(form, "archive") === "yes";
    await archivePipeline(pipelinesRepo(), id(form), archive);
    return { notice: archive ? "Pipeline archived. It's listed under Archived pipelines, where you can restore or delete it." : "Pipeline restored." };
  });
}

export async function deletePipelineAction(form: FormData) {
  await mutate("/automation/pipelines", async () => {
    if (str(form, "confirm") !== "yes") throw new ValidationError("Tick the box to confirm the pipeline should be deleted.");
    const p = await deletePipeline(pipelinesRepo(), id(form));
    return { notice: `Pipeline "${p.name}" deleted.` };
  });
}

// ---- Text (SMS) templates: plain text, saved for when text messaging is connected

const smsRepo = () => new SupabaseSmsRepo(tenantDb());

export async function saveSmsAction(form: FormData) {
  const existing = str(form, "id");
  await mutate(existing ? `/automation/templates/sms/${existing}` : "/automation/templates/sms/new", async (a) => {
    const t = existing ? await updateSms(smsRepo(), id(form), { name: str(form, "name"), body: str(form, "body") }) : await createSms(smsRepo(), { name: str(form, "name"), body: str(form, "body") }, a.id);
    return { to: `/automation/templates/sms/${t.id}`, notice: "Text template saved." };
  });
}

export async function smsActiveAction(form: FormData) {
  await mutate(`/automation/templates/sms/${str(form, "id")}`, async () => {
    const active = str(form, "active") === "yes";
    await setSmsActive(smsRepo(), id(form), active);
    return { notice: active ? "Text template is on." : "Text template is off." };
  });
}

// ---- Images for emails: kept in the account's own private storage and shown through /media

const imagesRepo = () => new SupabaseImagesRepo(tenantDb());

async function libraryUpload(form: FormData, actorId: string) {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new ValidationError("Choose a picture to upload.");
  return uploadLibraryImage(imagesRepo(), imageStore(), { bytes: new Uint8Array(await file.arrayBuffer()), declaredType: file.type, fileName: file.name, altText: str(form, "alt") }, actorId);
}

export async function uploadLibraryImageAction(form: FormData) {
  await mutate("/automation/images", async (a) => {
    await libraryUpload(form, a.id);
    return { notice: "Picture uploaded. Copy its email code, or add it from the Picture button in any email template." };
  });
}

/** Called by the email editor's "Upload a picture": stores it and returns the address the email shows it from. */
export async function uploadEmailImageAction(form: FormData): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const session = await requireAdmin();
  try {
    const image = await libraryUpload(form, session.userId);
    revalidatePath("/automation/images");
    return { ok: true, url: mediaUrl(await appOrigin(), currentTenantId(), image.storage_path) };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    console.error(`email image upload failed: ${sanitizeError(e, 200)}`);
    return { ok: false, error: /relation|schema cache|does not exist/i.test(e instanceof Error ? e.message : "") ? "Image storage isn't installed yet. Apply the tenant storage migration first." : "The picture could not be uploaded. Please try again." };
  }
}

export async function deleteLibraryImageAction(form: FormData) {
  await mutate("/automation/images", async () => {
    await deleteLibraryImage(imagesRepo(), imageStore(), id(form));
    return { notice: "Picture deleted, including its stored file." };
  });
}
