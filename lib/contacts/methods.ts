import { ValidationError } from "../commerce/validation.ts";
import { formatPhone } from "../format/ids.ts";
import type { LeadsRepo } from "../leads/types.ts";
import type { WorkspaceRepo } from "../workspace/types.ts";
import { normalizeEmail, normalizePhone } from "./combine.ts";

// More than one email and phone per person. The email and phone already on a client or lead stay their main (primary) ones, so
// everything that sends or matches by them is unchanged. These are the extras, each with a label. Making one primary swaps it
// with the main one.

export const METHOD_KINDS = { email: "Email", phone: "Phone" } as const;
export type MethodKind = keyof typeof METHOD_KINDS;
export const METHOD_LABELS = { personal: "Personal", work: "Work", mobile: "Mobile", home: "Home", other: "Other" } as const;
export type MethodLabel = keyof typeof METHOD_LABELS;
export const METHODS_MAX = 10;

export type MethodOwner = { kind: "client" | "lead"; id: string };
export type ContactMethod = { id: string; client_id: string | null; lead_id: string | null; kind: MethodKind; label: MethodLabel; value: string; created_at: string };

export type MethodsRepo = {
  list(owner: MethodOwner): Promise<ContactMethod[]>;
  get(id: string): Promise<ContactMethod | null>;
  add(owner: MethodOwner, input: { kind: MethodKind; label: MethodLabel; value: string }, actorId: string | null): Promise<ContactMethod>;
  remove(id: string): Promise<void>;
};
export type MethodsDeps = { methods: MethodsRepo; clients: WorkspaceRepo; leads: LeadsRepo };

const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

/** A typed value, cleaned: an email in lower case, a phone in (555) 123-4567 form. */
export function cleanMethod(kindRaw: unknown, labelRaw: unknown, valueRaw: unknown): { kind: MethodKind; label: MethodLabel; value: string } {
  const kind = typeof kindRaw === "string" && kindRaw in METHOD_KINDS ? (kindRaw as MethodKind) : null;
  if (!kind) throw new ValidationError("Choose email or phone.");
  const label = typeof labelRaw === "string" && labelRaw in METHOD_LABELS ? (labelRaw as MethodLabel) : "other";
  const raw = typeof valueRaw === "string" ? valueRaw.trim() : "";
  if (kind === "email") {
    const e = normalizeEmail(raw);
    if (!e || !EMAIL.test(e) || e.length > 254) throw new ValidationError("Enter a valid email address.");
    return { kind, label, value: e };
  }
  const ten = normalizePhone(raw);
  if (ten) return { kind, label, value: formatPhone(ten) };
  const digits = raw.replace(/\D+/g, "");
  if (raw.startsWith("+") && digits.length >= 8 && digits.length <= 15) return { kind, label, value: `+${digits}` };
  throw new ValidationError("Enter a 10-digit phone number.");
}

type Primary = { email: string | null; phone: string | null; label: string };

async function primaryOf(d: MethodsDeps, owner: MethodOwner): Promise<Primary> {
  if (owner.kind === "client") {
    const c = await d.clients.getClient(owner.id);
    if (!c) throw new ValidationError("That client wasn't found.");
    return { email: c.email, phone: c.phone, label: c.full_name };
  }
  const l = await d.leads.getLead(owner.id);
  if (!l) throw new ValidationError("That lead wasn't found.");
  return { email: l.email, phone: l.phone, label: l.full_name };
}

const same = (kind: MethodKind, a: string | null, b: string) => (kind === "email" ? normalizeEmail(a) === b : normalizePhone(a) !== null && normalizePhone(a) === normalizePhone(b));

async function note(d: MethodsDeps, owner: MethodOwner, action: string, text: string, actorId: string | null) {
  try {
    if (owner.kind === "client") await d.clients.addClientEvent({ clientId: owner.id, action, actorId, detail: { name: text } });
    else await d.leads.addEvent({ lead_id: owner.id, action, detail: { name: text }, actor_id: actorId });
  } catch { /* the change is saved; its note is a courtesy */ }
}

/** The person's primary email and phone, then the extras. */
export async function methodsFor(d: MethodsDeps, owner: MethodOwner): Promise<{ primary: Primary; extras: ContactMethod[] }> {
  return { primary: await primaryOf(d, owner), extras: await d.methods.list(owner) };
}

export async function addMethod(d: MethodsDeps, owner: MethodOwner, raw: { kind: unknown; label: unknown; value: unknown }, actorId: string | null): Promise<ContactMethod> {
  const m = cleanMethod(raw.kind, raw.label, raw.value);
  const primary = await primaryOf(d, owner);
  if (same(m.kind, m.kind === "email" ? primary.email : primary.phone, m.value)) throw new ValidationError(`That is already ${primary.label}'s main ${m.kind}.`);
  const extras = await d.methods.list(owner);
  if (extras.some((x) => x.kind === m.kind && same(m.kind, x.value, m.value))) throw new ValidationError(`That ${m.kind} is already on this person.`);
  if (extras.filter((x) => x.kind === m.kind).length >= METHODS_MAX) throw new ValidationError(`Up to ${METHODS_MAX} extra ${m.kind === "email" ? "emails" : "phone numbers"} per person.`);
  const saved = await d.methods.add(owner, m, actorId);
  await note(d, owner, "contact.method_added", `${METHOD_LABELS[m.label]} ${m.kind}: ${m.value}`, actorId);
  return saved;
}

export async function removeMethod(d: MethodsDeps, owner: MethodOwner, id: string, actorId: string | null): Promise<void> {
  const m = await d.methods.get(id);
  if (!m || (owner.kind === "client" ? m.client_id !== owner.id : m.lead_id !== owner.id)) throw new ValidationError("That contact detail wasn't found.");
  await d.methods.remove(m.id);
  await note(d, owner, "contact.method_removed", `${m.kind}: ${m.value}`, actorId);
}

/** Makes an extra the main email or phone. The old main one becomes an extra, so nothing is lost. */
export async function makePrimary(d: MethodsDeps, owner: MethodOwner, id: string, actorId: string | null): Promise<void> {
  const m = await d.methods.get(id);
  if (!m || (owner.kind === "client" ? m.client_id !== owner.id : m.lead_id !== owner.id)) throw new ValidationError("That contact detail wasn't found.");
  const primary = await primaryOf(d, owner);
  const old = m.kind === "email" ? primary.email : primary.phone;
  if (m.kind === "email" && owner.kind === "lead") {
    const other = await d.leads.findByEmail(m.value);
    if (other && other.id !== owner.id) throw new ValidationError(`${m.value} is already the email of another lead (${other.full_name}).`);
  }
  // Remove the extra first (its value is unique per person), then save the new main one, then keep the old main one as an extra.
  await d.methods.remove(m.id);
  try {
    if (owner.kind === "client") await d.clients.updateClient(owner.id, m.kind === "email" ? { email: m.value } : { phone: m.value });
    else await d.leads.updateLead(owner.id, m.kind === "email" ? { email: m.value } : { phone: m.value });
  } catch (e) {
    await d.methods.add(owner, { kind: m.kind, label: m.label, value: m.value }, actorId); // put it back: nothing changed
    throw e;
  }
  if (old && !same(m.kind, old, m.value)) await d.methods.add(owner, { kind: m.kind, label: "other", value: old }, actorId).catch(() => undefined);
  await note(d, owner, "contact.primary_changed", `${m.kind === "email" ? "Email" : "Phone"} ${m.value}`, actorId);
}
