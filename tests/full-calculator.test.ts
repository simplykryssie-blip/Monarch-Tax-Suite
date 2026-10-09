import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { computeFull, fullEstimateForLead, fullEstimateText, fullHeadline, fullMoney, sanitizeFullInputs, type FullInputs, type FullStatus, type YesNo } from "../lib/calculator/full.ts";

// Parity: the customer-facing demo (monarchtaxsuite.com/basic-tax-calculator)
// is a single script. tests/fixtures/original-full-calculator.html is that
// page's HTML as served. These tests execute the demo's own script in a tiny
// fake DOM and require identical output to lib/calculator/full.ts.

const html = readFileSync(new URL("./fixtures/original-full-calculator.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];

type El = { value: string; checked: boolean; disabled: boolean; style: Record<string, string>; textContent: string; innerHTML: string; dataset: Record<string, string>; classList: { add(): void; remove(): void }; listeners: Record<string, () => void>; addEventListener(t: string, f: () => void): void; scrollIntoView(): void };

function runDemo() {
  const els = new Map<string, El>();
  const get = (id: string): El => {
    let e = els.get(id);
    if (!e) {
      const defaults: Record<string, string> = { abc_status: "single", abc_tips_qualified: "Yes", abc_overtime_qualified: "Yes", abc_vehicle_qualified: "Yes", abc_eic_age: "", abc_eic_us: "" };
      e = { value: defaults[id] ?? "0", checked: false, disabled: false, style: {}, textContent: "", innerHTML: "", dataset: {}, classList: { add() {}, remove() {} }, listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, scrollIntoView() {} };
      els.set(id, e);
    }
    return e;
  };
  const root = { dataset: {} as Record<string, string>, innerHTML: "", querySelector: (sel: string) => get(sel.slice(1)), querySelectorAll: () => [] as unknown[] };
  const document = { readyState: "complete", getElementById: () => root, addEventListener() {} };
  vm.runInNewContext(script, { document, setInterval: () => 1, clearInterval() {}, Intl, Number, Math, Infinity });
  return {
    run(i: FullInputs) {
      get("abc_status").value = i.status;
      get("abc_wages").value = String(i.wages);
      get("abc_wh").value = String(i.withholding);
      get("abc_senet").value = String(i.netProfit);
      get("abc_inv").value = String(i.investment);
      get("abc_kids").value = String(i.kids);
      get("abc_tips").value = String(i.tips);
      get("abc_overtime").value = String(i.overtime);
      get("abc_vehicle_interest").value = String(i.vehicleInterest);
      get("abc_other_deductions").value = String(i.otherAdjustments);
      get("abc_senior_self").checked = i.seniorSelf;
      get("abc_senior_spouse").checked = i.seniorSpouse;
      get("abc_tips_qualified").value = i.tipsQualified ? "Yes" : "No";
      get("abc_overtime_qualified").value = i.overtimeQualified ? "Yes" : "No";
      get("abc_vehicle_qualified").value = i.vehicleQualified ? "Yes" : "No";
      get("abc_eic_age").value = i.eicAge;
      get("abc_eic_us").value = i.eicUs;
      get("abc_eic_dep").checked = i.eicDependent;
      get("abc_eic_mfs_apart").checked = i.eicMfsApart;
      for (const id of ["abc_refund_big", "abc_tax_pill", "abc_payments_pill", "abc_breakdown"]) { get(id).textContent = ""; get(id).innerHTML = ""; }
      get("abc_warn").textContent = "";
      get("abc_status").listeners.change?.();
      get("abc_calc").listeners.click();
      const lines = [...get("abc_breakdown").innerHTML.matchAll(/<span>([^<]*)<\/span><strong>([^<]*)<\/strong>/g)].map((m) => [m[1], m[2]]);
      return { headline: get("abc_refund_big").textContent, tax: get("abc_tax_pill").textContent, payments: get("abc_payments_pill").textContent, lines: Object.fromEntries(lines), warn: get("abc_warn").textContent };
    },
  };
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
const base: FullInputs = { status: "single", wages: 0, withholding: 0, netProfit: 0, investment: 0, kids: 0, tips: 0, overtime: 0, vehicleInterest: 0, otherAdjustments: 0, seniorSelf: false, seniorSpouse: false, tipsQualified: true, overtimeQualified: true, vehicleQualified: true, eicAge: "", eicUs: "", eicDependent: false, eicMfsApart: false };

function present(i: FullInputs) {
  const r = computeFull(i)!;
  return {
    headline: fullHeadline(r.difference),
    tax: fullMoney(r.totalTax),
    payments: fullMoney(r.payments),
    lines: {
      "Federal income tax after child tax credit": fullMoney(r.incomeTaxAfterCredits),
      "Self-employment tax": fullMoney(r.seTax),
      "Additional Medicare tax": fullMoney(r.additionalMedicare),
      "Earned Income Tax Credit (EITC)": fullMoney(r.eitc),
      "Refundable Additional Child Tax Credit": fullMoney(r.actc),
      "Schedule 1-A deductions entered": fullMoney(r.schedule1A),
      "Standard deduction used": fullMoney(r.standardDeduction),
      "Adjusted gross income (estimate)": fullMoney(r.agi),
      "Taxable income (estimate)": fullMoney(r.taxableIncome),
    },
  };
}

test("the demo's script runs in the harness", () => {
  const demo = runDemo();
  const out = demo.run({ ...base, wages: 65000, withholding: 8500 });
  assert.match(out.headline, /^Estimated (Refund|Balance Due): \$/);
  assert.equal(Object.keys(out.lines).length, 9);
});

test("matches the published demo on 1,500 random scenarios (headline, totals, every breakdown line)", () => {
  const demo = runDemo();
  const rand = rng(20261009);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const amt = (max: number, zeroChance = 0.4) => (rand() < zeroChance ? 0 : Math.round(rand() * max));
  let compared = 0;
  for (let n = 0; n < 1500; n++) {
    const status = pick<FullStatus>(["single", "hoh", "mfj", "mfs"]);
    const scale = pick([30000, 80000, 200000, 600000, 1500000]);
    const i: FullInputs = {
      status,
      wages: amt(scale),
      withholding: amt(scale * 0.25),
      netProfit: amt(scale, 0.6),
      investment: amt(30000, 0.7),
      kids: pick([0, 0, 1, 2, 3, 4, 6]),
      tips: amt(40000, 0.7),
      overtime: amt(30000, 0.7),
      vehicleInterest: amt(14000, 0.7),
      otherAdjustments: amt(20000, 0.7),
      seniorSelf: rand() < 0.3,
      seniorSpouse: status === "mfj" && rand() < 0.3,
      tipsQualified: rand() < 0.8,
      overtimeQualified: rand() < 0.8,
      vehicleQualified: rand() < 0.8,
      eicAge: pick<YesNo>(["", "Yes", "No"]),
      eicUs: pick<YesNo>(["", "Yes", "No"]),
      eicDependent: rand() < 0.2,
      eicMfsApart: rand() < 0.4,
    };
    const expected = demo.run(i);
    if (!i.wages && !i.netProfit) {
      assert.equal(computeFull(i), null, "refuses to calculate without income, like the demo");
      assert.match(expected.warn, /Enter W-2 wages/);
      continue;
    }
    const mine = present(i);
    assert.equal(mine.headline, expected.headline, JSON.stringify(i));
    assert.equal(mine.tax, expected.tax, JSON.stringify(i));
    assert.equal(mine.payments, expected.payments, JSON.stringify(i));
    assert.deepEqual(mine.lines, expected.lines, JSON.stringify(i));
    compared++;
  }
  assert.ok(compared > 1000);
});

test("known case: single, $65,000 wages, $8,500 withheld", () => {
  const r = computeFull({ ...base, wages: 65000, withholding: 8500 })!;
  assert.equal(Math.round(r.taxableIncome), 48900);
  assert.equal(Math.round(r.totalTax), 5620);
  assert.equal(fullHeadline(r.difference), "Estimated Refund: $2,880");
});

test("no income entered: no estimate", () => {
  assert.equal(computeFull({ ...base, withholding: 5000 }), null);
});

test("sanitizeFullInputs: rejects junk, clamps numbers, ignores spouse senior unless MFJ", () => {
  assert.equal(sanitizeFullInputs(null), null);
  assert.equal(sanitizeFullInputs({ status: "bogus" }), null);
  const i = sanitizeFullInputs({ status: "single", wages: "-5", withholding: "abc", netProfit: 1e30, kids: 2.9, seniorSpouse: true, tipsQualified: false })!;
  assert.equal(i.wages, 0);
  assert.equal(i.withholding, 0);
  assert.equal(i.netProfit, 1_000_000_000);
  assert.equal(i.kids, 2);
  assert.equal(i.seniorSpouse, false);
  assert.equal(i.tipsQualified, false);
  assert.equal(i.overtimeQualified, true);
});

test("the lead estimate carries results only (whole dollars), with a text version for email", () => {
  const i = { ...base, wages: 65000, withholding: 8500 };
  const r = computeFull(i)!;
  const e = fullEstimateForLead(r, "single");
  assert.equal(e.result, "refund");
  assert.equal(e.amount, 2880);
  assert.equal(e.headline, "Estimated Refund: $2,880");
  assert.equal(e.breakdown.taxable_income, 48900);
  assert.deepEqual(Object.keys(e).sort(), ["amount", "breakdown", "currency", "estimated_federal_tax", "filing_status", "filing_status_label", "headline", "result", "tax_year", "withholding_plus_refundable_credits"], "only result fields; no raw income inputs");
  const text = fullEstimateText(e);
  assert.match(text, /^Estimated Refund: \$2,880 \(2026 tax year, Single\)/);
  assert.match(text, /not tax advice/);
});
