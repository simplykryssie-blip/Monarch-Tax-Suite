import { ValidationError } from "../commerce/validation.ts";
import { EVENTS, isEventType } from "./events.ts";
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
  actions: { type: unknown; template_id?: unknown; to?: unknown; include_setup_link?: unknown; note?: unknown }[];
  max_attempts?: unknown;
  cooldown_hours?: unknown;
};

export function validateWorkflowInput(input: WorkflowFormInput, templates: Pick<Template, "id">[]) {
  const name = text(input.name, 120);
  if (name.length < 2) throw new ValidationError("Give the workflow a name.");
  const trigger = text(input.trigger_event, 60);
  if (!isEventType(trigger)) throw new ValidationError("Choose what starts this workflow.");
  const allowed = EVENTS[trigger].fields;

  const conditions: Condition[] = [];
  for (const c of input.conditions) {
    const field = text(c.field, 40);
    if (!field) continue;
    const op = c.op === "neq" || c.op === "in" ? c.op : "eq";
    const value = text(c.value, 120);
    if (!Object.prototype.hasOwnProperty.call(allowed, field)) throw new ValidationError(`"${field}" is not a condition this trigger supports.`);
    if (!value) throw new ValidationError(`Enter a value for the "${field}" condition.`);
    const options = allowed[field];
    const values = op === "in" ? value.split(",").map((s) => s.trim()) : [value];
    if (options.length && values.some((v) => !options.includes(v))) throw new ValidationError(`The "${field}" condition accepts: ${options.join(", ")}.`);
    conditions.push({ field, op, value });
  }

  const actions: Action[] = [];
  for (const a of input.actions) {
    if (a.type === "send_email") {
      const template_id = text(a.template_id, 60);
      if (!templates.some((t) => t.id === template_id)) throw new ValidationError("Choose an email template for each email step.");
      const to = a.to === "support" ? "support" : "customer";
      actions.push({ type: "send_email", template_id, to, include_setup_link: a.include_setup_link === true || a.include_setup_link === "on" });
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
