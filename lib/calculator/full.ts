// The full 2026 federal refund estimator (the calculator demonstrated to
// customers). This is a direct port of the published demo's logic; tests run
// the demo's own script against this module on random inputs to keep them
// identical. Pure functions only, so the browser (live results) and the server
// (the figures forwarded with a lead) use the same code.

export type FullStatus = "single" | "hoh" | "mfj" | "mfs";
export const FULL_STATUSES: FullStatus[] = ["single", "hoh", "mfj", "mfs"];
export const FULL_STATUS_LABELS: Record<FullStatus, string> = {
  single: "Single",
  hoh: "Head of Household",
  mfj: "Married Filing Jointly",
  mfs: "Married Filing Separately",
};
export const FULL_TAX_YEAR = 2026;

export type YesNo = "" | "Yes" | "No";

export type FullInputs = {
  status: FullStatus;
  wages: number;
  withholding: number;
  netProfit: number;
  investment: number;
  kids: number;
  tips: number;
  overtime: number;
  vehicleInterest: number;
  otherAdjustments: number;
  seniorSelf: boolean;
  seniorSpouse: boolean;
  tipsQualified: boolean;
  overtimeQualified: boolean;
  vehicleQualified: boolean;
  eicAge: YesNo;
  eicUs: YesNo;
  eicDependent: boolean;
  eicMfsApart: boolean;
};

export type FullResult = {
  difference: number; // positive = refund, negative = balance due
  totalTax: number;
  payments: number;
  incomeTaxAfterCredits: number;
  seTax: number;
  additionalMedicare: number;
  eitc: number;
  actc: number;
  schedule1A: number;
  standardDeduction: number;
  agi: number;
  taxableIncome: number;
};

const STD_DED: Record<FullStatus, number> = { single: 16100, hoh: 24150, mfj: 32200, mfs: 16100 };
type Bracket = { upto: number; rate: number };
const BRACKETS: Record<FullStatus, Bracket[]> = {
  single: [{ upto: 12400, rate: 0.1 }, { upto: 50400, rate: 0.12 }, { upto: 105700, rate: 0.22 }, { upto: 201775, rate: 0.24 }, { upto: 256225, rate: 0.32 }, { upto: 640600, rate: 0.35 }, { upto: Infinity, rate: 0.37 }],
  hoh: [{ upto: 17700, rate: 0.1 }, { upto: 67450, rate: 0.12 }, { upto: 105700, rate: 0.22 }, { upto: 201750, rate: 0.24 }, { upto: 256200, rate: 0.32 }, { upto: 640600, rate: 0.35 }, { upto: Infinity, rate: 0.37 }],
  mfj: [{ upto: 24800, rate: 0.1 }, { upto: 100800, rate: 0.12 }, { upto: 211400, rate: 0.22 }, { upto: 403550, rate: 0.24 }, { upto: 512450, rate: 0.32 }, { upto: 768700, rate: 0.35 }, { upto: Infinity, rate: 0.37 }],
  mfs: [{ upto: 12400, rate: 0.1 }, { upto: 50400, rate: 0.12 }, { upto: 105700, rate: 0.22 }, { upto: 201775, rate: 0.24 }, { upto: 256225, rate: 0.32 }, { upto: 384350, rate: 0.35 }, { upto: Infinity, rate: 0.37 }],
};
const CTC_PHASEOUT: Record<FullStatus, number> = { single: 200000, hoh: 200000, mfs: 200000, mfj: 400000 };
const CTC_PER_CHILD = 2200;
const ACTC_MAX_PER_CHILD = 1700;
const ACTC_EARNED_THRESHOLD = 2500;
const ACTC_RATE = 0.15;
const SS_WAGE_BASE = 184500;
type EitcRow = { earnedIncomeAmount: number; maxCredit: number; thOther: number; endOther: number; thMFJ: number; endMFJ: number };
const EITC_INVESTMENT_LIMIT = 12200;
const EITC: Record<number, EitcRow> = {
  0: { earnedIncomeAmount: 8680, maxCredit: 664, thOther: 10860, endOther: 19540, thMFJ: 18140, endMFJ: 26820 },
  1: { earnedIncomeAmount: 13020, maxCredit: 4427, thOther: 23890, endOther: 51593, thMFJ: 31160, endMFJ: 58863 },
  2: { earnedIncomeAmount: 18290, maxCredit: 7316, thOther: 23890, endOther: 58629, thMFJ: 31160, endMFJ: 65899 },
  3: { earnedIncomeAmount: 18290, maxCredit: 8231, thOther: 23890, endOther: 62974, thMFJ: 31160, endMFJ: 70244 },
};

