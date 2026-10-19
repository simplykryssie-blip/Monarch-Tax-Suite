import { ValidationError } from "../commerce/validation.ts";
import { parseCsv } from "../leads/csv.ts";
import { MONARCH_TEMPLATE, parseMoney } from "../fees/engine.ts";
import { RETURN_KINDS, type Client, type ClientInput, type ClientReturn, type Invoice, type InvoiceLine, type MatchKind, type PaymentRowInsert, type ReturnKind } from "./types.ts";

// The pure rules of My Workspace: what a client, return, task and invoice may contain, how the My Work board groups
// returns, how an invoice's balance and overdue state are worked out, and how a bank statement row is read and matched.

const one = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const isDay = (v: unknown): boolean => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
const day = (v: unknown, label: string): string | null => {
  const t = typeof v === "string" ? v.trim() : "";
  if (!t) return null;
  if (!isDay(t)) throw new ValidationError(`${label} isn't a valid date.`);
  return t;
};

// ---------------------------------------------------------------- clients

export function checkClient(raw: Record<string, unknown>): ClientInput {
  const full_name = one(raw.full_name, 200);
  if (!full_name) throw new ValidationError("Enter the client's name.");
  const email = one(raw.email, 254).toLowerCase();
  if (email && !EMAIL.test(email)) throw new ValidationError("That email address doesn't look right.");
  const phone = one(raw.phone, 40);
  if (phone && phone.replace(/\D/g, "").length < 10) throw new ValidationError("That phone number doesn't look right.");
  const last4 = one(raw.ssn_last4, 10).replace(/\D/g, "");
  if (one(raw.ssn_last4, 10) && last4.length !== 4) throw new ValidationError("Enter only the last 4 digits of the Social Security number.");
  return { full_name, email: email || null, phone: phone || null, ssn_last4: last4 || null, address: one(raw.address, 300) || null };
}

// ---------------------------------------------------------------- returns and the My Work board

/** The usual due date for a return of this kind: April 15 the year after, or October 15 for an extension. */
export function defaultDue(taxYear: number, kind: ReturnKind): string {
  return kind === "extension" ? `${taxYear + 1}-10-15` : `${taxYear + 1}-04-15`;
}

export function checkReturn(raw: Record<string, unknown>, existing: ClientReturn[], now = new Date()): { client_id: string; tax_year: number; kind: ReturnKind; parent_id: string | null; due_on: string | null; notes: string | null } {
  const client_id = one(raw.client_id, 40);
  if (!client_id) throw new ValidationError("Choose a client.");
  const tax_year = Number(one(raw.tax_year, 4));
  if (!Number.isInteger(tax_year) || tax_year < 2000 || tax_year > now.getUTCFullYear() + 1) throw new ValidationError("Enter a tax year.");
  const kind = (one(raw.kind, 12) || "original") as ReturnKind;
  if (!(kind in RETURN_KINDS)) throw new ValidationError("Choose original, extension or amendment.");
  let parent_id: string | null = null;
  if (kind !== "original") {
    // An extension or amendment is a card of its own, tied to the original for that year when there is one.
    const original = existing.find((r) => r.client_id === client_id && r.tax_year === tax_year && r.kind === "original" && !r.archived_at);
    parent_id = original?.id ?? null;
  }
  if (kind !== "amendment" && existing.some((r) => r.client_id === client_id && r.tax_year === tax_year && r.kind === kind && !r.archived_at)) {
    throw new ValidationError(`This client already has ${kind === "original" ? "an original return" : "an extension"} for ${tax_year}.`);
  }
  return { client_id, tax_year, kind, parent_id, due_on: day(raw.due_on, "The due date") ?? defaultDue(tax_year, kind), notes: one(raw.notes, 2000) || null };
}

export type BoardCard = { id: string; clientId: string; clientName: string; taxYear: number; kind: ReturnKind; stageId: string; dueOn: string | null; late: boolean; parentId: string | null };
export type BoardColumn = { stage: { id: string; name: string; color: string; done: boolean }; cards: BoardCard[] };

