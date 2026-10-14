import { ValidationError } from "../commerce/validation.ts";
import { LEAD_SOURCES, LEAD_STATUSES, SOURCE_KEYS, STATUS_KEYS, type Lead, type LeadFilter, type LeadSource, type LeadStatus, type LeadsDeps } from "./types.ts";
import { parseCsv } from "./csv.ts";
import { parseTags, TAG_LENGTH, TAG_MAX } from "./tags.ts";

// The Leads pipeline for one tenant: add, edit, contact and convert leads, capture them from the WISP audit, link them
// to the customer and order when they buy, and CSV import and export. One person (one email) is one lead.

export const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const IMPORT_MAX_ROWS = 2000;

export class LeadInputError extends ValidationError {
  readonly field: string;
  constructor(message: string, field: string) {
    super(message);
    this.field = field;
  }
}

const nowOf = (deps: LeadsDeps) => deps.now?.() ?? new Date();
const text = (raw: unknown, max: number) => (typeof raw === "string" ? raw.trim().replace(/\s+/g, " ").slice(0, max) : "");
const optional = (raw: unknown, max: number) => text(raw, max) || null;

export const isSource = (v: unknown): v is LeadSource => typeof v === "string" && (SOURCE_KEYS as string[]).includes(v);
export const isStatus = (v: unknown): v is LeadStatus => typeof v === "string" && (STATUS_KEYS as string[]).includes(v);

export function checkName(raw: unknown): string {
  const v = text(raw, 200);
  if (!v) throw new LeadInputError("Please enter your name.", "name");
  return v;
}

export function checkEmail(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (v.length > 254 || !EMAIL.test(v)) throw new LeadInputError("Please enter a valid email address.", "email");
  return v;
}

/** A phone number: 10 to 15 digits, written any common way ("(337) 555-0100", "+1 337 555 0100"). */
export function checkPhone(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ").slice(0, 40) : "";
  const digits = v.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15 || /[^\d\s()+.\-]/.test(v)) throw new LeadInputError("Please enter a valid phone number.", "phone");
  return v;
}

/** A date typed in a form (YYYY-MM-DD) as a timestamp at noon Eastern, or null when blank. */
export function checkDate(raw: unknown, label: string): string | null {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T12:00:00Z`))) throw new LeadInputError(`${label} isn't a valid date.`, "last_contacted_at");
  return new Date(`${v}T16:00:00Z`).toISOString();
}

export { parseTags, TAG_LENGTH, TAG_MAX };

export function checkTags(raw: unknown): string[] {
  const tags = parseTags(raw);
  if (tags.some((t) => t.length > TAG_LENGTH)) throw new LeadInputError(`Each tag can be up to ${TAG_LENGTH} characters.`, "tags");
  if (tags.length > TAG_MAX) throw new LeadInputError(`A lead can have up to ${TAG_MAX} tags.`, "tags");
  return tags;
}

export type LeadForm = { full_name: string; email: string; phone: string | null; firm_name: string | null; source: LeadSource; status: LeadStatus; notes: string | null; tags: string[]; last_contacted_at: string | null };

/** What the admin typed into the add or edit form, checked. */
export function checkLeadForm(raw: Record<string, unknown>): LeadForm {
  const notes = typeof raw.notes === "string" ? raw.notes.trim().slice(0, 10000) : "";
  if (!isSource(raw.source)) throw new LeadInputError("Choose where this lead came from.", "source");
  const status = raw.status === undefined || raw.status === "" ? "new" : raw.status;
  if (!isStatus(status)) throw new LeadInputError("Choose a status.", "status");
  return {
    full_name: (() => { try { return checkName(raw.full_name); } catch { throw new LeadInputError("Enter the lead's name.", "full_name"); } })(),
    email: checkEmail(raw.email),
    phone: optional(raw.phone, 40),
    firm_name: optional(raw.firm_name, 200),
    source: raw.source,
    status,
    notes: notes || null,
    tags: checkTags(raw.tags),
    last_contacted_at: checkDate(raw.last_contacted_at, "Last contacted"),
  };
}

const blank = { phone: null, firm_name: null, notes: null, tags: [] as string[], last_contacted_at: null, audit_id: null, audit_score: null, wisp_plan_id: null, customer_id: null, order_id: null, organization_id: null, converted_at: null };

// ------------------------------------------------------------------ admin

