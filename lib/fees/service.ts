import { createHash } from "node:crypto";
import { ValidationError } from "../commerce/validation.ts";
import { BANK_FIELDS, checkMapping, CsvError, guessMapping, mapRows, parseCsv, parseDate, RETURN_FIELDS, toCsv } from "./csv.ts";
import { buildStatement, chargesFor, codeFor, effectiveLines, MONARCH_TEMPLATE, parseMoney, returnLine, STATUS_LABEL, type Period, type Statement } from "./engine.ts";
import type { Applies, Bank, FeeLine, FeeSchedule, FeesRepo, Mapping, Office, ReturnInput, TaxReturn } from "./types.ts";

// Fees & Statements: the bureau's fee schedule and office overrides, the return record, imports from tax software
// and bank CSVs, payments for returns without a bank product, and statements. Every change is written to the fee
// history with who made it.

export type FeesDeps = { repo: FeesRepo; now?: () => Date };
const now = (deps: FeesDeps) => (deps.now ? deps.now() : new Date());
const fail = (message: string): never => { throw new ValidationError(message); };

// ------------------------------------------------------------------ schedules

export async function defaultSchedule(deps: FeesDeps, actorId: string | null): Promise<FeeSchedule> {
  return (await deps.repo.getDefaultSchedule()) ?? deps.repo.insertSchedule({ organization_id: null, name: "Bureau fee schedule", created_by: actorId });
}

async function officeOf(deps: FeesDeps, officeId: string): Promise<Office> {
  const office = (await deps.repo.listOffices()).find((o) => o.id === officeId);
  return office ?? fail("That office wasn't found.");
}

async function bankOf(deps: FeesDeps, bankId: string | null): Promise<Bank | null> {
  if (!bankId) return null;
  const bank = (await deps.repo.listBanks()).find((b) => b.id === bankId);
  return bank ?? fail("Choose a bank from Software & banking.");
}

export type LineForm = { label: string; amount: string; applies: string; bankId: string | null; sortOrder?: number };

function readLine(raw: LineForm): { label: string; amount_cents: number; applies: Applies; bank_option_id: string | null } {
  const label = raw.label.replace(/\s+/g, " ").trim();
  if (label.length < 2 || label.length > 120) fail("Give the fee a name of 2 to 120 characters.");
  const amount = parseMoney(raw.amount);
  if (amount === null) fail("Enter the amount in dollars, for example 79 or 21.50.");
  const applies: Applies = raw.applies === "bank_product" ? "bank_product" : "every_return";
  if (raw.bankId && applies !== "bank_product") fail("A fee for one bank applies to bank-product returns only.");
  return { label, amount_cents: amount!, applies, bank_option_id: raw.bankId || null };
}

/** Adds a line to the bureau's schedule, or (with officeId) a line only that office is charged. */
export async function addLine(deps: FeesDeps, actorId: string, raw: LineForm, officeId: string | null = null): Promise<FeeLine> {
  const input = readLine(raw);
  await bankOf(deps, input.bank_option_id);
  const schedule = officeId ? await officeSchedule(deps, actorId, officeId) : await defaultSchedule(deps, actorId);
  const code = codeFor(input.label, input.bank_option_id);
  const existing = await deps.repo.listLines([schedule.id]);
  if (existing.some((l) => l.code === code)) fail(`There's already a "${input.label}" line on this schedule.`);
  if (officeId) {
    const defaults = await deps.repo.listLines([(await defaultSchedule(deps, actorId)).id]);
    if (defaults.some((l) => l.code === code)) fail(`"${input.label}" is on the bureau schedule; set this office's amount for it instead.`);
  }
  const line = await deps.repo.insertLine(schedule.id, { ...input, code, sort_order: raw.sortOrder ?? existing.length * 10 + 10 });
  await deps.repo.addEvent({ entity: "line", record_id: line.id, organization_id: officeId, action: "line_added", actor_id: actorId, detail: { label: line.label, amount_cents: line.amount_cents, applies: line.applies, bank_option_id: line.bank_option_id }, reason: null });
  return line;
}

