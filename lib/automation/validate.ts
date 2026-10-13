import { ValidationError } from "../commerce/validation.ts";
import { EVENTS, isEventType, RECORD_FIELDS } from "./events.ts";
import { ANSWER_FIELD, PRODUCT_FIELD } from "./engine.ts";
import { renderTemplate, SAMPLE_VALUES, unknownVariables } from "./template.ts";
import type { Action, Condition, NewTemplate, Template } from "./types.ts";

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, max) : "");

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

export type WorkflowFormInput = {
  name: unknown;
  description?: unknown;
  trigger_event: unknown;
  conditions: { field: unknown; op: unknown; value: unknown }[];
  actions: { type: unknown; template_id?: unknown; to?: unknown; include_setup_link?: unknown; note?: unknown; document_id?: unknown; sender_id?: unknown; message?: unknown; link_days?: unknown; reminder_days?: unknown }[];
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

export function validateWorkflowInput(input: WorkflowFormInput, templates: Pick<Template, "id">[], catalog: WorkflowCatalog = EMPTY_CATALOG) {
  const name = text(input.name, 120);
  if (name.length < 2) throw new ValidationError("Give the workflow a name.");
  const trigger = text(input.trigger_event, 60);
  if (!isEventType(trigger)) throw new ValidationError("Choose what starts this workflow.");
  const allowed = EVENTS[trigger].fields;

  const forms = catalog.forms ?? [];
  // The form a form.submitted workflow is limited to (a form_id "is" condition), for answer conditions and form merge fields.
  const formCondition = input.conditions.find((c) => text(c.field, 40) === "form_id" && (c.op === "eq" || c.op === undefined || c.op === ""));
  const form = trigger === "form.submitted" && formCondition ? forms.find((f) => f.id === text(formCondition.value, 120)) ?? null : null;
  const conditions: Condition[] = [];
  for (const c of input.conditions) {
    const field = text(c.field, 40);
    if (!field) continue;
    const op = c.op === "neq" || c.op === "in" ? c.op : "eq";
    const value = text(c.value, 120);
    if (!value) throw new ValidationError(`Enter a value for the "${field}" condition.`);
    const values = op === "in" ? value.split(",").map((s) => s.trim()) : [value];
    const attrKey = field.match(PRODUCT_FIELD)?.[1];
    const answerKey = field.match(ANSWER_FIELD)?.[1];
    if (answerKey) {
      if (trigger !== "form.submitted") throw new ValidationError("Answer conditions only work on workflows that start when a form is submitted.");
      if (!form) throw new ValidationError(`To test "${field}", also add the condition form_id is <the form's id>, so the workflow knows which form's questions to use.`);
      const q = form.questions.find((x) => x.key === answerKey);
      if (!q) throw new ValidationError(`"${form.name}" has no published question with the key "${answerKey}".`);
      if (q.type !== "dropdown" && q.type !== "radio") throw new ValidationError(`Conditions can test dropdown and radio questions only; "${q.label}" is not one.`);
      if (values.some((v) => !q.options.includes(v))) throw new ValidationError(`"${q.label}" accepts: ${q.options.join(", ")}.`);
    } else if (attrKey) {
      // Package conditions: any attribute this tenant defined for its products.
      const attr = catalog.attributes.find((a) => a.key === attrKey);
      if (!attr) throw new ValidationError(`"${attrKey}" is not one of your package attributes. Add it in Settings → Package attributes first.`);
      if (attr.kind === "choice" && values.some((v) => !attr.options.includes(v))) throw new ValidationError(`"${attr.label}" accepts: ${attr.options.join(", ")}.`);
    } else {
      if (!Object.prototype.hasOwnProperty.call(allowed, field)) throw new ValidationError(`"${field}" is not a condition this trigger supports.`);
      if (RECORD_FIELDS[field] === "document" && values.some((v) => !catalog.documents.some((d) => d.id === v))) throw new ValidationError("Choose one of your documents for the document condition.");
      if (RECORD_FIELDS[field] === "form" && values.some((v) => !forms.some((f) => f.id === v))) throw new ValidationError("Use the id of one of your published forms for the form condition (shown on the form's Settings page).");
      const options = allowed[field];
      if (options.length && values.some((v) => !options.includes(v))) throw new ValidationError(`The "${field}" condition accepts: ${options.join(", ")}.`);
    }
    conditions.push({ field, op, value });
  }

  const actions: Action[] = [];
  for (const a of input.actions) {
    if (a.type === "send_email") {
      const template_id = text(a.template_id, 60);
      if (!templates.some((t) => t.id === template_id)) throw new ValidationError("Choose an email template for each email step.");
      const to = a.to === "support" ? "support" : "customer";
      actions.push({ type: "send_email", template_id, to, include_setup_link: a.include_setup_link === true || a.include_setup_link === "on" });
    } else if (a.type === "send_document" || a.type === "request_signature") {
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
      const linkDays = Number(text(a.link_days, 4) || 14);
      if (!Number.isInteger(linkDays) || linkDays < 1 || linkDays > 60) throw new ValidationError("Links can last 1 to 60 days.");
      const message = typeof a.message === "string" ? a.message.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, 1000) : "";
      if (a.type === "send_document") {
        actions.push({ type: "send_document", document_id, sender_id: sender || null, message, link_days: linkDays });
      } else {
        const r = text(a.reminder_days, 3);
        const reminder = r ? Number(r) : null;
        if (reminder !== null && (!Number.isInteger(reminder) || reminder < 1 || reminder > 30)) throw new ValidationError("Reminders can be every 1 to 30 days, or off.");
        actions.push({ type: "request_signature", document_id, sender_id: sender || null, message, link_days: linkDays, reminder_days: reminder });
      }
    } else if (a.type === "record_note") {
      const note = text(a.note, 300);
      if (!note) throw new ValidationError("Enter the note to record.");
      actions.push({ type: "record_note", note });
    }
  }
  if (actions.length === 0) throw new ValidationError("Add at least one step.");
  if (actions.length > 5) throw new ValidationError("A workflow can have at most 5 steps.");

  const max = Number(input.max_attempts ?? 4);
  const cooldown = Number(input.cooldown_hours ?? 0);
  if (!Number.isInteger(max) || max < 1 || max > 8) throw new ValidationError("Attempts must be between 1 and 8.");
  if (!Number.isInteger(cooldown) || cooldown < 0 || cooldown > 720) throw new ValidationError("The pause between repeats must be 0 to 720 hours.");
  return { name, description: text(input.description, 1000) || null, trigger_event: trigger, conditions, actions, max_attempts: max, cooldown_hours: cooldown };
}