export async function createLead(deps: LeadsDeps, raw: Record<string, unknown>, actorId: string): Promise<Lead> {
  const f = checkLeadForm(raw);
  const existing = await deps.repo.findByEmail(f.email);
  if (existing) throw new LeadInputError(`${f.email} is already a lead (${existing.full_name}).`, "email");
  const lead = await deps.repo.insertLead({ ...blank, ...f, converted_at: f.status === "converted" ? nowOf(deps).toISOString() : null });
  await deps.repo.addEvent({ lead_id: lead.id, action: "created", detail: { source: lead.source }, actor_id: actorId });
  return lead;
}

export async function updateLead(deps: LeadsDeps, id: string, raw: Record<string, unknown>, actorId: string): Promise<Lead> {
  const lead = await deps.repo.getLead(id);
  if (!lead) throw new ValidationError("That lead wasn't found.");
  const f = checkLeadForm(raw);
  if (f.email !== lead.email) {
    const other = await deps.repo.findByEmail(f.email);
    if (other && other.id !== id) throw new LeadInputError(`${f.email} is already a lead (${other.full_name}).`, "email");
  }
  const patch: Partial<Lead> = { ...f };
  if (f.status === "converted" && !lead.converted_at) patch.converted_at = nowOf(deps).toISOString();
  const after = await deps.repo.updateLead(id, patch);
  const same = (a: unknown, b: unknown) => (Array.isArray(a) || Array.isArray(b) ? JSON.stringify(a ?? []) === JSON.stringify(b ?? []) : (a ?? null) === (b ?? null));
  const changed = (Object.keys(f) as (keyof LeadForm)[]).filter((k) => k !== "status" && !same(f[k], lead[k]));
  if (lead.status !== after.status) await deps.repo.addEvent({ lead_id: id, action: "status_changed", detail: { from: lead.status, to: after.status }, actor_id: actorId });
  if (changed.length) await deps.repo.addEvent({ lead_id: id, action: "edited", detail: { fields: changed }, actor_id: actorId });
  return after;
}

/** "Contacted today": records the date, and moves a new lead to Contacted. */
export async function markContacted(deps: LeadsDeps, id: string, actorId: string): Promise<Lead> {
  const lead = await deps.repo.getLead(id);
  if (!lead) throw new ValidationError("That lead wasn't found.");
  const after = await deps.repo.updateLead(id, { last_contacted_at: nowOf(deps).toISOString(), ...(lead.status === "new" ? { status: "contacted" as const } : {}) });
  await deps.repo.addEvent({ lead_id: id, action: "contacted", detail: lead.status === after.status ? {} : { from: lead.status, to: after.status }, actor_id: actorId });
  return after;
}

export async function deleteLead(deps: LeadsDeps, id: string): Promise<void> {
  if (!(await deps.repo.getLead(id))) throw new ValidationError("That lead wasn't found.");
  await deps.repo.deleteLead(id);
}

// ------------------------------------------------------------------ funnels

/**
 * The WISP audit's first step: name, email and phone before the questions. Creates the lead (source WISP audit), or,
 * when this email is already a lead, notes the new start and fills in a missing phone. Status and source are left alone.
 */
export async function captureAuditStart(deps: LeadsDeps, raw: { name: unknown; email: unknown; phone: unknown }): Promise<Lead> {
  return captureStart(deps, raw, "wisp_audit", "audit_started");
}

/**
 * The WISP builder's first step ("Identifying Information"): business name, email and phone. Saves the visitor as a lead
 * (source WISP builder) so they are in Leads even if they never pay. An email that is already a lead keeps its source
 * and status; a missing phone is filled in.
 */
export async function captureBuilderStart(deps: LeadsDeps, raw: { name: unknown; email: unknown; phone: unknown }): Promise<Lead> {
  return captureStart(deps, raw, "wisp_builder", "builder_started");
}

async function captureStart(deps: LeadsDeps, raw: { name: unknown; email: unknown; phone: unknown }, source: "wisp_audit" | "wisp_builder", action: string): Promise<Lead> {
  const full_name = checkName(raw.name);
  const email = checkEmail(raw.email);
  const phone = checkPhone(raw.phone);
  const existing = await deps.repo.findByEmail(email);
  if (existing) {
    const after = existing.phone ? existing : await deps.repo.updateLead(existing.id, { phone });
    await deps.repo.addEvent({ lead_id: existing.id, action, detail: existing.phone && existing.phone !== phone ? { phone_given: phone } : {}, actor_id: null });
    return after;
  }
  let lead: Lead;
  try {
    lead = await deps.repo.insertLead({ ...blank, full_name, email, phone, source, status: "new" });
  } catch (e) {
    // The same person sending the form twice at once: the second one joins the first.
    const again = await deps.repo.findByEmail(email);
    if (!again) throw e;
    return again;
  }
  await deps.repo.addEvent({ lead_id: lead.id, action: "created", detail: { source, started: true }, actor_id: null });
  return lead;
}