export async function updateLine(deps: FeesDeps, actorId: string, lineId: string, raw: LineForm): Promise<FeeLine> {
  const input = readLine(raw);
  await bankOf(deps, input.bank_option_id);
  const before = (await allLines(deps)).find((l) => l.id === lineId) ?? fail("That fee line wasn't found.");
  // The code stays, so office overrides keep pointing at this line even if it's renamed.
  const line = await deps.repo.updateLine(lineId, { label: input.label, amount_cents: input.amount_cents, applies: input.applies, bank_option_id: input.bank_option_id, ...(raw.sortOrder !== undefined ? { sort_order: raw.sortOrder } : {}) });
  await deps.repo.addEvent({ entity: "line", record_id: lineId, organization_id: await scheduleOffice(deps, before.schedule_id), action: "line_changed", actor_id: actorId, detail: { from: { label: before.label, amount_cents: before.amount_cents, applies: before.applies }, to: { label: line.label, amount_cents: line.amount_cents, applies: line.applies } }, reason: null });
  return line;
}

export async function removeLine(deps: FeesDeps, actorId: string, lineId: string): Promise<void> {
  const line = (await allLines(deps)).find((l) => l.id === lineId) ?? fail("That fee line wasn't found.");
  await deps.repo.deleteLine(lineId);
  await deps.repo.addEvent({ entity: "line", record_id: lineId, organization_id: await scheduleOffice(deps, line.schedule_id), action: "line_removed", actor_id: actorId, detail: { label: line.label, amount_cents: line.amount_cents }, reason: null });
}

async function allLines(deps: FeesDeps): Promise<FeeLine[]> {
  const ids = [(await deps.repo.getDefaultSchedule())?.id, ...(await deps.repo.listOfficeSchedules()).map((s) => s.id)].filter((x): x is string => !!x);
  return ids.length ? deps.repo.listLines(ids) : [];
}
async function scheduleOffice(deps: FeesDeps, scheduleId: string): Promise<string | null> {
  return (await deps.repo.listOfficeSchedules()).find((s) => s.id === scheduleId)?.organization_id ?? null;
}

/** Loads the starter template ($79 + $21 + $24 + $99) into an empty bureau schedule. Every amount stays editable. */
export async function loadTemplate(deps: FeesDeps, actorId: string): Promise<void> {
  const schedule = await defaultSchedule(deps, actorId);
  if ((await deps.repo.listLines([schedule.id])).length) fail("The schedule already has fees. Edit them, or remove them first.");
  let order = 10;
  for (const t of MONARCH_TEMPLATE) {
    await deps.repo.insertLine(schedule.id, { code: codeFor(t.label), label: t.label, amount_cents: t.amount_cents, applies: t.applies, bank_option_id: null, sort_order: order });
    order += 10;
  }
  await deps.repo.addEvent({ entity: "schedule", record_id: schedule.id, organization_id: null, action: "template_loaded", actor_id: actorId, detail: { template: "monarch", lines: MONARCH_TEMPLATE.length }, reason: null });
}

async function officeSchedule(deps: FeesDeps, actorId: string | null, officeId: string): Promise<FeeSchedule> {
  const office = await officeOf(deps, officeId);
  return (await deps.repo.getOfficeSchedule(officeId)) ?? deps.repo.insertSchedule({ organization_id: officeId, name: `${office.name} fees`.slice(0, 120), created_by: actorId });
}

/**
 * Sets one office's amount for a bureau fee line, or (amount null) goes back to the bureau amount. $0 means the
 * office isn't charged that fee.
 */