/** The My Work board for a year: one column per stage, a card per return (extensions and amendments are their own cards). */
export function buildBoard(stages: { id: string; name: string; color: string; done: boolean }[], returns: ClientReturn[], clients: Map<string, Client>, year: number, today: string): BoardColumn[] {
  const known = new Set(stages.map((s) => s.id));
  const cols: BoardColumn[] = stages.map((stage) => ({ stage, cards: [] }));
  for (const r of returns.filter((x) => x.tax_year === year && !x.archived_at)) {
    // A card in a stage that was removed from the pipeline shows in the first stage until someone moves it.
    const col = cols.find((c) => c.stage.id === (known.has(r.stage_id) ? r.stage_id : stages[0]?.id));
    if (!col) continue;
    col.cards.push({ id: r.id, clientId: r.client_id, clientName: clients.get(r.client_id)?.full_name ?? "Unknown client", taxYear: r.tax_year, kind: r.kind, stageId: col.stage.id, dueOn: r.due_on, late: Boolean(r.due_on && r.due_on < today && !col.stage.done), parentId: r.parent_id });
  }
  for (const c of cols) c.cards.sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") || a.clientName.localeCompare(b.clientName));
  return cols;
}

// ---------------------------------------------------------------- tasks

export function checkTask(raw: Record<string, unknown>): { title: string; due_on: string | null; return_id: string | null } {
  const title = one(raw.title, 200);
  if (!title) throw new ValidationError("Write the task.");
  return { title, due_on: day(raw.due_on, "The due date"), return_id: one(raw.return_id, 40) || null };
}

// ---------------------------------------------------------------- invoices

export const dollars = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
export const invoiceTotal = (lines: InvoiceLine[]) => lines.reduce((n, l) => n + l.amount_cents, 0);
export const balance = (i: Pick<Invoice, "total_cents" | "paid_cents">) => Math.max(0, i.total_cents - i.paid_cents);

/** The $223 breakdown, from Monarch's fee template. Every line can be changed on the invoice. */
export const defaultInvoiceLines = (): InvoiceLine[] => MONARCH_TEMPLATE.map((l) => ({ label: l.label, amount_cents: l.amount_cents }));

/** Lines typed on the invoice form: parallel `line_label_N` and `line_amount_N`; blank rows are skipped. */
export function checkLines(raw: Record<string, unknown>, max = 12): InvoiceLine[] {
  const lines: InvoiceLine[] = [];
  for (let i = 0; i < max; i++) {
    const label = one(raw[`line_label_${i}`], 120);
    const amountText = one(raw[`line_amount_${i}`], 20);
    if (!label && !amountText) continue;
    const amount = parseMoney(amountText);
    if (!label) throw new ValidationError(`Line ${i + 1} needs a description.`);
    if (amount === null) throw new ValidationError(`Line ${i + 1}: enter an amount like 79 or 79.00.`);
    lines.push({ label, amount_cents: amount });
  }
  if (!lines.length) throw new ValidationError("An invoice needs at least one line.");
  return lines;
}

export type InvoiceView = "draft" | "sent" | "overdue" | "paid" | "void";
/** What to call an invoice today: overdue is a sent invoice past its due date with a balance. */
export function invoiceView(i: Pick<Invoice, "status" | "due_on" | "total_cents" | "paid_cents">, today: string): InvoiceView {
  if (i.status === "sent" && i.due_on && i.due_on < today && balance(i) > 0) return "overdue";
  return i.status;
}

export type Totals = { invoiced: number; collected: number; outstanding: number; overdue: number; count: number };
export function totals(invoices: Invoice[], today: string): Totals {
  const t: Totals = { invoiced: 0, collected: 0, outstanding: 0, overdue: 0, count: 0 };
  for (const i of invoices) {
    if (i.status === "void") continue;
    t.count++;
    t.invoiced += i.total_cents;
    t.collected += i.paid_cents;
    if (i.status !== "draft") {
      t.outstanding += balance(i);
      if (invoiceView(i, today) === "overdue") t.overdue += balance(i);
    }
  }
  return t;
}

// ---------------------------------------------------------------- bank statement rows