/**
 * The finished WISP audit: its score goes on the lead who started it (found by email). If starting didn't save the
 * lead, it's created here from the same details.
 */
export async function captureAuditLead(deps: LeadsDeps, raw: { name: unknown; email: unknown; phone?: unknown }, audit: { id: string; score: number }): Promise<Lead> {
  const full_name = checkName(raw.name);
  const email = checkEmail(raw.email);
  const phone = raw.phone === undefined || raw.phone === "" ? null : checkPhone(raw.phone);
  const existing = await deps.repo.findByEmail(email);
  if (existing) {
    const after = await deps.repo.updateLead(existing.id, { audit_id: audit.id, audit_score: audit.score, ...(!existing.phone && phone ? { phone } : {}) });
    await deps.repo.addEvent({ lead_id: existing.id, action: "audit_taken", detail: { score: audit.score, audit_id: audit.id }, actor_id: null });
    return after;
  }
  let lead: Lead;
  try {
    lead = await deps.repo.insertLead({ ...blank, full_name, email, phone, source: "wisp_audit", status: "new", audit_id: audit.id, audit_score: audit.score });
  } catch (e) {
    const again = await deps.repo.findByEmail(email);
    if (!again) throw e;
    return again;
  }
  await deps.repo.addEvent({ lead_id: lead.id, action: "created", detail: { source: "wisp_audit", score: audit.score, audit_id: audit.id }, actor_id: null });
  return lead;
}

/**
 * A paid WISP: the lead who took that audit (or, failing that, who has the buyer's email) is linked to the customer,
 * order and plan, and marked Converted. Nothing happens when the buyer was never a lead. Safe to call again.
 */
export async function convertFromPurchase(deps: LeadsDeps, input: { auditId: string | null; email: string; planId: string; customerId: string; orderId: string }): Promise<Lead | null> {
  const lead = (input.auditId ? await deps.repo.findByAudit(input.auditId) : null) ?? (await deps.repo.findByEmail(input.email.trim().toLowerCase()));
  if (!lead) return null;
  if (lead.order_id === input.orderId && lead.status === "converted") return lead;
  const after = await deps.repo.updateLead(lead.id, {
    status: "converted", converted_at: lead.converted_at ?? nowOf(deps).toISOString(),
    customer_id: input.customerId, order_id: input.orderId, wisp_plan_id: input.planId,
  });
  await deps.repo.addEvent({ lead_id: lead.id, action: "converted", detail: { from: lead.status, order_id: input.orderId, customer_id: input.customerId, product: "WISP" }, actor_id: null });
  return after;
}

// ------------------------------------------------------------------ list filters

/** The list's search and filters from the page address, checked. */
export function filterFrom(sp: Record<string, string | undefined>): LeadFilter {
  const day = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : undefined);
  const tags = parseTags(sp.tags).slice(0, TAG_MAX);
  return {
    ...(tags.length ? { tags } : {}),
    q: text(sp.q, 100) || undefined,
    source: isSource(sp.source) ? sp.source : undefined,
    status: isStatus(sp.status) ? sp.status : undefined,
    from: day(sp.from),
    to: day(sp.to),
  };
}

/** The same filter in memory: search in name, email and firm; created on or between the two dates (Eastern). */
export function matchesFilter(lead: Lead, f: LeadFilter): boolean {
  if (f.source && lead.source !== f.source) return false;
  if (f.status && lead.status !== f.status) return false;
  if (f.tags?.length && !f.tags.every((t) => lead.tags.includes(t))) return false;
  if (f.from && lead.created_at < dayStart(f.from)) return false;
  if (f.to && lead.created_at >= dayStart(f.to, 1)) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    if (![lead.full_name, lead.email, lead.firm_name ?? ""].some((v) => v.toLowerCase().includes(q))) return false;
  }
  return true;
}

/** Midnight Eastern (standard time, so a day never loses a lead) at the start of a YYYY-MM-DD day, plus `add` days. */
export function dayStart(day: string, add = 0): string {
  const d = new Date(`${day}T05:00:00Z`);
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString();
}

// ------------------------------------------------------------------ CSV