export async function setOverride(deps: FeesDeps, actorId: string, officeId: string, code: string, rawAmount: string | null): Promise<void> {
  const defaults = await deps.repo.listLines([(await defaultSchedule(deps, actorId)).id]);
  const base = defaults.find((l) => l.code === code) ?? fail("That bureau fee line wasn't found.");
  const existing = await deps.repo.getOfficeSchedule(officeId);
  const current = existing ? (await deps.repo.listLines([existing.id])).find((l) => l.code === code) : undefined;
  if (rawAmount === null || rawAmount.trim() === "") {
    if (!current) return;
    await deps.repo.deleteLine(current.id);
    await deps.repo.addEvent({ entity: "line", record_id: current.id, organization_id: officeId, action: "override_removed", actor_id: actorId, detail: { label: base.label, back_to_cents: base.amount_cents }, reason: null });
    return;
  }
  const amount = parseMoney(rawAmount) ?? fail("Enter the office's amount in dollars, for example 69 or 0.");
  const schedule = existing ?? (await officeSchedule(deps, actorId, officeId));
  if (current) await deps.repo.updateLine(current.id, { amount_cents: amount, label: base.label });
  else await deps.repo.insertLine(schedule.id, { code, label: base.label, amount_cents: amount, applies: base.applies, bank_option_id: base.bank_option_id, sort_order: base.sort_order });
  await deps.repo.addEvent({ entity: "line", record_id: current?.id ?? null, organization_id: officeId, action: "override_set", actor_id: actorId, detail: { label: base.label, bureau_cents: base.amount_cents, office_cents: amount }, reason: null });
}

export type ScheduleView = { defaults: FeeLine[]; overrides: FeeLine[]; effective: FeeLine[] };
export async function scheduleFor(deps: FeesDeps, officeId: string | null): Promise<ScheduleView> {
  const def = await deps.repo.getDefaultSchedule();
  const defaults = def ? await deps.repo.listLines([def.id]) : [];
  const off = officeId ? await deps.repo.getOfficeSchedule(officeId) : null;
  const overrides = off ? await deps.repo.listLines([off.id]) : [];
  return { defaults, overrides, effective: effectiveLines(defaults, overrides) };
}

// ------------------------------------------------------------------ returns

export type ReturnForm = { officeId: string; taxYear: string; returnRef: string; taxpayerName: string; bankId: string | null; filedOn: string; fundedOn: string; notes: string };

function readReturn(raw: ReturnForm): ReturnInput {
  const tax_year = Number(raw.taxYear);
  if (!Number.isInteger(tax_year) || tax_year < 2000 || tax_year > 2100) fail("Enter the tax year, for example 2025.");
  const return_ref = raw.returnRef.trim();
  if (!return_ref || return_ref.length > 80) fail("Enter the return reference from the tax software (up to 80 characters).");
  const taxpayer_name = raw.taxpayerName.replace(/\s+/g, " ").trim();
  if (!taxpayer_name || taxpayer_name.length > 200) fail("Enter the taxpayer's name.");
  const filed_on = raw.filedOn ? parseDate(raw.filedOn) ?? fail("Enter the filed date as YYYY-MM-DD.") : null;
  const funded_on = raw.fundedOn ? parseDate(raw.fundedOn) ?? fail("Enter the funded date as YYYY-MM-DD.") : null;
  const notes = raw.notes.trim().slice(0, 2000) || null;
  return { organization_id: raw.officeId, tax_year, return_ref, taxpayer_name, bank_option_id: raw.bankId || null, filed_on, funded_on, notes };
}

async function applyFees(deps: FeesDeps, ret: TaxReturn): Promise<number> {
  const { effective } = await scheduleFor(deps, ret.organization_id);
  const charges = chargesFor(ret, effective);
  await deps.repo.replaceFees(ret.id, charges);
  return charges.reduce((s, c) => s + c.amount_cents, 0);
}

