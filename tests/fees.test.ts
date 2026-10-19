import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import { BANK_FIELDS, csvCell, guessMapping, parseCsv, parseDate, RETURN_FIELDS } from "../lib/fees/csv.ts";
import { buildStatement, chargesFor, codeFor, effectiveLines, MONARCH_TEMPLATE, parseMoney, returnLine } from "../lib/fees/engine.ts";
import { addLine, importBank, importReturns, linkReceipt, loadTemplate, markPaid, reapplyFees, recordReturn, scheduleFor, setOverride, statementCsv, statementFor, updateReturn } from "../lib/fees/service.ts";
import type { BankImport, FeeEvent, FeeLine, FeeSchedule, FeesRepo, Mapping, MappingKind, Receipt, ReturnFee, TaxReturn } from "../lib/fees/types.ts";

const OFFICE_A = "00000000-0000-4000-8000-0000000000aa";
const OFFICE_B = "00000000-0000-4000-8000-0000000000bb";
const BANK_1 = "00000000-0000-4000-8000-000000000b01";
const BANK_2 = "00000000-0000-4000-8000-000000000b02";
const ADMIN = "00000000-0000-4000-8000-00000000ad01";

class MemoryFeesRepo implements FeesRepo {
  schedules: FeeSchedule[] = []; lines: FeeLine[] = []; returns: TaxReturn[] = []; fees: ReturnFee[] = [];
  imports: BankImport[] = []; receipts: Receipt[] = []; mappings = new Map<MappingKind, Mapping>(); events: FeeEvent[] = [];
  async listOffices() { return [{ id: OFFICE_A, name: "Alpha Tax", archived: false }, { id: OFFICE_B, name: "Bravo Tax", archived: false }]; }
  async listBanks() { return [{ id: BANK_1, name: "Santa Barbara TPG", active: true }, { id: BANK_2, name: "Refund Advantage", active: true }]; }
  async getDefaultSchedule() { return this.schedules.find((s) => s.organization_id === null) ?? null; }
  async getOfficeSchedule(id: string) { return this.schedules.find((s) => s.organization_id === id) ?? null; }
  async listOfficeSchedules() { return this.schedules.filter((s) => s.organization_id !== null); }
  async insertSchedule(i: { organization_id: string | null; name: string }) { const s = { id: randomUUID(), organization_id: i.organization_id, name: i.name, notes: null, updated_at: new Date().toISOString() }; this.schedules.push(s); return s; }
  async deleteSchedule(id: string) { this.schedules = this.schedules.filter((s) => s.id !== id); }
  async listLines(ids: string[]) { return this.lines.filter((l) => ids.includes(l.schedule_id)); }
  async insertLine(scheduleId: string, i: Omit<FeeLine, "id" | "schedule_id" | "kind">) {
    if (this.lines.some((l) => l.schedule_id === scheduleId && l.code === i.code)) throw new Error("duplicate key");
    const l: FeeLine = { id: randomUUID(), schedule_id: scheduleId, kind: "fee", ...i }; this.lines.push(l); return l;
  }
  async updateLine(id: string, patch: Partial<FeeLine>) { const l = this.lines.find((x) => x.id === id)!; Object.assign(l, patch); return l; }
  async deleteLine(id: string) { this.lines = this.lines.filter((l) => l.id !== id); }
  async listReturns(f: { officeId?: string; taxYear?: number; ids?: string[] }) { return this.returns.filter((r) => (!f.officeId || r.organization_id === f.officeId) && (!f.taxYear || r.tax_year === f.taxYear) && (!f.ids || f.ids.includes(r.id))); }
  async getReturn(id: string) { const r = this.returns.find((x) => x.id === id); return r ? { ...r } : null; }
  async findReturnsByRef(ref: string, year?: number) { return this.returns.filter((r) => r.return_ref.toLowerCase() === ref.toLowerCase() && (!year || r.tax_year === year)); }
  async insertReturn(i: Omit<TaxReturn, "id" | "archived_at" | "archive_reason" | "created_at" | "updated_at" | "source"> & { source?: TaxReturn["source"] }) {
    const t = new Date().toISOString();
    const r: TaxReturn = { id: randomUUID(), archived_at: null, archive_reason: null, created_at: t, updated_at: t, source: i.source ?? "manual", organization_id: i.organization_id, tax_year: i.tax_year, return_ref: i.return_ref, taxpayer_name: i.taxpayer_name, bank_option_id: i.bank_option_id, filed_on: i.filed_on, funded_on: i.funded_on, notes: i.notes };
    this.returns.push(r); return r;
  }
  async updateReturn(id: string, patch: Partial<TaxReturn>) { const r = this.returns.find((x) => x.id === id)!; Object.assign(r, patch); return { ...r }; }
  async listFees(ids: string[]) { return this.fees.filter((f) => ids.includes(f.return_id)); }
  async replaceFees(returnId: string, charges: Omit<ReturnFee, "id" | "return_id">[]) { this.fees = [...this.fees.filter((f) => f.return_id !== returnId), ...charges.map((c) => ({ id: randomUUID(), return_id: returnId, ...c }))]; }
  async findImportByHash(h: string) { return this.imports.find((i) => i.file_sha256 === h) ?? null; }
  async insertImport(i: Omit<BankImport, "id" | "created_at">) { const x = { id: randomUUID(), created_at: new Date().toISOString(), ...i }; this.imports.push(x); return x; }
  async listImports() { return this.imports; }
  async listReceipts(f: { returnIds?: string[]; unmatched?: boolean; importId?: string }) { return this.receipts.filter((r) => (!f.returnIds || (r.return_id !== null && f.returnIds.includes(r.return_id))) && (!f.unmatched || r.return_id === null) && (!f.importId || r.import_id === f.importId)); }
  async insertReceipts(rows: Omit<Receipt, "id" | "created_at">[]) { const out = rows.map((r) => ({ id: randomUUID(), created_at: new Date().toISOString(), ...r })); this.receipts.push(...out); return out; }
  async linkReceipt(id: string, link: { return_id: string; organization_id: string }) { const r = this.receipts.find((x) => x.id === id)!; Object.assign(r, link); return r; }
  async getReceipt(id: string) { return this.receipts.find((r) => r.id === id) ?? null; }
  async getMapping(k: MappingKind) { return this.mappings.get(k) ?? null; }
  async saveMapping(k: MappingKind, m: Mapping) { this.mappings.set(k, m); }
  async addEvent(e: Omit<FeeEvent, "id" | "created_at">) { this.events.push({ id: randomUUID(), created_at: new Date().toISOString(), ...e }); }
  async listEvents() { return this.events; }
}

