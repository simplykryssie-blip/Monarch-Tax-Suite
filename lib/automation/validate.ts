import { ValidationError } from "../commerce/validation.ts";
import { EVENTS, isEventType, RECORD_FIELDS } from "./events.ts";
import { ANSWER_FIELD, PRODUCT_FIELD } from "./engine.ts";
import { CONTACT_FIELD } from "./contact.ts";
import { branchDepth, countSteps, flattenActions, MAX_BRANCH_DEPTH, MAX_STEPS, WAIT_LIMITS } from "./steps.ts";
import { parseTags, TAG_LENGTH } from "../leads/tags.ts";
import { LEAD_STATUSES } from "../leads/types.ts";
import { renderTemplate, SAMPLE_VALUES, unknownVariables } from "./template.ts";
import type { Action, Condition, NewTemplate, Step, Template } from "./types.ts";

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, max) : "");

/** A number typed in a form (text) or sent by the builder (a number), as text. */
const numText = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) ? String(v) : text(v, max));

export function validateTemplateInput(input: { name: unknown; subject: unknown; body: unknown }): Pick<NewTemplate, "name" | "subject" | "body"> {
  const name = text(input.name, 120);
  const subject = text(input.subject, 200).replace(/\s+/g, " ");
  const body = typeof input.body === "string" ? input.body.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, 20000) : "";
  if (name.length < 2) throw new ValidationError("Give the template a name.");
  if (!subject) throw new ValidationError("Enter a subject line.");
  if (!body) throw new ValidationError("Enter the message.");
  const unknown = unknownVariables(subject, body);
  if (unknown.length) throw new ValidationError(`These placeholders are not available: ${unknown.map((u) => `{{${u}}}`).join(", ")}. Use the list shown beside the editor.`);
  try {
    renderTemplate(subject, body, SAMPLE_VALUES, { supportEmail: "support@example.com" });
  } catch (e) {
    throw new ValidationError(e instanceof Error ? e.message : "The template could not be rendered.");
  }
  return { name, subject, body };
}

type RawAction = { type: unknown; template_id?: unknown; to?: unknown; include_setup_link?: unknown; note?: unknown; document_id?: unknown; sender_id?: unknown; message?: unknown; link_days?: unknown; reminder_days?: unknown; [k: string]: unknown };

export type WorkflowFormInput = {
  name: unknown;
  description?: unknown;
  trigger_event: unknown;
  /** Days before (negative) or after a date, for date-based triggers. */
  offset_days?: unknown;
  conditions: { field: unknown; op: unknown; value: unknown }[];
  /** The old flat list of up to five steps. */
  actions?: RawAction[];
  /** The step tree from the builder: actions, waits and if/else branches. Wins over `actions` when present. */
  steps?: unknown;
  max_attempts?: unknown;
  cooldown_hours?: unknown;
};

/** The tenant's own records a workflow may refer to. */
export type WorkflowCatalog = {
  /** `merge_fields`: the current version's merge fields, so form answers used by a document can be checked. */
  documents: { id: string; name: string; file_type: "pdf" | "docx"; status: string; merge_fields?: string[] }[];
  senders: { id: string; from_name?: string; address?: string; domain_id?: string }[];
  attributes: { key: string; label: string; kind: "choice" | "text"; options: string[] }[];
  /** The tenant's published forms and their questions. */
  forms?: { id: string; name: string; questions: { key: string; label: string; type: string; options: string[] }[] }[];
};
const EMPTY_CATALOG: WorkflowCatalog = { documents: [], senders: [], attributes: [], forms: [] };

type Form = NonNullable<WorkflowCatalog["forms"]>[number];
type Ctx = { trigger: string; templates: Pick<Template, "id">[]; catalog: WorkflowCatalog; form: Form | null };

const OPS = ["eq", "neq", "in", "contains", "not_contains"] as const;

