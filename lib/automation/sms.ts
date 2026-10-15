import { ValidationError } from "../commerce/validation.ts";
import { variablesIn, VARIABLES } from "./template.ts";

// SMS templates: short plain text with {{placeholders}}. No formatting. They are saved here and ready to use once text
// messaging is connected; nothing sends a text today.

export type SmsTemplate = { id: string; tenant_id: string; name: string; body: string; active: boolean; created_by: string | null; created_at: string; updated_at: string };
export type SmsInput = { name: unknown; body: unknown };
export interface SmsRepo {
  list(): Promise<SmsTemplate[]>;
  get(id: string): Promise<SmsTemplate | null>;
  insert(input: { name: string; body: string; created_by: string | null }): Promise<SmsTemplate>;
  update(id: string, patch: Partial<Pick<SmsTemplate, "name" | "body" | "active">>): Promise<SmsTemplate>;
}

export const SMS_MAX = 480;
/** Placeholders that make sense in a text message (not the long, multi-line ones). */
export const SMS_VARIABLES: Record<string, string> = Object.fromEntries(Object.entries(VARIABLES).filter(([k]) => !["embed_instructions"].includes(k)));

export function checkSms(input: SmsInput): { name: string; body: string } {
  const name = typeof input.name === "string" ? input.name.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  if (name.length < 2) throw new ValidationError("Give the text template a name.");
  // Plain text only: line breaks are kept, formatting marks are just characters.
  const body = typeof input.body === "string" ? input.body.replace(/\r\n/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim() : "";
  if (!body) throw new ValidationError("Write the message.");
  if (body.length > SMS_MAX) throw new ValidationError(`A text template can be up to ${SMS_MAX} characters.`);
  const unknown = variablesIn(body).filter((v) => !(v in SMS_VARIABLES));
  if (unknown.length) throw new ValidationError(`Unknown placeholder${unknown.length > 1 ? "s" : ""}: ${unknown.map((u) => `{{${u}}}`).join(", ")}.`);
  return { name, body };
}

/** How many 160-character messages this will use (a rough guide; long messages are split by carriers). */
export const smsSegments = (body: string) => (body.length <= 160 ? 1 : Math.ceil(body.length / 153));

export async function createSms(repo: SmsRepo, input: SmsInput, actorId: string): Promise<SmsTemplate> {
  return repo.insert({ ...checkSms(input), created_by: actorId });
}
export async function updateSms(repo: SmsRepo, id: string, input: SmsInput): Promise<SmsTemplate> {
  if (!(await repo.get(id))) throw new ValidationError("That text template wasn't found.");
  return repo.update(id, checkSms(input));
}
export async function setSmsActive(repo: SmsRepo, id: string, active: boolean): Promise<SmsTemplate> {
  if (!(await repo.get(id))) throw new ValidationError("That text template wasn't found.");
  return repo.update(id, { active });
}
