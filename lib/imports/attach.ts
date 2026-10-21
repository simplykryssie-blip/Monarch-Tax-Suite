import { ValidationError } from "../commerce/validation.ts";
import { parseCsv } from "../leads/csv.ts";
import { clean, EMAIL, headingOf, phoneKey, undoGuard } from "./contacts.ts";

// Notes and messages from another CRM come as their own files, one row each, naming the person they belong to. They are
// attached to people already in the account (matched by email, phone, or for firms by name); a row whose person can't be
// found is left out and listed. Messages are only ever written down as history: nothing is sent, and no automation runs.

export const ATTACH_MAX_ROWS = 5000;

export type Matchable = { id: string; name: string | null; email: string | null; phone: string | null };
export type PlannedNote = { row: number; personId: string; person: string; text: string; at: string | null };
export type PlannedMessage = { row: number; personId: string; person: string; direction: "in" | "out"; channel: "email" | "sms" | "call" | "other"; subject: string | null; body: string; at: string | null };
export type AttachPlan<T> = { add: T[]; skipped: { row: number; reason: string }[]; total: number; columns: { used: string[]; unknown: string[] } };

const ALIAS: Record<string, string> = {
  "email": "email", "email address": "email", "contact email": "email", "e-mail": "email",
  "phone": "phone", "phone number": "phone", "contact phone": "phone", "mobile": "phone",
  "name": "name", "contact name": "name", "full name": "name", "business name": "name", "company name": "name", "firm name": "name", "client name": "name",
  "note": "text", "notes": "text", "note body": "text", "body": "text", "text": "text", "content": "text", "comment": "text", "message": "text", "message body": "text",
  "date": "date", "created": "date", "created at": "date", "date created": "date", "date added": "date", "created on": "date", "timestamp": "date", "sent at": "date", "time": "date",
  "direction": "direction", "message direction": "direction",
  "type": "channel", "channel": "channel", "message type": "channel",
  "subject": "subject",
};

/** A date as spreadsheets write it (2025-01-02, 1/2/2025, 1/2/2025 3:04 PM, full ISO), as an ISO moment, or null. */
export function readDate(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  let t: number;
  const us = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
  if (us) {
    const year = us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
    let hour = us[4] ? Number(us[4]) : 12;
    if (us[7]) hour = (hour % 12) + (us[7].toUpperCase() === "PM" ? 12 : 0);
    t = Date.UTC(year, Number(us[1]) - 1, Number(us[2]), hour, us[5] ? Number(us[5]) : 0, us[6] ? Number(us[6]) : 0);
  } else t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  const y = new Date(t).getUTCFullYear();
  return y >= 1990 && y <= 2100 ? new Date(t).toISOString() : null;
}

export const channelOf = (raw: string): "email" | "sms" | "call" | "other" => {
  const v = raw.toLowerCase();
  return /sms|text|whatsapp|mms/.test(v) ? "sms" : /mail/.test(v) ? "email" : /call|voice|phone/.test(v) ? "call" : "other";
};
export const directionOf = (raw: string): "in" | "out" => (/^(in|inbound|incoming|received|receive|from contact|client)/i.test(raw.trim()) ? "in" : "out");

function read(csv: string, wantText: boolean, people: Matchable[], what: string) {
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new ValidationError("That file has no rows under its header.");
  if (rows.length - 1 > ATTACH_MAX_ROWS) throw new ValidationError(`That file has ${rows.length - 1} rows. Import up to ${ATTACH_MAX_ROWS} at a time.`);
  const headings = rows[0].map(headingOf);
  const cols = headings.map((h) => ALIAS[h] ?? "");
  const has = (k: string) => cols.includes(k);
  if (!has("email") && !has("phone") && !has("name")) throw new ValidationError(`The file must name the person each ${what} belongs to: an Email, Phone or Name column.`);
  if (wantText && !has("text")) throw new ValidationError(`The file needs a column with the ${what} itself (Note, Body or Message).`);
  const byEmail = new Map(people.filter((p) => p.email).map((p) => [p.email!.toLowerCase(), p]));
  const byPhone = new Map(people.filter((p) => phoneKey(p.phone)).map((p) => [phoneKey(p.phone), p]));
  const byName = new Map(people.filter((p) => p.name).map((p) => [p.name!.toLowerCase(), p]));
  const find = (get: (k: string) => string) => {
    const email = get("email").toLowerCase();
    const phone = get("phone");
    const name = get("name").toLowerCase();
    return (email && EMAIL.test(email) ? byEmail.get(email) : undefined) ?? (phoneKey(phone) ? byPhone.get(phoneKey(phone)) : undefined) ?? (name ? byName.get(name) : undefined) ?? null;
  };
  return { rows, cols, headings, find };
}

export function planNotesImport(csv: string, people: Matchable[]): AttachPlan<PlannedNote> {
  const { rows, cols, headings, find } = read(csv, true, people, "note");
  const plan: AttachPlan<PlannedNote> = { add: [], skipped: [], total: 0, columns: { used: [...new Set(headings.filter((_, i) => cols[i]))], unknown: headings.filter((h, i) => h && !cols[i]) } };
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].map(undoGuard);
    if (cells.every((c) => !c.trim())) continue;
    plan.total++;
    const get = (k: string) => clean(cells[cols.indexOf(k)] ?? "", k === "text" ? 4000 : 300);
    const text = get("text");
    if (!text) { plan.skipped.push({ row: i + 1, reason: "The note is empty." }); continue; }
    const p = find(get);
    if (!p) { plan.skipped.push({ row: i + 1, reason: "No one in your account matches this email, phone or name. Import the people first." }); continue; }
    plan.add.push({ row: i + 1, personId: p.id, person: p.name ?? p.email ?? "", text, at: readDate(get("date")) });
  }
  if (plan.total === 0) throw new ValidationError("That file has no rows under its header.");
  return plan;
}

export function planMessagesImport(csv: string, people: Matchable[]): AttachPlan<PlannedMessage> {
  const { rows, cols, headings, find } = read(csv, true, people, "message");
  const plan: AttachPlan<PlannedMessage> = { add: [], skipped: [], total: 0, columns: { used: [...new Set(headings.filter((_, i) => cols[i]))], unknown: headings.filter((h, i) => h && !cols[i]) } };
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].map(undoGuard);
    if (cells.every((c) => !c.trim())) continue;
    plan.total++;
    const get = (k: string) => clean(cells[cols.indexOf(k)] ?? "", k === "text" ? 4000 : 300);
    const body = get("text");
    if (!body) { plan.skipped.push({ row: i + 1, reason: "The message is empty." }); continue; }
    const p = find(get);
    if (!p) { plan.skipped.push({ row: i + 1, reason: "No one in your account matches this email, phone or name. Import the people first." }); continue; }
    plan.add.push({
      row: i + 1, personId: p.id, person: p.name ?? p.email ?? "", body,
      direction: directionOf(get("direction")), channel: channelOf(get("channel")), subject: get("subject") || null, at: readDate(get("date")),
    });
  }
  if (plan.total === 0) throw new ValidationError("That file has no rows under its header.");
  return plan;
}