/** Conditions on the event (and, inside a branch, on the person). */
function validateConditions(raw: { field: unknown; op: unknown; value: unknown }[], ctx: Ctx, inBranch: boolean): Condition[] {
  const allowed = EVENTS[ctx.trigger].fields;
  const forms = ctx.catalog.forms ?? [];
  const out: Condition[] = [];
  for (const c of raw) {
    const field = text(c.field, 40);
    if (!field) continue;
    const op = (OPS as readonly string[]).includes(c.op as string) ? (c.op as Condition["op"]) : "eq";
    const value = text(c.value, 120);
    if (!value) throw new ValidationError(`Enter a value for the "${field}" condition.`);
    const values = op === "in" ? value.split(",").map((s) => s.trim()) : [value];
    const attrKey = field.match(PRODUCT_FIELD)?.[1];
    const answerKey = field.match(ANSWER_FIELD)?.[1];
    if (CONTACT_FIELD.test(field)) {
      if (!inBranch) throw new ValidationError(`"${field}" can be tested in an If / else step, not in the workflow's starting conditions.`);
      if (field === "contact.tags") {
        if (op !== "contains" && op !== "not_contains") throw new ValidationError("Tags are tested with \"has the tag\" or \"doesn't have the tag\".");
        if (parseTags(value).length !== 1 || parseTags(value)[0].length > TAG_LENGTH) throw new ValidationError("Enter one tag to test.");
        out.push({ field, op, value: parseTags(value)[0] });
        continue;
      }
      if (op === "contains" || op === "not_contains") throw new ValidationError(`"${field}" is tested with is, is not or is one of.`);
      const options = field === "contact.lead_status" ? Object.keys(LEAD_STATUSES) : ["yes", "no"];
      if (values.some((v) => !options.includes(v.toLowerCase()))) throw new ValidationError(`"${field}" accepts: ${options.join(", ")}.`);
      out.push({ field, op, value: value.toLowerCase() });
      continue;
    }
    if (op === "contains" || op === "not_contains") throw new ValidationError("\"has the tag\" only works on a person's tags.");
    if (answerKey) {
      if (ctx.trigger !== "form.submitted") throw new ValidationError("Answer conditions only work on workflows that start when a form is submitted.");
      if (!ctx.form) throw new ValidationError(`To test "${field}", also add the condition form_id is <the form's id>, so the workflow knows which form's questions to use.`);
      const q = ctx.form.questions.find((x) => x.key === answerKey);
      if (!q) throw new ValidationError(`"${ctx.form.name}" has no published question with the key "${answerKey}".`);
      if (q.type !== "dropdown" && q.type !== "radio") throw new ValidationError(`Conditions can test dropdown and radio questions only; "${q.label}" is not one.`);
      if (values.some((v) => !q.options.includes(v))) throw new ValidationError(`"${q.label}" accepts: ${q.options.join(", ")}.`);
    } else if (attrKey) {
      // Package conditions: any attribute this tenant defined for its products.
      const attr = ctx.catalog.attributes.find((a) => a.key === attrKey);
      if (!attr) throw new ValidationError(`"${attrKey}" is not one of your package attributes. Add it in Settings → Package attributes first.`);
      if (attr.kind === "choice" && values.some((v) => !attr.options.includes(v))) throw new ValidationError(`"${attr.label}" accepts: ${attr.options.join(", ")}.`);
    } else {
      if (!Object.prototype.hasOwnProperty.call(allowed, field)) throw new ValidationError(`"${field}" is not a condition this trigger supports.`);
      if (RECORD_FIELDS[field] === "document" && values.some((v) => !ctx.catalog.documents.some((d) => d.id === v))) throw new ValidationError("Choose one of your documents for the document condition.");
      if (RECORD_FIELDS[field] === "form" && values.some((v) => !forms.some((f) => f.id === v))) throw new ValidationError("Use the id of one of your published forms for the form condition (shown on the form's Settings page).");
      const options = allowed[field];
      if (options.length && values.some((v) => !options.includes(v))) throw new ValidationError(`The "${field}" condition accepts: ${options.join(", ")}.`);
    }
    out.push({ field, op, value });
  }
  return out;
}