const setup = async () => {
  const repo = new MemoryFeesRepo();
  const deps = { repo, now: () => new Date("2026-03-01T12:00:00Z") };
  await loadTemplate(deps, ADMIN);
  return { repo, deps };
};
const ret = (over: Partial<Parameters<typeof recordReturn>[2]> = {}) => ({ officeId: OFFICE_A, taxYear: "2025", returnRef: "R-100", taxpayerName: "Pat Example", bankId: null, filedOn: "2026-02-10", fundedOn: "", notes: "", ...over });

describe("fee math", () => {
  test("money parsing and codes", () => {
    assert.equal(parseMoney("$1,250.50"), 125050);
    assert.equal(parseMoney("79"), 7900);
    assert.equal(parseMoney("21.5"), 2150);
    assert.equal(parseMoney("-5"), null);
    assert.equal(parseMoney("abc"), null);
    assert.equal(codeFor("E-file fee"), "e_file_fee");
    assert.equal(codeFor("Bank fee", BANK_1), "bank_fee:00000000");
  });

  test("Monarch's template is $223 a return, and it's only a template", () => {
    assert.equal(MONARCH_TEMPLATE.reduce((s, l) => s + l.amount_cents, 0), 22300);
    const lines: FeeLine[] = [{ id: "1", schedule_id: "s", code: "a", label: "A", amount_cents: 5000, applies: "every_return", bank_option_id: null, kind: "fee", sort_order: 1 }];
    assert.equal(chargesFor({ bank_option_id: null }, lines).reduce((s, c) => s + c.amount_cents, 0), 5000, "charges come from the saved schedule only");
  });

  test("bank fees apply only to bank-product returns, and a bank's own fee only to that bank", () => {
    const L = (code: string, amount: number, applies: FeeLine["applies"], bank: string | null = null): FeeLine => ({ id: code, schedule_id: "s", code, label: code, amount_cents: amount, applies, bank_option_id: bank, kind: "fee", sort_order: 1 });
    const lines = [L("base", 22300, "every_return"), L("any_bank", 1000, "bank_product"), L("b1", 3995, "bank_product", BANK_1), L("b2", 2500, "bank_product", BANK_2)];
    const total = (bank: string | null) => chargesFor({ bank_option_id: bank }, lines).reduce((s, c) => s + c.amount_cents, 0);
    assert.equal(total(null), 22300);
    assert.equal(total(BANK_1), 22300 + 1000 + 3995);
    assert.equal(total(BANK_2), 22300 + 1000 + 2500);
  });

  test("an office override replaces the bureau line with the same code, and $0 drops it", () => {
    const L = (code: string, amount: number): FeeLine => ({ id: code + amount, schedule_id: "s", code, label: code, amount_cents: amount, applies: "every_return", bank_option_id: null, kind: "fee", sort_order: 1 });
    const eff = effectiveLines([L("bureau", 7900), L("efile", 9900)], [L("bureau", 5900), L("efile", 0), L("extra", 500)]);
    assert.deepEqual(chargesFor({ bank_option_id: null }, eff).map((c) => [c.code, c.amount_cents]), [["bureau", 5900], ["extra", 500]]);
  });

  test("a return's status: owed by ERO, awaiting funding, partly paid, paid", () => {
    const r = { id: "r", bank_option_id: null } as TaxReturn;
    const f = [{ id: "f", return_id: "r", code: "x", label: "x", amount_cents: 22300, applies: "every_return", schedule_id: null, sort_order: 1 }] as ReturnFee[];
    const pay = (c: number) => [{ collected_cents: c } as Receipt];
    assert.equal(returnLine(r, f, []).status, "owed_by_ero");
    assert.equal(returnLine({ ...r, bank_option_id: BANK_1 }, f, []).status, "awaiting_funding");
    assert.equal(returnLine(r, f, pay(10000)).status, "partly_paid");
    assert.equal(returnLine(r, f, pay(22300)).status, "paid");
  });
});