/** Records a return and charges it the office's current fees. */
export async function recordReturn(deps: FeesDeps, actorId: string, raw: ReturnForm): Promise<TaxReturn> {
  const input = readReturn(raw);
  await officeOf(deps, input.organization_id);
  await bankOf(deps, input.bank_option_id);
  const dup = (await deps.repo.listReturns({ officeId: input.organization_id, taxYear: input.tax_year })).find((r) => r.return_ref.toLowerCase() === input.return_ref.toLowerCase());
  if (dup) fail(`Return ${input.return_ref} is already recorded for this office and tax year.`);
  const ret = await deps.repo.insertReturn({ ...input, source: "manual", created_by: actorId });
  const owed = await applyFees(deps, ret);
  await deps.repo.addEvent({ entity: "return", record_id: ret.id, organization_id: ret.organization_id, action: "return_recorded", actor_id: actorId, detail: { return_ref: ret.return_ref, tax_year: ret.tax_year, owed_cents: owed }, reason: null });
  return ret;
}

/**
 * Edits a return. Fees were fixed when the return was recorded; if the bank product changes and nothing has been
 * collected yet, they're worked out again so bank fees follow the bank.
 */
export async function updateReturn(deps: FeesDeps, actorId: string, id: string, raw: ReturnForm): Promise<TaxReturn> {
  const before = { ...((await deps.repo.getReturn(id)) ?? fail("That return wasn't found.")) };
  const input = readReturn({ ...raw, officeId: before.organization_id });
  await bankOf(deps, input.bank_option_id);
  const dup = (await deps.repo.listReturns({ officeId: before.organization_id, taxYear: input.tax_year })).find((r) => r.id !== id && r.return_ref.toLowerCase() === input.return_ref.toLowerCase());
  if (dup) fail(`Return ${input.return_ref} is already recorded for this office and tax year.`);
  const ret = await deps.repo.updateReturn(id, { tax_year: input.tax_year, return_ref: input.return_ref, taxpayer_name: input.taxpayer_name, bank_option_id: input.bank_option_id, filed_on: input.filed_on, funded_on: input.funded_on, notes: input.notes });
  let refeed = false;
  if (before.bank_option_id !== ret.bank_option_id && !(await deps.repo.listReceipts({ returnIds: [id] })).length) { await applyFees(deps, ret); refeed = true; }
  await deps.repo.addEvent({ entity: "return", record_id: id, organization_id: ret.organization_id, action: "return_changed", actor_id: actorId, detail: { return_ref: ret.return_ref, fees_reapplied: refeed }, reason: null });
  return ret;
}

/** Charges a return the office's current fees again, replacing the ones fixed when it was recorded. */
export async function reapplyFees(deps: FeesDeps, actorId: string, id: string, reason: string): Promise<void> {
  const ret = (await deps.repo.getReturn(id)) ?? fail("That return wasn't found.");
  const why = reason.trim();
  if (why.length < 3) fail("Say why the fees are being changed (it's kept in the history).");
  const before = (await deps.repo.listFees([id])).reduce((s, f) => s + f.amount_cents, 0);
  const after = await applyFees(deps, ret);
  await deps.repo.addEvent({ entity: "return", record_id: id, organization_id: ret.organization_id, action: "fees_reapplied", actor_id: actorId, detail: { from_cents: before, to_cents: after }, reason: why.slice(0, 500) });
}

export async function archiveReturn(deps: FeesDeps, actorId: string, id: string, reason: string): Promise<void> {
  const ret = (await deps.repo.getReturn(id)) ?? fail("That return wasn't found.");
  if (ret.archived_at) return;
  await deps.repo.updateReturn(id, { archived_at: now(deps).toISOString(), archived_by: actorId, archive_reason: reason.trim().slice(0, 500) || null });
  await deps.repo.addEvent({ entity: "return", record_id: id, organization_id: ret.organization_id, action: "return_archived", actor_id: actorId, detail: { return_ref: ret.return_ref }, reason: reason.trim().slice(0, 500) || null });
}

export async function restoreReturn(deps: FeesDeps, actorId: string, id: string): Promise<void> {
  const ret = (await deps.repo.getReturn(id)) ?? fail("That return wasn't found.");
  if (!ret.archived_at) return;
  await deps.repo.updateReturn(id, { archived_at: null, archived_by: null, archive_reason: null });
  await deps.repo.addEvent({ entity: "return", record_id: id, organization_id: ret.organization_id, action: "return_restored", actor_id: actorId, detail: { return_ref: ret.return_ref }, reason: null });
}