/** One action step. Throws a plain message the person building the workflow can act on. */
function validateAction(a: RawAction, ctx: Ctx): Action {
  const { templates, catalog, form } = ctx;
  if (a.type === "send_email") {
    const template_id = text(a.template_id, 60);
    if (!templates.some((t) => t.id === template_id)) throw new ValidationError("Choose an email template for each email step.");
    return { type: "send_email", template_id, to: a.to === "support" ? "support" : "customer", include_setup_link: a.include_setup_link === true || a.include_setup_link === "on" };
  }
  if (a.type === "send_document" || a.type === "request_signature") {
    const document_id = text(a.document_id, 60);
    const doc = catalog.documents.find((d) => d.id === document_id && d.status === "active");
    if (!doc) throw new ValidationError("Choose a document from your library for each document step.");
    if (a.type === "request_signature" && doc.file_type !== "pdf") throw new ValidationError(`"${doc.name}" is a Word document. Only PDFs can be signed: export it to PDF and upload that version.`);
    const formFields = (doc.merge_fields ?? []).filter((f) => f.startsWith("form.")).map((f) => f.slice(5));
    if (formFields.length) {
      if (!form) throw new ValidationError(`"${doc.name}" uses form answers ({{form.${formFields[0]}}}). Use it in a workflow that starts when a form is submitted, with the condition form_id is <that form's id>.`);
      const missing = formFields.filter((k) => !form.questions.some((q) => q.key === k));
      if (missing.length) throw new ValidationError(`"${doc.name}" uses ${missing.map((m) => `{{form.${m}}}`).join(", ")}, but "${form.name}" has no published question with ${missing.length > 1 ? "those keys" : "that key"}.`);
    }
    const sender = text(a.sender_id, 60);
    if (sender && !catalog.senders.some((s) => s.id === sender)) throw new ValidationError("Choose one of your sending addresses.");
    const linkDays = Number(numText(a.link_days, 4) || 14);
    if (!Number.isInteger(linkDays) || linkDays < 1 || linkDays > 60) throw new ValidationError("Links can last 1 to 60 days.");
    const message = typeof a.message === "string" ? a.message.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, 1000) : "";
    if (a.type === "send_document") return { type: "send_document", document_id, sender_id: sender || null, message, link_days: linkDays };
    const r = numText(a.reminder_days, 3);
    const reminder = r ? Number(r) : null;
    if (reminder !== null && (!Number.isInteger(reminder) || reminder < 1 || reminder > 30)) throw new ValidationError("Reminders can be every 1 to 30 days, or off.");
    return { type: "request_signature", document_id, sender_id: sender || null, message, link_days: linkDays, reminder_days: reminder };
  }
  if (a.type === "record_note") {
    const note = text(a.note, 300);
    if (!note) throw new ValidationError("Enter the note to record.");
    return { type: "record_note", note };
  }
  if (a.type === "create_task") {
    const title = text(a.title, 200).replace(/\s+/g, " ");
    if (!title) throw new ValidationError("Give the task a title.");
    const raw = numText(a.due_days, 4);
    const due = raw === "" ? null : Number(raw);
    if (due !== null && (!Number.isInteger(due) || due < 0 || due > 365)) throw new ValidationError("A task can be due 0 to 365 days after the step runs, or have no due date.");
    return { type: "create_task", title, due_days: due };
  }
  if (a.type === "add_tag" || a.type === "remove_tag") {
    const tags = parseTags(a.tag);
    if (tags.length !== 1) throw new ValidationError("Enter one tag for each tag step.");
    if (tags[0].length > TAG_LENGTH) throw new ValidationError(`A tag can be up to ${TAG_LENGTH} characters.`);
    return { type: a.type, tag: tags[0] };
  }
  if (a.type === "update_contact") {
    const value = text(a.value, 20);
    if (!Object.prototype.hasOwnProperty.call(LEAD_STATUSES, value)) throw new ValidationError(`Choose a lead status: ${Object.keys(LEAD_STATUSES).join(", ")}.`);
    return { type: "update_contact", field: "lead_status", value };
  }
  if (a.type === "send_text") {
    const body = typeof a.body === "string" ? a.body.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim() : "";
    if (!body) throw new ValidationError("Write the text message.");
    if (body.length > 320) throw new ValidationError("A text can be up to 320 characters.");
    return { type: "send_text", body };
  }
  throw new ValidationError("One of the steps has no type. Choose what each step does.");
}

function validateWait(a: RawAction): Step {
  const unit = a.unit === "minutes" || a.unit === "hours" || a.unit === "days" ? a.unit : null;
  if (!unit) throw new ValidationError("Choose minutes, hours or days for each wait.");
  const amount = Number(numText(a.amount, 5));
  if (!Number.isInteger(amount) || amount < 1 || amount > WAIT_LIMITS[unit]) throw new ValidationError(`A wait can be 1 to ${WAIT_LIMITS[unit]} ${unit}.`);
  return { type: "wait", amount, unit, mode: a.mode === "calendar" ? "calendar" : "business" };
}