describe("CSV", () => {
  test("quotes, commas, CRLF, BOM and semicolons", () => {
    assert.deepEqual(parseCsv('﻿Ref,Name\r\n1,"Doe, Jane"\r\n2,"Say ""hi"""\r\n'), [["Ref", "Name"], ["1", "Doe, Jane"], ["2", 'Say "hi"']]);
    assert.deepEqual(parseCsv("a;b\n1;2\n"), [["a", "b"], ["1", "2"]]);
    assert.deepEqual(parseCsv('a,b\n1,"two\nlines"\n'), [["a", "b"], ["1", "two\nlines"]]);
    assert.throws(() => parseCsv('a,b\n1,"open'), /unclosed quote/);
  });
  test("column guessing and dates", () => {
    assert.deepEqual(guessMapping(["Submission ID", "Taxpayer Name", "Bank", "Date Filed"], RETURN_FIELDS), { return_ref: "Submission ID", taxpayer_name: "Taxpayer Name", bank: "Bank", filed_on: "Date Filed" });
    assert.equal(guessMapping(["Ref", "Fees Collected", "Fees Owed"], BANK_FIELDS).collected, "Fees Collected");
    assert.equal(parseDate("2/14/26"), "2026-02-14");
    assert.equal(parseDate("2026-02-30"), null);
    assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
    assert.equal(csvCell(-12.5), "-12.5");
  });
});