/**
 * Marks a return paid by the ERO (for returns without a bank product, or the rest of a short bank payment).
 * The amount defaults to what's still owed.
 */
export async function markPaid(deps: FeesDeps, actorId: string, id: string, raw: { amount: string; date: string; reference: string; note: string }): Promise<void> {
  const ret = (await deps.repo.getReturn(id)) ?? fail("That return wasn't found.");
  const line = returnLine(ret, await deps.repo.listFees([id]), await deps.repo.listReceipts({ returnIds: [id] }));
  if (line.balance <= 0) fail("Nothing is owed on this return.");
  const amount = raw.amount.trim() ? parseMoney(raw.amount) ?? fail("Enter the amount paid in dollars.") : line.balance;
  if (amount <= 0) fail("Enter an amount above $0.");
  if (amount > line.balance) fail(`That's more than the ${(line.balance / 100).toFixed(2)} still owed.`);
  const received_on = raw.date ? parseDate(raw.date) ?? fail("Enter the payment date as YYYY-MM-DD.") : now(deps).toISOString().slice(0, 10);
  await deps.repo.insertReceipts([{ kind: "ero_payment", organization_id: ret.organization_id, return_id: id, import_id: null, bank_option_id: null, owed_cents: null, collected_cents: amount, received_on, reference: raw.reference.trim().slice(0, 120) || null, row_ref: null, row_name: null, note: raw.note.trim().slice(0, 500) || null, created_by: actorId }]);
  await deps.repo.addEvent({ entity: "receipt", record_id: id, organization_id: ret.organization_id, action: "marked_paid", actor_id: actorId, detail: { return_ref: ret.return_ref, amount_cents: amount, received_on }, reason: null });
}

// ------------------------------------------------------------------ imports

export type ImportResult = { created: number; updated: number; skipped: { row: number; reason: string }[] };

const NO_BANK = new Set(["", "none", "no", "n/a", "na", "-", "no bank", "direct", "self", "self-prepared", "ero"]);

function bankByName(banks: Bank[], raw: string): { id: string | null } | null {
  const v = raw.trim().toLowerCase();
  if (NO_BANK.has(v)) return { id: null };
  const hit = banks.find((b) => b.name.toLowerCase() === v) ?? banks.find((b) => v.includes(b.name.toLowerCase()) || b.name.toLowerCase().includes(v));
  return hit ? { id: hit.id } : null;
}

function readFile(text: string, fields: typeof RETURN_FIELDS, mapping: Mapping) {
  let rows: string[][];
  try { rows = parseCsv(text); } catch (e) { throw new ValidationError(e instanceof CsvError ? e.message : "That file couldn't be read as CSV."); }
  if (rows.length < 2) fail("That file has no rows under its header.");
  const problem = checkMapping(rows[0], fields, mapping);
  if (problem) fail(problem);
  return mapRows(rows, mapping);
}

/** Headers and a suggested mapping for a file, for the import screen. */
export async function previewFile(deps: FeesDeps, kind: "returns" | "bank", text: string) {
  let rows: string[][];
  try { rows = parseCsv(text); } catch (e) { throw new ValidationError(e instanceof CsvError ? e.message : "That file couldn't be read as CSV."); }
  if (!rows.length) fail("That file is empty.");
  const fields = kind === "returns" ? RETURN_FIELDS : BANK_FIELDS;
  return { headers: rows[0], sample: rows.slice(1, 4), rowCount: rows.length - 1, mapping: guessMapping(rows[0], fields, await deps.repo.getMapping(kind)) };
}

/**
 * Imports returns for one office from a tax-software CSV. A row whose reference is already recorded for that office
 * and year updates it; new rows are recorded and charged the office's current fees. Bad rows are skipped and listed.
 */
