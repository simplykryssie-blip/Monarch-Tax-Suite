import { ValidationError } from "../commerce/validation.ts";
import { parseCsv } from "../leads/csv.ts";
import { parseTags, TAG_LENGTH, TAG_MAX } from "../leads/tags.ts";

// Importing people from a spreadsheet. Built for the file GoHighLevel's "Export contacts" makes, and it reads any CSV that
// names its columns (Drake, a spreadsheet, another CRM). The plan is worked out first and shown to the person; nothing is
// saved until they confirm. Pure rules only: no database, so it can be tested without one.

export const IMPORT_MAX_ROWS = 2000;
export type Destination = "clients" | "leads" | "customers" | "firms";
export const DESTINATIONS: Destination[] = ["clients", "leads", "customers", "firms"];

/** What each destination can hold. Anything else in the file is left out and said so, never silently dropped. */
export const SUPPORTS: Record<Destination, { label: string; tags: boolean; notes: boolean; messages: boolean; needs: "email_or_phone" | "email" | "name" }> = {
  clients: { label: "Clients (My Clients)", tags: true, notes: true, messages: true, needs: "email_or_phone" },
  leads: { label: "Leads", tags: true, notes: true, messages: false, needs: "email" },
  customers: { label: "Store customers", tags: false, notes: false, messages: false, needs: "email" },
  firms: { label: "Firms (EROs & EFINs)", tags: false, notes: true, messages: false, needs: "name" },
};
export const IMPORT_MAX_BYTES = 2_000_000;

// What each column of the file is, by its heading (lower case, tidy spaces). GoHighLevel's headings come first.
const ALIASES: Record<string, string> = {
  "contact name": "name", "name": "name", "full name": "name", "client name": "name", "display name": "name",
  "first name": "first", "firstname": "first", "first": "first", "given name": "first",
  "last name": "last", "lastname": "last", "last": "last", "surname": "last", "family name": "last",
  "business name": "company", "company name": "company", "company": "company", "organization": "company", "firm name": "company", "legal name": "company",
  "dba": "dba", "doing business as": "dba", "dba name": "dba",
  "notes": "notes", "note": "notes", "contact notes": "notes", "comments": "notes", "comment": "notes",
  "email": "email", "email address": "email", "e-mail": "email", "primary email": "email",
  "phone": "phone", "phone number": "phone", "mobile": "phone", "mobile phone": "phone", "cell": "phone", "primary phone": "phone",
  "tags": "tags", "tag": "tags",
  "address": "address1", "address1": "address1", "address 1": "address1", "street address": "address1", "street": "address1",
  "city": "city", "state": "state", "province": "state", "postal code": "zip", "zip": "zip", "zip code": "zip", "zipcode": "zip",
};
// Columns that are read as nothing on purpose: sensitive numbers are never imported from a spreadsheet.
const SENSITIVE = /(^|\b)(ssn|social security|social|tax id|tin|itin|ein|dob|date of birth|birth|bank|routing|account number|card)(\b|$)/i;

export type PlannedContact = {
  row: number; full_name: string; email: string | null; phone: string | null; address: string | null; tags: string[];
  /** The person's note from the file (if the destination keeps notes), and the company / DBA for leads and firms. */
  note: string | null; company: string | null; dba: string | null;
  /** The address in its parts, for destinations that keep it that way (firms). */
  parts: { line1: string; city: string; state: string; zip: string };
  /** Things the person should know about this row (a bad email left out, tags dropped). */
  notes: string[];
};
export type ContactImportPlan = {
  /** People who would be added. */
  add: PlannedContact[];
  /** Rows left out, with the reason in words. */
  skipped: { row: number; reason: string }[];
  /** Column headings that were read, left out on purpose, or not recognised, and what this destination can't keep. */
  columns: { used: string[]; sensitive: string[]; unknown: string[]; unsupported: string[] };
  /** How many rows were in the file. */
  total: number;
};

export type ExistingContact = { email: string | null; phone: string | null; /** The firm's legal name, for firms. */ name?: string | null };