function validateStepList(raw: unknown, ctx: Ctx, depth: number): Step[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r): Step => {
    const a = (r && typeof r === "object" ? r : {}) as RawAction & { conditions?: unknown; then?: unknown; else?: unknown };
    if (a.type === "wait") return validateWait(a);
    if (a.type === "branch") {
      if (depth >= MAX_BRANCH_DEPTH) throw new ValidationError(`If / else steps can go ${MAX_BRANCH_DEPTH} levels deep. Simplify this one.`);
      const conditions = validateConditions(Array.isArray(a.conditions) ? (a.conditions as { field: unknown; op: unknown; value: unknown }[]) : [], ctx, true);
      if (conditions.length === 0) throw new ValidationError("Each If / else step needs at least one condition.");
      return { type: "branch", conditions, then: validateStepList(a.then, ctx, depth + 1), else: validateStepList(a.else, ctx, depth + 1) };
    }
    return validateAction(a, ctx);
  });
}

export function validateWorkflowInput(input: WorkflowFormInput, templates: Pick<Template, "id">[], catalog: WorkflowCatalog = EMPTY_CATALOG) {
  const name = text(input.name, 120);
  if (name.length < 2) throw new ValidationError("Give the workflow a name.");
  const trigger = text(input.trigger_event, 60);
  if (!isEventType(trigger)) throw new ValidationError("Choose what starts this workflow.");

  const forms = catalog.forms ?? [];
  // The form a form.submitted workflow is limited to (a form_id "is" condition), for answer conditions and form merge fields.
  const formCondition = input.conditions.find((c) => text(c.field, 40) === "form_id" && (c.op === "eq" || c.op === undefined || c.op === ""));
  const form = trigger === "form.submitted" && formCondition ? forms.find((f) => f.id === text(formCondition.value, 120)) ?? null : null;
  const ctx: Ctx = { trigger, templates, catalog, form };
  const conditions = validateConditions(input.conditions, ctx, false);

  const steps: Step[] = Array.isArray(input.steps) ? validateStepList(input.steps, ctx, 0) : validateStepList(input.actions ?? [], ctx, 0).filter((s) => s.type !== "wait" && s.type !== "branch");
  if (steps.length === 0) throw new ValidationError("Add at least one step.");
  if (!Array.isArray(input.steps) && steps.length > 5) throw new ValidationError("A workflow can have at most 5 steps.");
  if (countSteps(steps) > MAX_STEPS) throw new ValidationError(`A workflow can have at most ${MAX_STEPS} steps, counting the steps inside If / else.`);
  if (branchDepth(steps) > MAX_BRANCH_DEPTH) throw new ValidationError(`If / else steps can go ${MAX_BRANCH_DEPTH} levels deep.`);
  if (flattenActions(steps).length === 0) throw new ValidationError("Add at least one step that does something, not only waits and branches.");

  const dated = trigger.startsWith("date.");
  let trigger_config: Record<string, number> = {};
  if (dated) {
    const offset = Number(numText(input.offset_days, 5) || 0);
    if (!Number.isInteger(offset) || offset < -365 || offset > 365) throw new ValidationError("Choose how many days before (negative) or after the date to start, between -365 and 365.");
    trigger_config = { offset_days: offset };
  }

  const max = Number(input.max_attempts ?? 4);
  const cooldown = Number(input.cooldown_hours ?? 0);
  if (!Number.isInteger(max) || max < 1 || max > 8) throw new ValidationError("Attempts must be between 1 and 8.");
  if (!Number.isInteger(cooldown) || cooldown < 0 || cooldown > 720) throw new ValidationError("The pause between repeats must be 0 to 720 hours.");
  // `steps` is the workflow; `actions` keeps a flat copy of its action steps for "which template is in use" checks.
  const simple = Array.isArray(input.steps) ? false : true;
  return { name, description: text(input.description, 1000) || null, trigger_event: trigger, trigger_config, conditions, actions: flattenActions(steps), steps: simple ? null : steps, max_attempts: max, cooldown_hours: cooldown };
}