export async function importReturns(deps: FeesDeps, actorId: string, input: { officeId: string; taxYear: string; text: string; mapping: Mapping }): Promise<ImportResult> {
  const office = await officeOf(deps, input.officeId);
  const defaultYear = Number(input.taxYear);
  if (!Number.isInteger(defaultYear) || defaultYear < 2000 || defaultYear > 2100) fail("Choose the tax year for these returns.");
  const records = readFile(input.text, RETURN_FIELDS, input.mapping);
  const banks = await deps.repo.listBanks();
  const existing = await deps.repo.listReturns({ officeId: office.id });
  const result: ImportResult = { created: 0, updated: 0, skipped: [] };
  const seen = new Set<string>();
  for (const [i, r] of records.entries()) {
    const row = i + 2;
    const year = r.tax_year ? Number(r.tax_year) : defaultYear;
    if (!Number.isInteger(year) || year < 2000 || year > 2100) { result.skipped.push({ row, reason: `Tax year "${r.tax_year}" isn't a year.` }); continue; }
    const ref = (r.return_ref ?? "").trim();
    const name = (r.taxpayer_name ?? "").replace(/\s+/g, " ").trim();
    if (!ref || ref.length > 80) { result.skipped.push({ row, reason: "No return reference." }); continue; }
    if (!name) { result.skipped.push({ row, reason: "No taxpayer name." }); continue; }
    const key = `${year}:${ref.toLowerCase()}`;
    if (seen.has(key)) { result.skipped.push({ row, reason: `Return ${ref} appears twice in this file.` }); continue; }
    seen.add(key);
    const match = existing.find((x) => x.tax_year === year && x.return_ref.toLowerCase() === ref.toLowerCase());
    // No bank column in the file keeps what's recorded; a blank or "none" cell means no bank product.
    const bank = r.bank === undefined ? { id: match?.bank_option_id ?? null } : bankByName(banks, r.bank);
    if (!bank) { result.skipped.push({ row, reason: `Bank "${r.bank}" isn't on your bank list in Software & banking.` }); continue; }
    const filed_on = r.filed_on ? parseDate(r.filed_on) : null;
    const funded_on = r.funded_on ? parseDate(r.funded_on) : null;
    if (r.filed_on && !filed_on) { result.skipped.push({ row, reason: `Filed date "${r.filed_on}" isn't a date.` }); continue; }
    if (r.funded_on && !funded_on) { result.skipped.push({ row, reason: `Funded date "${r.funded_on}" isn't a date.` }); continue; }
    if (match) {
      const priorBank = match.bank_option_id;
      const ret = await deps.repo.updateReturn(match.id, { taxpayer_name: name.slice(0, 200), bank_option_id: bank.id, filed_on: filed_on ?? match.filed_on, funded_on: funded_on ?? match.funded_on });
      if (priorBank !== bank.id && !(await deps.repo.listReceipts({ returnIds: [match.id] })).length) await applyFees(deps, ret);
      result.updated++;
    } else {
      const ret = await deps.repo.insertReturn({ organization_id: office.id, tax_year: year, return_ref: ref, taxpayer_name: name.slice(0, 200), bank_option_id: bank.id, filed_on, funded_on, notes: null, source: "import", created_by: actorId });
      await applyFees(deps, ret);
      existing.push(ret);
      result.created++;
    }
  }
  await deps.repo.saveMapping("returns", input.mapping, actorId);
  await deps.repo.addEvent({ entity: "import", record_id: null, organization_id: office.id, action: "returns_imported", actor_id: actorId, detail: { created: result.created, updated: result.updated, skipped: result.skipped.length }, reason: null });
  return result;
}

export type BankResult = { importId: string; matched: number; unmatched: number; skipped: { row: number; reason: string }[] };

/**
 * Imports a bank's CSV of what was owed and collected. Each row is matched to a return by its reference (and tax
 * year, when the file has one). Rows that match no return, or more than one, are kept unlinked for someone to link.
 * The same file can't be imported twice.
 */