describe("Fees & Statements service", () => {
  test("loading the template twice is refused; lines and overrides are recorded in the history", async () => {
    const { deps, repo } = await setup();
    await assert.rejects(() => loadTemplate(deps, ADMIN), /already has fees/);
    await addLine(deps, ADMIN, { label: "Bank fee", amount: "39.95", applies: "bank_product", bankId: BANK_1 });
    await setOverride(deps, ADMIN, OFFICE_B, "service_bureau_fee", "59");
    const b = await scheduleFor(deps, OFFICE_B);
    assert.equal(b.effective.find((l) => l.code === "service_bureau_fee")!.amount_cents, 5900);
    assert.equal((await scheduleFor(deps, OFFICE_A)).effective.find((l) => l.code === "service_bureau_fee")!.amount_cents, 7900);
    await setOverride(deps, ADMIN, OFFICE_B, "service_bureau_fee", "");
    assert.equal((await scheduleFor(deps, OFFICE_B)).effective.find((l) => l.code === "service_bureau_fee")!.amount_cents, 7900);
    assert.deepEqual(repo.events.map((e) => e.action), ["template_loaded", "line_added", "override_set", "override_removed"]);
    await assert.rejects(() => addLine(deps, ADMIN, { label: "Bank fee", amount: "1", applies: "every_return", bankId: BANK_1 }), /bank-product returns only/);
  });

  test("a return is charged when it's recorded, and later schedule changes don't rewrite it", async () => {
    const { deps, repo } = await setup();
    const r = await recordReturn(deps, ADMIN, ret());
    assert.equal((await repo.listFees([r.id])).reduce((s, f) => s + f.amount_cents, 0), 22300);
    const line = repo.lines.find((l) => l.code === "e_file_fee")!;
    line.amount_cents = 12900;
    assert.equal((await repo.listFees([r.id])).reduce((s, f) => s + f.amount_cents, 0), 22300, "past returns keep their fees");
    await assert.rejects(() => reapplyFees(deps, ADMIN, r.id, ""), /Say why/);
    await reapplyFees(deps, ADMIN, r.id, "Agreed new e-file fee");
    assert.equal((await repo.listFees([r.id])).reduce((s, f) => s + f.amount_cents, 0), 25300);
    await assert.rejects(() => recordReturn(deps, ADMIN, ret()), /already recorded/);
  });

  test("changing the bank re-charges bank fees while nothing has been collected", async () => {
    const { deps, repo } = await setup();
    await addLine(deps, ADMIN, { label: "Bank fee", amount: "39.95", applies: "bank_product", bankId: BANK_1 });
    const r = await recordReturn(deps, ADMIN, ret());
    await updateReturn(deps, ADMIN, r.id, ret({ bankId: BANK_1 }));
    assert.equal((await repo.listFees([r.id])).reduce((s, f) => s + f.amount_cents, 0), 22300 + 3995);
  });

  test("returns without a bank product are owed by the ERO and marked paid by hand", async () => {
    const { deps } = await setup();
    const r = await recordReturn(deps, ADMIN, ret());
    let s = await statementFor(deps, OFFICE_A, { taxYear: 2025, month: null });
    assert.equal(s.lines[0].status, "owed_by_ero");
    assert.equal(s.totals.owedByEro, 22300);
    await assert.rejects(() => markPaid(deps, ADMIN, r.id, { amount: "300", date: "", reference: "", note: "" }), /more than/);
    await markPaid(deps, ADMIN, r.id, { amount: "", date: "2026-03-01", reference: "CHK 1001", note: "" });
    s = await statementFor(deps, OFFICE_A, { taxYear: 2025, month: null });
    assert.equal(s.lines[0].status, "paid");
    assert.equal(s.totals.balance, 0);
    await assert.rejects(() => markPaid(deps, ADMIN, r.id, { amount: "", date: "", reference: "", note: "" }), /Nothing is owed/);
  });

  test("returns import: creates, updates by reference, and lists bad rows", async () => {
    const { deps, repo } = await setup();
    const csv = "Return ID,Taxpayer,Bank,Filed\nR-1,Ann One,Santa Barbara TPG,2/01/2026\nR-2,Bob Two,,2026-02-03\nR-3,Cy Three,Mystery Bank,\n,No Ref,,\nR-1,Ann Again,,\n";
    const mapping = { return_ref: "Return ID", taxpayer_name: "Taxpayer", bank: "Bank", filed_on: "Filed" };
    const res = await importReturns(deps, ADMIN, { officeId: OFFICE_A, taxYear: "2025", text: csv, mapping });
    assert.equal(res.created, 2);
    assert.deepEqual(res.skipped.map((s) => s.row), [4, 5, 6]);
    assert.match(res.skipped[0].reason, /Mystery Bank/);
    assert.equal(repo.returns.find((r) => r.return_ref === "R-1")!.bank_option_id, BANK_1);
    const again = await importReturns(deps, ADMIN, { officeId: OFFICE_A, taxYear: "2025", text: "Return ID,Taxpayer\nR-2,Bob Two Jr\n", mapping: { return_ref: "Return ID", taxpayer_name: "Taxpayer" } });
    assert.equal(again.updated, 1);
    assert.equal(repo.returns.find((r) => r.return_ref === "R-2")!.taxpayer_name, "Bob Two Jr");
    assert.deepEqual(repo.mappings.get("returns"), { return_ref: "Return ID", taxpayer_name: "Taxpayer" });
  });

  test("bank import: owed vs collected, unmatched rows kept for linking, and the same file refused", async () => {
    const { deps, repo } = await setup();
    await recordReturn(deps, ADMIN, ret({ returnRef: "R-1", bankId: BANK_1 }));
    await recordReturn(deps, ADMIN, ret({ returnRef: "R-9", officeId: OFFICE_B, bankId: BANK_1 }));
    const csv = "Ref,Owed,Collected,Date\nR-1,223.00,223.00,03/01/2026\nR-404,223,100,03/02/2026\nR-1x,abc,1,\n";
    const mapping = { return_ref: "Ref", owed: "Owed", collected: "Collected", received_on: "Date" };
    const res = await importBank(deps, ADMIN, { bankId: BANK_1, fileName: "march.csv", text: csv, mapping });
    assert.deepEqual([res.matched, res.unmatched, res.skipped.length], [1, 1, 1]);
    await assert.rejects(() => importBank(deps, ADMIN, { bankId: BANK_1, fileName: "again.csv", text: csv, mapping }), /already imported/);
    const s = await statementFor(deps, OFFICE_A, { taxYear: 2025, month: null });
    assert.equal(s.lines[0].status, "paid");
    assert.equal(s.lines[0].receipts[0].owed_cents, 22300);
    const loose = repo.receipts.find((r) => r.row_ref === "R-404")!;
    await assert.rejects(() => linkReceipt(deps, ADMIN, loose.id, { officeId: OFFICE_A, returnRef: "R-9", taxYear: "" }), /No return with that reference in that office/);
    await linkReceipt(deps, ADMIN, loose.id, { officeId: OFFICE_B, returnRef: "R-9", taxYear: "" });
    const b = await statementFor(deps, OFFICE_B, { taxYear: 2025, month: null });
    assert.equal(b.lines[0].status, "partly_paid");
    assert.equal(b.totals.balance, 12300);
  });

  test("monthly statements, and the CSV export", async () => {
    const { deps } = await setup();
    await recordReturn(deps, ADMIN, ret({ returnRef: "FEB", filedOn: "2026-02-10" }));
    await recordReturn(deps, ADMIN, ret({ returnRef: "MAR", filedOn: "2026-03-05" }));
    const feb = await statementFor(deps, OFFICE_A, { taxYear: 2025, month: 2 });
    assert.deepEqual(feb.lines.map((l) => l.ret.return_ref), ["FEB"]);
    const season = await statementFor(deps, OFFICE_A, { taxYear: 2025, month: null });
    assert.equal(season.totals.owed, 44600);
    const csv = statementCsv({ id: OFFICE_A, name: "Alpha Tax", archived: false }, season, []);
    assert.match(csv.split("\r\n")[0], /Service bureau fee,Transmission fee,Technology fee,E-file fee,Total fees,Collected,Balance,Status/);
    assert.match(csv, /Alpha Tax,2025,FEB,Pat Example,2026-02-10,,,79,21,24,99,223,0,223,Owed by ERO/);
    assert.equal(buildStatement({ taxYear: 2024, month: null }, season.lines.map((l) => l.ret), [], []).totals.returns, 0);
  });
});
