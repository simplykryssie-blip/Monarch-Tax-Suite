import { test } from "node:test";
import assert from "node:assert/strict";
import { compute, diagnostics, eicAmt, normalizeReturn, qdcgTax, tax } from "../lib/lab/engine.ts";

// Every figure below was checked by hand against Rev. Proc. 2025-32 (2026 rate schedules, EIC table formula).
test("2026 rate schedules and tax-table midpoints", () => {
  assert.equal(tax(28819, "hoh"), 3105); // row 28,800-28,850: 1,770 + 12% of (28,825 - 17,700)
  assert.equal(tax(150000, "single"), 28598); // 17,966 + 24% of (150,000 - 105,700)
  assert.equal(tax(4, "single"), 0);
});

test("qualified dividends use the 0% band", () => {
  // Single, taxable 60,000 with 10,000 qualified: the 50,000 of ordinary income already fills the 0% band (49,450),
  // so the dividends are taxed at 15%: tax(50,000) = 5,755 (row midpoint 50,025) + 1,500 = 7,255.
  const t = qdcgTax(60000, 10000, 0, "single");
  assert.ok(t < tax(60000, "single"));
  assert.equal(t, 7255);
});

test("EIC table amounts", () => {
  assert.equal(eicAmt(20000, 1, false), 4427);
  assert.equal(eicAmt(30000, 1, false), 3447);
  assert.equal(eicAmt(9000, 0, false), 664);
});

const sample = {
  fs: "hoh", tp: { first: "Andrea", last: "Mills", ssn: "412-55-1234", age: "35", citizen: "yes" },
  addr: { street: "1418 Magnolia Ave", city: "Baton Rouge", state: "LA", zip: "70806" },
  deps: [{ name: "Jayden Mills", ssnNum: "412-55-7788", rel: "Son", age: "9", months: "12", ssn: true }],
  w2: [{ employer: "Bayou Family Dental", ein: "72-1234567", who: "tp", wages: "48200", fedwh: "3250" }],
  int: [{ payer: "Gulf Coast Credit Union", amt: "156" }],
  schc: [{ name: "Andrea's Braids", who: "tp", receipts: "10400", supplies: "1520", adv: "350", other: "700" }],
  ded: { type: "std", charStd: "600" },
  efile: { method: "dd", routing: "065400137", account: "4471902233", pin: "48213", consent: true },
};

test("sample return: head of household with a side business", () => {
  const c = compute(sample);
  assert.equal(c.lines.L9, 56186);
  assert.equal(c.lines.L11a, 55632);
  assert.equal(c.lines.L12e, 24150);
  assert.equal(c.lines.L12f, 600);
  assert.equal(c.lines.L13b, 1455);
  assert.equal(c.lines.L15, 29427);
  assert.equal(c.lines.L16, 3177);
  assert.equal(c.lines.L23, 1107);
  assert.equal(c.lines.L27a, 0); // AGI is past the one-child completed phaseout ($51,593)
  assert.equal(c.lines.L35a, 1166);
  assert.equal(diagnostics(sample).filter((d) => d.level === "reject").length, 0);
});

test("dependent care uses the 2026 50% rate", () => {
  const c = compute({ ...sample, cred: { dcPersons: "1", dcExp: "4000" } });
  assert.equal(c.d.dc, 1050); // AGI over $45,000 → 35% floor of the first phase-down, on $3,000
});

test("normalizeReturn fills missing fields and drops junk", () => {
  const r = normalizeReturn({ fs: "nope", w2: "x", tp: { first: "A", bogus: 1 }, extra: true });
  assert.equal(r.fs, "single");
  assert.deepEqual(r.w2, []);
  assert.equal(r.tp.first, "A");
  assert.equal((r.tp as Record<string, unknown>).bogus, undefined);
  assert.equal((r as Record<string, unknown>).extra, undefined);
});