const MAX_AMOUNT = 1_000_000_000;
/** Non-negative finite number, as the demo's `num()`; additionally capped so absurd input cannot overflow downstream. */
export const num = (value: unknown): number => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : 0;
  return Number.isFinite(n) ? Math.min(MAX_AMOUNT, Math.max(0, n)) : 0;
};
const round = (value: number) => Math.max(0, Math.round(Number(value) || 0));

function progressiveTax(taxable: number, brackets: Bracket[]) {
  let tax = 0;
  let previous = 0;
  for (const bracket of brackets) {
    const amount = Math.max(0, Math.min(taxable, bracket.upto) - previous);
    tax += amount * bracket.rate;
    previous = bracket.upto;
    if (taxable <= bracket.upto) break;
  }
  return tax;
}

function estimateSETax(netProfit: number, wages: number) {
  if (netProfit <= 0) return 0;
  const net = netProfit * 0.9235;
  const remainingSSWages = Math.max(0, SS_WAGE_BASE - Math.max(0, wages));
  return Math.min(net, remainingSSWages) * 0.124 + net * 0.029;
}

function estimateAdditionalMedicareTax(status: FullStatus, wages: number, netProfit: number) {
  const threshold = status === "mfj" ? 250000 : status === "mfs" ? 125000 : 200000;
  const combined = Math.max(0, wages) + Math.max(0, netProfit * 0.9235);
  return Math.max(0, combined - threshold) * 0.009;
}

function phaseout(amount: number, magi: number, threshold: number, rate: number) {
  if (magi <= threshold) return Math.max(0, amount);
  return Math.max(0, amount - (magi - threshold) * rate);
}

function schedule1A(d: { status: FullStatus; magi: number; tips: number; overtime: number; vehicleInterest: number; seniorSelf: boolean; seniorSpouse: boolean; tipsQualified: boolean; overtimeQualified: boolean; vehicleQualified: boolean }) {
  const joint = d.status === "mfj";
  const tips = d.tipsQualified ? Math.min(d.tips, 25000) : 0;
  const overtime = d.overtimeQualified ? Math.min(d.overtime, joint ? 25000 : 12500) : 0;
  const vehicle = d.vehicleQualified ? Math.min(d.vehicleInterest, 10000) : 0;
  const tipsDeduction = phaseout(tips, d.magi, joint ? 300000 : 150000, 0.06);
  const overtimeDeduction = phaseout(overtime, d.magi, joint ? 300000 : 150000, 0.06);
  const vehicleDeduction = phaseout(vehicle, d.magi, joint ? 200000 : 100000, 0.2);
  const seniorBase = phaseout(6000, d.magi, joint ? 150000 : 75000, 0.06);
  const senior = (d.seniorSelf ? seniorBase : 0) + (joint && d.seniorSpouse ? seniorBase : 0);
  return round(tipsDeduction + overtimeDeduction + vehicleDeduction + senior);
}