export async function importBank(deps: FeesDeps, actorId: string, input: { bankId: string; fileName: string; text: string; mapping: Mapping }): Promise<BankResult> {
  const bank = (await bankOf(deps, input.bankId)) ?? fail("Choose the bank this file came from.");
  const sha = createHash("sha256").update(input.text.replace(/^﻿/, "").replace(/\r\n/g, "\n")).digest("hex");
  const dup = await deps.repo.findImportByHash(sha);
  if (dup) fail(`This file was already imported on ${dup.created_at.slice(0, 10)} (${dup.file_name}). Nothing was added.`);
  const records = readFile(input.text, BANK_FIELDS, input.mapping);
  const skipped: BankResult["skipped"] = [];
  const rows: { ref: string; name: string | null; year: number | null; owed: number | null; collected: number; date: string | null; match: TaxReturn | null }[] = [];
  for (const [i, r] of records.entries()) {
    const row = i + 2;
    const ref = (r.return_ref ?? "").trim();
    if (!ref) { skipped.push({ row, reason: "No return reference." }); continue; }
    const collected = parseMoney(r.collected);
    if (collected === null) { skipped.push({ row, reason: `Amount collected "${r.collected ?? ""}" isn't an amount.` }); continue; }
    const owed = r.owed ? parseMoney(r.owed) : null;
    if (r.owed && owed === null) { skipped.push({ row, reason: `Amount owed "${r.owed}" isn't an amount.` }); continue; }
    const date = r.received_on ? parseDate(r.received_on) : null;
    if (r.received_on && !date) { skipped.push({ row, reason: `Date "${r.received_on}" isn't a date.` }); continue; }
    const year = r.tax_year ? Number(r.tax_year) : null;
    const found = await deps.repo.findReturnsByRef(ref, year && Number.isInteger(year) ? year : undefined);
    const live = found.filter((x) => !x.archived_at);
    rows.push({ ref: ref.slice(0, 80), name: r.taxpayer_name?.slice(0, 200) || null, year, owed, collected, date, match: live.length === 1 ? live[0] : null });
  }
  if (!rows.length) fail("No row in that file could be read. Check the column choices.");
  const imp = await deps.repo.insertImport({ bank_option_id: bank.id, file_name: input.fileName.slice(0, 200) || "bank.csv", file_sha256: sha, row_count: rows.length, matched_count: rows.filter((r) => r.match).length, unmatched_count: rows.filter((r) => !r.match).length, imported_by: actorId });
  await deps.repo.insertReceipts(rows.map((r) => ({
    kind: "bank" as const, organization_id: r.match?.organization_id ?? null, return_id: r.match?.id ?? null, import_id: imp.id, bank_option_id: bank.id,
    owed_cents: r.owed, collected_cents: r.collected, received_on: r.date, reference: null, row_ref: r.ref, row_name: r.name, note: null, created_by: actorId,
  })));
  await deps.repo.saveMapping("bank", input.mapping, actorId);
  await deps.repo.addEvent({ entity: "import", record_id: imp.id, organization_id: null, action: "bank_imported", actor_id: actorId, detail: { bank: bank.name, file: imp.file_name, rows: imp.row_count, matched: imp.matched_count, unmatched: imp.unmatched_count, skipped: skipped.length }, reason: null });
  return { importId: imp.id, matched: imp.matched_count, unmatched: imp.unmatched_count, skipped };
}

/** Links an unmatched bank row to a return in an office, found by its reference. */
export async function linkReceipt(deps: FeesDeps, actorId: string, receiptId: string, input: { officeId: string; returnRef: string; taxYear: string }): Promise<void> {
  const receipt = (await deps.repo.getReceipt(receiptId)) ?? fail("That bank row wasn't found.");
  if (receipt.return_id) fail("That bank row is already linked to a return.");
  await officeOf(deps, input.officeId);
  const year = input.taxYear ? Number(input.taxYear) : undefined;
  const candidates = (await deps.repo.findReturnsByRef(input.returnRef.trim(), year)).filter((r) => r.organization_id === input.officeId && !r.archived_at);
  if (candidates.length !== 1) fail(candidates.length ? "More than one return has that reference; add the tax year." : "No return with that reference in that office. Record or import it first.");
  await deps.repo.linkReceipt(receiptId, { return_id: candidates[0].id, organization_id: input.officeId });
  await deps.repo.addEvent({ entity: "receipt", record_id: receiptId, organization_id: input.officeId, action: "bank_row_linked", actor_id: actorId, detail: { row_ref: receipt.row_ref, return_ref: candidates[0].return_ref, collected_cents: receipt.collected_cents }, reason: null });
}

