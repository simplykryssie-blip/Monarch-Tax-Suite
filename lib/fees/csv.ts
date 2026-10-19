import type { Mapping } from "./types.ts";

// CSV in and out for fee imports and statements. Imports come from tax software and bank exports, so the parser
// accepts quotes, embedded commas and newlines, CRLF, a byte-order mark, and semicolon- or tab-separated files.

export const MAX_CSV_BYTES = 2_000_000;
export const MAX_CSV_ROWS = 20_000;

export class CsvError extends Error {}

/** Parses CSV text into rows of cells. The separator is guessed from the header line. */
export function parseCsv(text: string): string[][] {
  if (text.length > MAX_CSV_BYTES) throw new CsvError("That file is too large. Split it into files under 2 MB.");
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const sep = [",", ";", "\t"].map((c) => ({ c, n: firstLine.split(c).length })).sort((a, b) => b.n - a.n)[0].c;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row.map((c) => c.trim()));
      row = [];
      if (rows.length > MAX_CSV_ROWS + 1) throw new CsvError(`That file has more than ${MAX_CSV_ROWS.toLocaleString("en-US")} rows. Split it into smaller files.`);
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row.map((c) => c.trim()));
  if (quoted) throw new CsvError("The file has an unclosed quote, so it couldn't be read. Re-export it and try again.");
  return rows;
}

export type Field = { key: string; label: string; required: boolean; hints: string[] };

/** The columns a returns import can use. */
export const RETURN_FIELDS: Field[] = [
  { key: "return_ref", label: "Return reference", required: true, hints: ["return id", "return ref", "reference", "return number", "submission id", "dcn", "id"] },
  { key: "taxpayer_name", label: "Taxpayer name", required: true, hints: ["taxpayer", "client", "name", "primary name", "customer"] },
  { key: "tax_year", label: "Tax year", required: false, hints: ["tax year", "year", "ty"] },
  { key: "bank", label: "Bank product", required: false, hints: ["bank", "bank product", "product", "rt provider"] },
  { key: "filed_on", label: "Filed date", required: false, hints: ["filed", "transmitted", "efile date", "date filed", "submission date"] },
  { key: "funded_on", label: "Funded date", required: false, hints: ["funded", "funding date", "disbursed", "paid date"] },
];

/** The columns a bank import can use. */
export const BANK_FIELDS: Field[] = [
  { key: "return_ref", label: "Return reference", required: true, hints: ["return id", "return ref", "reference", "submission id", "dcn", "id"] },
  { key: "collected", label: "Amount collected", required: true, hints: ["collected", "fees collected", "paid", "amount paid", "disbursed", "received"] },
  { key: "owed", label: "Amount owed", required: false, hints: ["owed", "fees owed", "due", "amount due", "expected"] },
  { key: "received_on", label: "Date collected", required: false, hints: ["date", "funded", "deposit date", "paid date", "disbursement date"] },
  { key: "taxpayer_name", label: "Taxpayer name", required: false, hints: ["taxpayer", "name", "client", "primary"] },
  { key: "tax_year", label: "Tax year", required: false, hints: ["tax year", "year", "ty"] },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Picks a column for each field: the saved mapping if its headers are still there, else the best header match. */
export function guessMapping(headers: string[], fields: Field[], saved: Mapping | null = null): Mapping {
  const out: Mapping = {};
  const used = new Set<string>();
  for (const f of fields) {
    const keep = saved?.[f.key];
    if (keep && headers.includes(keep)) { out[f.key] = keep; used.add(keep); }
  }
  for (const f of fields) {
    if (out[f.key]) continue;
    const exact = headers.find((h) => !used.has(h) && f.hints.includes(norm(h)));
    const partial = exact ?? headers.find((h) => !used.has(h) && f.hints.some((x) => x.length > 3 && norm(h).includes(x)));
    if (partial) { out[f.key] = partial; used.add(partial); }
  }
  return out;
}

/** Checks a mapping against the file's headers. */
export function checkMapping(headers: string[], fields: Field[], mapping: Mapping): string | null {
  for (const f of fields) {
    const col = mapping[f.key];
    if (f.required && !col) return `Choose the column for "${f.label}".`;
    if (col && !headers.includes(col)) return `The column "${col}" isn't in this file.`;
  }
  return null;
}

/** The rows of a parsed file as records keyed by field, using the mapping. */
export function mapRows(rows: string[][], mapping: Mapping): Record<string, string>[] {
  const [head, ...body] = rows;
  const idx = Object.fromEntries(Object.entries(mapping).filter(([, col]) => col).map(([k, col]) => [k, head.indexOf(col)]));
  return body.map((r) => Object.fromEntries(Object.entries(idx).map(([k, i]) => [k, i >= 0 ? (r[i] ?? "").trim() : ""])));
}

/** A date from a CSV cell: 2026-02-14, 02/14/2026, 2/14/26. Anything else is null. */
export function parseDate(raw: string | undefined): string | null {
  const v = (raw ?? "").trim();
  let y: number, m: number, d: number;
  let hit = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  if (hit) [y, m, d] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  else if ((hit = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(v))) [m, d, y] = [Number(hit[1]), Number(hit[2]), Number(hit[3].length === 2 ? `20${hit[3]}` : hit[3])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** A cell for CSV output; values a spreadsheet would run as formulas are neutralized. */
export const csvCell = (v: string | number | null | undefined) => {
  if (typeof v === "number") return String(v);
  const s = v === null || v === undefined ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export const toCsv = (rows: (string | number | null)[][]) => `${rows.map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