const HEADERS: Record<string, keyof LeadForm> = {
  name: "full_name", "full name": "full_name", "full_name": "full_name", "contact name": "full_name",
  email: "email", "email address": "email", "e-mail": "email",
  phone: "phone", "phone number": "phone", mobile: "phone", cell: "phone",
  firm: "firm_name", "firm name": "firm_name", "firm_name": "firm_name", company: "firm_name", business: "firm_name",
  source: "source", status: "status", notes: "notes", note: "notes", tags: "tags", tag: "tags", labels: "tags",
  "last contacted": "last_contacted_at", "last_contacted": "last_contacted_at", "last contacted date": "last_contacted_at",
};
const byLabel = <T extends string>(labels: Record<T, string>, v: string): T | undefined => {
  const s = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (Object.keys(labels) as T[]).find((k) => k === s || labels[k].toLowerCase().replace(/[\s-]+/g, "_") === s);
};
/** Dates in a spreadsheet: 2026-10-13 or 10/13/2026. */
const csvDate = (v: string) => {
  const t = v.trim();
  const us = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return us ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}` : t;
};

export type ImportResult = { added: number; skipped: { row: number; reason: string }[] };

/**
 * Adds a lead for each row of a spreadsheet's CSV. Columns are matched by their header (Name and Email are required;
 * Phone, Firm, Source, Status, Notes and Last contacted are optional). Rows without a known source get the one chosen
 * for the import. An email that is already a lead, or appears twice, is skipped and listed.
 */
export async function importCsv(deps: LeadsDeps, csv: string, defaultSource: LeadSource, actorId: string): Promise<ImportResult> {
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new ValidationError("That file has no rows under its header.");
  if (rows.length - 1 > IMPORT_MAX_ROWS) throw new ValidationError(`That file has ${rows.length - 1} rows. Import up to ${IMPORT_MAX_ROWS} at a time.`);
  const cols = rows[0].map((h) => HEADERS[h.trim().toLowerCase().replace(/^﻿/, "")]);
  if (!cols.includes("full_name") || !cols.includes("email")) throw new ValidationError("The first row must name the columns, including Name and Email.");
  const result: ImportResult = { added: 0, skipped: [] };
  const parsed: { row: number; form: LeadForm }[] = [];
  for (let i = 1; i < rows.length; i++) {
    // Undo the apostrophe our own export adds in front of a leading +, -, = or @.
    const cells = rows[i].map((c) => c.replace(/^'(?=[=+\-@])/, ""));
    if (cells.every((c) => !c.trim())) continue;
    const raw: Record<string, unknown> = {};
    cols.forEach((k, j) => { if (k) raw[k] = cells[j] ?? ""; });
    raw.source = (typeof raw.source === "string" && byLabel(LEAD_SOURCES, raw.source)) || defaultSource;
    raw.status = (typeof raw.status === "string" && raw.status.trim() ? byLabel(LEAD_STATUSES, raw.status) ?? "invalid" : "new");
    if (typeof raw.last_contacted_at === "string") raw.last_contacted_at = csvDate(raw.last_contacted_at);
    try {
      parsed.push({ row: i + 1, form: checkLeadForm(raw) });
    } catch (e) {
      result.skipped.push({ row: i + 1, reason: e instanceof Error ? e.message : "Not valid." });
    }
  }
  const existing = await deps.repo.existingEmails(parsed.map((p) => p.form.email));
  const seen = new Set<string>();
  for (const { row, form } of parsed) {
    if (existing.has(form.email)) { result.skipped.push({ row, reason: `${form.email} is already a lead.` }); continue; }
    if (seen.has(form.email)) { result.skipped.push({ row, reason: `${form.email} appears more than once in the file.` }); continue; }
    seen.add(form.email);
    const lead = await deps.repo.insertLead({ ...blank, ...form, converted_at: form.status === "converted" ? nowOf(deps).toISOString() : null });
    await deps.repo.addEvent({ lead_id: lead.id, action: "imported", detail: { source: lead.source, row }, actor_id: actorId });
    result.added++;
  }
  result.skipped.sort((a, b) => a.row - b.row);
  return result;
}

const cell = (v: unknown) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheet formula injection
  return `"${s.replace(/"/g, '""')}"`;
};
const day = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(iso)) : "");

/** The leads as CSV, in the same columns the import reads (plus the audit score and dates). */
export function exportCsv(leads: Lead[]): string {
  const head = ["Name", "Email", "Phone", "Firm", "Source", "Status", "Tags", "Audit score", "Notes", "Created", "Last contacted", "Converted"];
  const lines = [head.map(cell).join(",")];
  for (const l of leads) {
    lines.push([l.full_name, l.email, l.phone, l.firm_name, LEAD_SOURCES[l.source], LEAD_STATUSES[l.status], l.tags.join(", "), l.audit_score ?? "", l.notes, day(l.created_at), day(l.last_contacted_at), day(l.converted_at)].map(cell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}