// ------------------------------------------------------------------ statements

export async function statementFor(deps: FeesDeps, officeId: string, period: Period): Promise<Statement> {
  const returns = await deps.repo.listReturns({ officeId, taxYear: period.taxYear });
  const ids = returns.map((r) => r.id);
  const [fees, receipts] = ids.length ? await Promise.all([deps.repo.listFees(ids), deps.repo.listReceipts({ returnIds: ids })]) : [[], []];
  return buildStatement(period, returns, fees, receipts);
}

export type OfficeRow = { office: Office; totals: Statement["totals"]; hasOverride: boolean };

/** Every office's season totals, plus unlinked bank rows, for the Fees overview. */
export async function overview(deps: FeesDeps, taxYear: number): Promise<{ offices: OfficeRow[]; unmatched: number; hasSchedule: boolean }> {
  const [offices, returns, schedules, def] = await Promise.all([deps.repo.listOffices(), deps.repo.listReturns({ taxYear }), deps.repo.listOfficeSchedules(), deps.repo.getDefaultSchedule()]);
  const ids = returns.map((r) => r.id);
  const [fees, receipts, unmatched, defLines] = await Promise.all([
    ids.length ? deps.repo.listFees(ids) : [],
    ids.length ? deps.repo.listReceipts({ returnIds: ids }) : [],
    deps.repo.listReceipts({ unmatched: true }),
    def ? deps.repo.listLines([def.id]) : [],
  ]);
  const withOverride = new Set(schedules.map((s) => s.organization_id));
  const rows = offices.filter((o) => !o.archived || returns.some((r) => r.organization_id === o.id)).map((office) => ({
    office,
    totals: buildStatement({ taxYear, month: null }, returns.filter((r) => r.organization_id === office.id), fees, receipts).totals,
    hasOverride: withOverride.has(office.id),
  }));
  return { offices: rows, unmatched: unmatched.length, hasSchedule: defLines.length > 0 };
}

/** The statement as CSV: one row per return, a column per fee, then collected, balance and status. */
export function statementCsv(office: Office, s: Statement, banks: Bank[]): string {
  const codes = s.byFee.map((f) => f.code);
  const bankName = (id: string | null) => (id ? banks.find((b) => b.id === id)?.name ?? "Bank" : "");
  const head = ["Office", "Tax year", "Return reference", "Taxpayer", "Filed", "Funded", "Bank product", ...s.byFee.map((f) => f.label), "Total fees", "Collected", "Balance", "Status"];
  const body = s.lines.map((l) => [
    office.name, l.ret.tax_year, l.ret.return_ref, l.ret.taxpayer_name, l.ret.filed_on, l.ret.funded_on, bankName(l.ret.bank_option_id),
    ...codes.map((c) => cents(l.fees.find((f) => f.code === c)?.amount_cents ?? 0)), cents(l.owed), cents(l.collected), cents(l.balance), STATUS_LABEL[l.status],
  ]);
  const total = ["Total", "", `${s.totals.returns} returns`, "", "", "", "", ...s.byFee.map((f) => cents(f.amount)), cents(s.totals.owed), cents(s.totals.collected), cents(s.totals.balance), ""];
  return toCsv([head, ...body, total]);
}
const cents = (n: number) => Number((n / 100).toFixed(2));

export const fileSafe = (s: string) => s.replace(/[^A-Za-z0-9 _-]/g, "").trim().slice(0, 60) || "office";