function computeEITC(d: { status: FullStatus; kids: number; earned: number; agi: number; investment: number; noChildOk: boolean; mfsApart: boolean }) {
  const kids = Math.min(3, Math.max(0, Math.floor(d.kids)));
  const p = EITC[kids];
  if (!p || d.investment > EITC_INVESTMENT_LIMIT) return 0;
  if (d.status === "mfs" && !d.mfsApart) return 0;
  if (kids === 0 && !d.noChildOk) return 0;
  if (d.earned <= 0) return 0;
  const threshold = d.status === "mfj" ? p.thMFJ : p.thOther;
  const end = d.status === "mfj" ? p.endMFJ : p.endOther;
  const maxByIncome = Math.min(p.maxCredit, d.earned * (p.maxCredit / p.earnedIncomeAmount));
  const base = Math.max(d.agi, d.earned);
  if (base >= end) return 0;
  let credit = maxByIncome;
  if (base > threshold) credit -= (base - threshold) * (p.maxCredit / (end - threshold));
  return round(Math.max(0, credit));
}

function computeCTC(d: { kids: number; incomeTax: number; earned: number; status: FullStatus; agi: number }) {
  const kids = Math.max(0, Math.floor(d.kids));
  const threshold = CTC_PHASEOUT[d.status] || 200000;
  const reduction = Math.ceil(Math.max(0, d.agi - threshold) / 1000) * 50;
  const perChild = Math.max(0, CTC_PER_CHILD - reduction);
  const total = kids * perChild;
  const nonrefundable = Math.min(Math.max(0, d.incomeTax), total);
  const remaining = Math.max(0, total - nonrefundable);
  const refundable = Math.min(remaining, Math.max(0, (d.earned - ACTC_EARNED_THRESHOLD) * ACTC_RATE), kids * ACTC_MAX_PER_CHILD);
  return { nonrefundable: round(nonrefundable), refundable: round(refundable) };
}

export const NEEDS_INCOME_MESSAGE = "Enter W-2 wages and/or self-employment net profit to calculate an estimate.";

/** Null when neither wages nor self-employment profit was entered (the demo refuses to calculate then). */
export function computeFull(i: FullInputs): FullResult | null {
  const { status, wages, withholding, netProfit, investment } = i;
  const kids = Math.floor(i.kids);
  if (!wages && !netProfit) return null;

  const seTax = estimateSETax(netProfit, wages);
  const baseAGI = Math.max(0, wages + netProfit - seTax / 2);
  const deductions = schedule1A({ status, magi: baseAGI, tips: i.tips, overtime: i.overtime, vehicleInterest: i.vehicleInterest, seniorSelf: i.seniorSelf, seniorSpouse: i.seniorSpouse && status === "mfj", tipsQualified: i.tipsQualified, overtimeQualified: i.overtimeQualified, vehicleQualified: i.vehicleQualified });
  const agi = Math.max(0, baseAGI - deductions - i.otherAdjustments);
  const standardDeduction = STD_DED[status] || STD_DED.single;
  const taxableIncome = Math.max(0, agi - standardDeduction);
  const incomeTaxBeforeCredits = progressiveTax(taxableIncome, BRACKETS[status]);
  const earnedIncome = wages + netProfit * 0.9235;

  const noChildEligible = kids > 0 || (i.eicAge === "Yes" && i.eicUs === "Yes" && !i.eicDependent);
  const eitc = computeEITC({ status, kids, earned: earnedIncome, agi, investment, noChildOk: noChildEligible, mfsApart: i.eicMfsApart });
  const childCredit = computeCTC({ kids, incomeTax: incomeTaxBeforeCredits, earned: earnedIncome, status, agi });

  const incomeTaxAfterCredits = Math.max(0, incomeTaxBeforeCredits - childCredit.nonrefundable);
  const additionalMedicare = estimateAdditionalMedicareTax(status, wages, netProfit);
  const totalTax = Math.max(0, incomeTaxAfterCredits + seTax + additionalMedicare);
  const payments = Math.max(0, withholding + eitc + childCredit.refundable);
  return { difference: payments - totalTax, totalTax, payments, incomeTaxAfterCredits, seTax, additionalMedicare, eitc, actc: childCredit.refundable, schedule1A: deductions, standardDeduction, agi, taxableIncome };
}

const yesNo = (v: unknown): YesNo => (v === "Yes" || v === "No" ? v : "");