const NOISE = new Set(["ach", "deposit", "credit", "debit", "payment", "pmt", "pymt", "transfer", "xfer", "refund", "tax", "prep", "preparation", "fee", "fees", "ssn", "ty", "year", "taxyear", "last", "from", "to", "for", "the", "and", "inc", "llc", "bank", "product", "rt", "online", "mobile", "check", "zelle", "venmo", "cash", "app", "ref", "id", "no", "of", "return", "filing", "efile", "e-file"]);

/** What can be read from a deposit's description: the tax year, the SSN's last 4 digits, and the words that may be a name. */
export function readDescription(description: string, now = new Date()): { taxYear: number | null; last4: string | null; name: string } {
  const text = description.replace(/\s+/g, " ").trim();
  const thisYear = now.getUTCFullYear();
  const plausibleYear = (n: number) => n >= 2015 && n <= thisYear + 1;
  // The last 4 digits, when labelled: "SSN 1234", "xxx-xx-1234", "***1234", "last 4: 1234".
  let last4: string | null = null;
  const labelled = text.match(/(?:ssn|s\.s\.n\.?|last\s*4|x{3}-?x{2}-?|\*{3}-?\*{2}-?|\*{2,}|x{2,})\s*[-#:]?\s*(\d{4})\b/i);
  if (labelled) last4 = labelled[1];
  let taxYear: number | null = null;
  const yearLabelled = text.match(/\b(?:ty|tax\s*year|taxyear)\s*[-:#]?\s*(20\d{2})\b/i);
  if (yearLabelled && plausibleYear(Number(yearLabelled[1]))) taxYear = Number(yearLabelled[1]);
  const fours = [...text.matchAll(/(?<![\d$.,])(\d{4})(?![\d.,])/g)].map((m) => m[1]);
  if (taxYear === null) {
    const years = fours.filter((f) => plausibleYear(Number(f)) && f !== last4);
    if (years.length === 1) taxYear = Number(years[0]);
  }
  if (last4 === null) {
    const rest = fours.filter((f) => !(taxYear !== null && Number(f) === taxYear));
    if (rest.length === 1) last4 = rest[0];
  }
  const words = text
    .replace(/(?<![a-z])(?:[x*]{2,}-?)+(?![a-z])/gi, " ")
    .replace(/\d+/g, " ")
    .split(/[^A-Za-z'-]+/)
    .filter((w) => w.length >= 2 && !NOISE.has(w.toLowerCase()));
  return { taxYear, last4, name: words.join(" ") };
}

const tokens = (name: string) => name.toLowerCase().split(/[^a-z']+/).filter((t) => t.length >= 2);

/** Whether a client's name is in the description: every name word is there (or, for a long name, the first and last). */
export function nameMatches(clientName: string, description: string): boolean {
  const t = tokens(clientName);
  if (!t.length) return false;
  const text = ` ${description.toLowerCase().replace(/[^a-z']+/g, " ")} `;
  const has = (w: string) => text.includes(` ${w} `);
  if (t.length <= 2) return t.every(has);
  return has(t[0]) && has(t[t.length - 1]);
}

export type MatchResult = { invoiceId: string | null; match: MatchKind };

/**
 * Matches one deposit to an open invoice by tax year, name and the SSN's last 4. All three agree: exact. Name plus
 * one of the other two: possible (for the user to confirm). A deposit that fits several invoices prefers the one
 * whose balance equals the amount. Nothing is applied here; the user reviews every row first.
 */
export function matchRow(row: { description: string; amount_cents: number; taxYear: number | null; last4: string | null }, invoices: Invoice[], clients: Map<string, Client>): MatchResult {
  const open = invoices.filter((i) => (i.status === "sent" || i.status === "draft") && balance(i) > 0);
  const scored = open.flatMap((i) => {
    const c = clients.get(i.client_id);
    if (!c || !nameMatches(c.full_name, row.description)) return [];
    const yearOk = row.taxYear !== null && i.tax_year === row.taxYear;
    const last4Ok = Boolean(row.last4 && c.ssn_last4 && c.ssn_last4 === row.last4);
    const score = 1 + (yearOk ? 1 : 0) + (last4Ok ? 1 : 0);
    // A different last 4 or year on the deposit is a contradiction, not just a missing detail.
    const contradicts = (row.last4 && c.ssn_last4 && c.ssn_last4 !== row.last4) || (row.taxYear !== null && i.tax_year !== row.taxYear);
    return score >= 2 && !contradicts ? [{ i, score, exactAmount: balance(i) === row.amount_cents }] : [];
  });
  if (!scored.length) return { invoiceId: null, match: "none" };
  scored.sort((a, b) => b.score - a.score || Number(b.exactAmount) - Number(a.exactAmount) || a.i.issued_on.localeCompare(b.i.issued_on));
  const best = scored[0];
  const tied = scored.filter((s) => s.score === best.score && s.exactAmount === best.exactAmount).length > 1;
  return { invoiceId: best.i.id, match: best.score === 3 && !tied ? "exact" : "possible" };
}

// ---------------------------------------------------------------- reading a bank CSV

const norm = (h: string) => h.toLowerCase().replace(/[^a-z]+/g, " ").trim();
const pickCol = (headers: string[], names: string[]) => headers.findIndex((h) => names.includes(norm(h)));

function toDay(v: string): string | null {
  const t = v.trim();
  if (isDay(t)) return t;
  const us = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    const y = us[3].length === 2 ? `20${us[3]}` : us[3];
    const out = `${y}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
    return isDay(out) ? out : null;
  }
  return null;
}

export type BankLine = { row_no: number; posted_on: string | null; description: string; amount_cents: number };

/** Deposits from a bank's CSV export: a date, a description and an amount (or separate credit and debit columns). */
export function readBankCsv(csv: string, maxRows = 3000): { lines: BankLine[]; skipped: number } {
  const rows = parseCsv(csv).filter((r) => r.some((c) => c.trim()));
  if (rows.length < 2) throw new ValidationError("That file has no rows under its header.");
  if (rows.length - 1 > maxRows) throw new ValidationError(`That file has ${rows.length - 1} rows. Import up to ${maxRows} at a time.`);
  const headers = rows[0];
  const dateCol = pickCol(headers, ["date", "posted", "posting date", "posted date", "transaction date", "trans date"]);
  const descCols = headers.map((h, i) => (["description", "memo", "details", "detail", "payee", "name", "reference", "transaction description", "note", "notes"].includes(norm(h)) ? i : -1)).filter((i) => i >= 0);
  const amountCol = pickCol(headers, ["amount", "transaction amount"]);
  const creditCol = pickCol(headers, ["credit", "credits", "deposit", "deposits", "money in", "amount credit"]);
  if (dateCol < 0 || !descCols.length || (amountCol < 0 && creditCol < 0)) throw new ValidationError("The first row must name the columns, including Date, Description and Amount (or Credit).");
  const lines: BankLine[] = [];
  let skipped = 0;
  rows.slice(1).forEach((cells, idx) => {
    const raw = (creditCol >= 0 ? cells[creditCol] : cells[amountCol]) ?? "";
    // Money in only: a negative amount or a debit is not a payment from a client.
    if (/^\s*[-(]/.test(raw)) { skipped++; return; }
    const cents = parseMoney(raw.replace(/[()]/g, ""));
    if (cents === null || cents === 0) { skipped++; return; }
    const description = descCols.map((i) => (cells[i] ?? "").trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").slice(0, 500);
    lines.push({ row_no: idx + 2, posted_on: toDay(cells[dateCol] ?? ""), description, amount_cents: cents });
  });
  if (!lines.length) throw new ValidationError("No deposits were found in that file.");
  return { lines, skipped };
}

/** The review rows for an import: each deposit read, and matched to an invoice when the details agree. */
export function planImport(importId: string, lines: BankLine[], invoices: Invoice[], clients: Map<string, Client>, now = new Date()): PaymentRowInsert[] {
  return lines.map((l) => {
    const read = readDescription(l.description, now);
    const m = matchRow({ description: l.description, amount_cents: l.amount_cents, taxYear: read.taxYear, last4: read.last4 }, invoices, clients);
    return { import_id: importId, row_no: l.row_no, posted_on: l.posted_on, description: l.description, amount_cents: l.amount_cents, tax_year: read.taxYear, ssn_last4: read.last4, name_guess: read.name.slice(0, 200) || null, invoice_id: m.invoiceId, match: m.match };
  });
}