export const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
export const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** The last ten digits of a phone number, so "(337) 555-0100" and "+1 337 555 0100" match. */
export const phoneKey = (v: string | null | undefined) => { const d = (v ?? "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };
export const headingOf = (h: string) => h.replace(/^﻿/, "").trim().toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ");
/** A spreadsheet-safe value: our own exports put an apostrophe before a leading = + - @. */
export const undoGuard = (c: string) => c.replace(/^'(?=[=+\-@])/, "");

/**
 * Reads the file and works out what an import would do. `existing` is the people already in the account (matched by email
 * or phone), `extraTags` go on everyone who is added (for example "imported from GoHighLevel").
 */
export function planContactImport(csv: string, existing: ExistingContact[], extraTags: string[] = [], destination: Destination = "clients"): ContactImportPlan {
  const can = SUPPORTS[destination];
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new ValidationError("That file has no rows under its header.");
  if (rows.length - 1 > IMPORT_MAX_ROWS) throw new ValidationError(`That file has ${rows.length - 1} rows. Import up to ${IMPORT_MAX_ROWS} at a time.`);
  const headings = rows[0].map(headingOf);
  const cols = headings.map((h) => (SENSITIVE.test(h) ? "sensitive" : ALIASES[h] ?? ""));
  const has = (k: string) => cols.includes(k);
  if (!has("name") && !has("first") && !has("last") && !has("company")) throw new ValidationError("The first row must name the columns, including a name (Contact Name, or First Name and Last Name).");
  if (can.needs === "email" && !has("email")) throw new ValidationError(`${can.label} need an Email column.`);
  if (can.needs === "email_or_phone" && !has("email") && !has("phone")) throw new ValidationError("The file needs an Email or a Phone column to tell people apart.");
  const unsupportedKeys = [...(can.tags ? [] : ["tags"]), ...(can.notes ? [] : ["notes"])];
  const columns = {
    used: [...new Set(headings.filter((_, i) => cols[i] && cols[i] !== "sensitive" && !unsupportedKeys.includes(cols[i])))],
    sensitive: headings.filter((_, i) => cols[i] === "sensitive"),
    unknown: headings.filter((h, i) => h && !cols[i]),
    unsupported: headings.filter((_, i) => unsupportedKeys.includes(cols[i])),
  };

  const emails = new Set(existing.map((e) => (e.email ?? "").toLowerCase()).filter(Boolean));
  const phones = new Set(existing.map((e) => phoneKey(e.phone)).filter(Boolean));
  const names = new Set(existing.map((e) => (e.name ?? "").toLowerCase()).filter(Boolean));
  const plan: ContactImportPlan = { add: [], skipped: [], columns, total: 0 };
  const fileTags = can.tags ? parseTags(extraTags).filter((t) => t.length <= TAG_LENGTH) : [];

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].map(undoGuard);
    if (cells.every((c) => !c.trim())) continue;
    plan.total++;
    const row = i + 1;
    const get = (k: string) => clean(cells[cols.indexOf(k)] ?? "", k === "tags" ? 2000 : k === "notes" ? 4000 : 300);
    const notes: string[] = [];
    const company = get("company");
    const full = get("name");
    const person = full || clean(`${get("first")} ${get("last")}`, 200);
    // A firm is named by its business; everything else by the person, falling back to the business.
    const name = destination === "firms" ? company || person : person || company;
    if (!name) { plan.skipped.push({ row, reason: "No name." }); continue; }
    if (name.length < 2) { plan.skipped.push({ row, reason: "The name is too short." }); continue; }
    let email: string | null = get("email").toLowerCase() || null;
    if (email && !EMAIL.test(email)) { notes.push("Email looked wrong and was left out."); email = null; }
    let phone: string | null = get("phone") || null;
    if (phone && !phoneKey(phone)) { notes.push("Phone looked wrong and was left out."); phone = null; }
    if (can.needs === "email" && !email) { plan.skipped.push({ row, reason: "No usable email, which this needs." }); continue; }
    if (can.needs === "email_or_phone" && !email && !phone) { plan.skipped.push({ row, reason: "No usable email or phone, so it can't be matched to a person." }); continue; }
    // Firms are told apart by name; people by email or phone. A row matching someone known still counts as that
    // person's details, so a later row sharing them is caught too.
    let dupe: string | null = null;
    if (destination === "firms") {
      dupe = names.has(name.toLowerCase()) ? name : null;
      names.add(name.toLowerCase());
    } else {
      dupe = email && emails.has(email) ? email : phone && destination !== "leads" && destination !== "customers" && phones.has(phoneKey(phone)) ? phone : null;
      if (email) emails.add(email);
      if (phone) phones.add(phoneKey(phone));
    }
    if (dupe) { plan.skipped.push({ row, reason: `${dupe} is already there, or appears earlier in the file.` }); continue; }
    const address = [get("address1"), [get("city"), get("state")].filter(Boolean).join(", "), get("zip")].filter(Boolean).join(", ").slice(0, 300) || null;
    // The person's own tags come first, then the import's; over the limit, the rest are dropped.
    const given = can.tags ? parseTags(get("tags")).filter((t) => t.length <= TAG_LENGTH) : [];
    const tags = [...new Set([...given, ...fileTags])];
    if (tags.length > TAG_MAX) notes.push(`Only ${TAG_MAX} tags fit; some were left off.`);
    let note = can.notes ? get("notes") || null : null;
    // Firms keep no email or phone of their own, so they go into the note rather than being lost.
    if (destination === "firms" && (email || phone)) note = [note, `Contact: ${[email, phone].filter(Boolean).join(" · ")}`].filter(Boolean).join("\n").slice(0, 4000);
    plan.add.push({ row, full_name: name.slice(0, 200), email, phone, address, tags: tags.slice(0, TAG_MAX), note, company: company || null, dba: get("dba") || null, parts: { line1: get("address1"), city: get("city"), state: get("state").slice(0, 40), zip: get("zip").slice(0, 20) }, notes });
  }
  if (plan.total === 0) throw new ValidationError("That file has no rows under its header.");
  plan.skipped.sort((a, b) => a.row - b.row);
  return plan;
}