/** Builds trusted inputs from untrusted JSON (the lead endpoint recomputes the figures it forwards; it never trusts client-computed results). */
export function sanitizeFullInputs(raw: unknown): FullInputs | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const status = FULL_STATUSES.find((s) => s === r.status);
  if (!status) return null;
  return {
    status,
    wages: num(r.wages),
    withholding: num(r.withholding),
    netProfit: num(r.netProfit),
    investment: num(r.investment),
    kids: Math.floor(num(r.kids)),
    tips: num(r.tips),
    overtime: num(r.overtime),
    vehicleInterest: num(r.vehicleInterest),
    otherAdjustments: num(r.otherAdjustments),
    seniorSelf: r.seniorSelf === true,
    seniorSpouse: r.seniorSpouse === true && status === "mfj",
    tipsQualified: r.tipsQualified !== false,
    overtimeQualified: r.overtimeQualified !== false,
    vehicleQualified: r.vehicleQualified !== false,
    eicAge: yesNo(r.eicAge),
    eicUs: yesNo(r.eicUs),
    eicDependent: r.eicDependent === true,
    eicMfsApart: r.eicMfsApart === true,
  };
}

export const fullMoney = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value) || 0);

/** The headline exactly as the demo words it. */
export const fullHeadline = (difference: number) => (difference >= 0 ? `Estimated Refund: ${fullMoney(difference)}` : `Estimated Balance Due: ${fullMoney(Math.abs(difference))}`);

/** What is sent to the buyer with a lead: whole-dollar figures only, no income inputs. */
export function fullEstimateForLead(r: FullResult, status: FullStatus) {
  const whole = (n: number) => Math.round(n);
  const refund = r.difference >= 0;
  return {
    tax_year: FULL_TAX_YEAR,
    filing_status: status,
    filing_status_label: FULL_STATUS_LABELS[status],
    result: refund ? ("refund" as const) : ("owed" as const),
    amount: whole(Math.abs(r.difference)),
    currency: "USD",
    headline: fullHeadline(r.difference),
    estimated_federal_tax: whole(r.totalTax),
    withholding_plus_refundable_credits: whole(r.payments),
    breakdown: {
      federal_income_tax_after_child_tax_credit: whole(r.incomeTaxAfterCredits),
      self_employment_tax: whole(r.seTax),
      additional_medicare_tax: whole(r.additionalMedicare),
      earned_income_tax_credit: whole(r.eitc),
      refundable_additional_child_tax_credit: whole(r.actc),
      schedule_1a_deductions: whole(r.schedule1A),
      standard_deduction: whole(r.standardDeduction),
      adjusted_gross_income: whole(r.agi),
      taxable_income: whole(r.taxableIncome),
    },
  };
}
export type FullLeadEstimate = ReturnType<typeof fullEstimateForLead>;

/** Plain-text version for an email body or CRM note. */
export function fullEstimateText(e: FullLeadEstimate): string {
  const b = e.breakdown;
  return [
    `${e.headline} (${e.tax_year} tax year, ${e.filing_status_label})`,
    `Estimated federal tax: ${fullMoney(e.estimated_federal_tax)}`,
    `Withholding + refundable credits: ${fullMoney(e.withholding_plus_refundable_credits)}`,
    `Federal income tax after child tax credit: ${fullMoney(b.federal_income_tax_after_child_tax_credit)}`,
    `Self-employment tax: ${fullMoney(b.self_employment_tax)}`,
    `Additional Medicare tax: ${fullMoney(b.additional_medicare_tax)}`,
    `Earned Income Tax Credit: ${fullMoney(b.earned_income_tax_credit)}`,
    `Refundable Additional Child Tax Credit: ${fullMoney(b.refundable_additional_child_tax_credit)}`,
    `Schedule 1-A deductions: ${fullMoney(b.schedule_1a_deductions)}`,
    `Standard deduction used: ${fullMoney(b.standard_deduction)}`,
    `Adjusted gross income (estimate): ${fullMoney(b.adjusted_gross_income)}`,
    `Taxable income (estimate): ${fullMoney(b.taxable_income)}`,
    "Preliminary federal estimate from figures the visitor entered; not tax advice or a tax return.",
  ].join("\n");
}
