// Monarch Tax Lab practice engine: tax year 2026 (returns filed in 2027).
//
// Framework-free and pure, so the same code runs in the student's browser (live totals) and on the server (answer-key
// checks; students never receive answer keys). Figures come from Rev. Proc. 2025-32 and the One, Big, Beautiful Bill
// Act provisions that start in 2026. Line numbers follow the draft 2026 Form 1040 (12f charity for non-itemizers,
// 13a Schedule 1-A, 13b QBI, 24c total tax). This is a teaching engine, not filing software: anything it does not model
// is reported in `notes` rather than guessed.

export const TAX_YEAR = 2026;

export type FilingStatus = "single" | "mfj" | "mfs" | "hoh" | "qss";
type Who = "tp" | "sp";
type Str = string;

export type Person = { first: Str; mi: Str; last: Str; ssn: Str; age: Str; a65: boolean; blind: boolean; occupation: Str; phone?: Str; email?: Str; citizen: Str };
export type Dependent = { name: Str; ssnNum: Str; rel: Str; age: Str; months: Str; ssn: boolean; student: boolean; disabled: boolean };
export type W2 = { employer: Str; ein: Str; who: Who; wages: Str; fedwh: Str };
export type Int1099 = { payer: Str; amt: Str; fedwh: Str; exempt: Str };
export type Div1099 = { payer: Str; ord: Str; qual: Str; capd: Str; fedwh: Str };
export type G1099 = { payer: Str; unemp: Str; fedwh: Str };
export type R1099 = { payer: Str; gross: Str; taxable: Str; fedwh: Str; code: Str; ira: boolean };
export type Ssa1099 = { who: Who; net: Str; fedwh: Str };
export type ScheduleC = { name: Str; who: Who; receipts: Str; necPayer?: Str; nec?: Str } & Partial<Record<ExpenseKey, Str>>;
export type CapGain = { desc: Str; st: Str; lt: Str };
export type EdStudent = { name: Str; type: "aotc" | "llc"; exp: Str };

export type TaxReturn = {
  fs: FilingStatus;
  mfsLivedWith: boolean;
  tp: Person;
  sp: Person;
  addr: { street: Str; city: Str; state: Str; zip: Str };
  deps: Dependent[];
  w2: W2[];
  int: Int1099[];
  div: Div1099[];
  g: G1099[];
  r: R1099[];
  ssa: Ssa1099[];
  schc: ScheduleC[];
  capg: CapGain[];
  other: { staterefund: Str; desc: Str; amt: Str };
  adj: { educator: Str; hsa: Str; seHealth: Str; ira: Str; sli: Str; other: Str };
  ded: { type: "std" | "item"; item: Str; med: Str; saltIncome: Str; saltRE: Str; saltPP: Str; mortInt: Str; charCash: Str; charNon: Str; otherItem: Str; charStd: Str; tips: Str; overtime: Str; carint: Str; other1a: Str };
  cred: { dcExp: Str; dcPersons: Str; ed: EdStudent[]; nonref: Str; ref: Str };
  health: { covered: Str; ptcNet: Str; aptcRepay: Str };
  pay: { est: Str; prior: Str; applyNext: Str };
  efile: { method: "dd" | "check"; routing: Str; account: Str; acctType: Str; pin: Str; spPin: Str; consent: boolean };
};

const STD: Record<FilingStatus, number> = { single: 16100, mfj: 32200, mfs: 16100, hoh: 24150, qss: 32200 };
const ADD: Record<FilingStatus, number> = { single: 2050, hoh: 2050, mfj: 1650, mfs: 1650, qss: 1650 };
const BR: Record<"single" | "mfj" | "mfs" | "hoh", [number, number][]> = {
  single: [[12400, 0.1], [50400, 0.12], [105700, 0.22], [201775, 0.24], [256225, 0.32], [640600, 0.35], [Infinity, 0.37]],
  mfj: [[24800, 0.1], [100800, 0.12], [211400, 0.22], [403550, 0.24], [512450, 0.32], [768700, 0.35], [Infinity, 0.37]],
  mfs: [[12400, 0.1], [50400, 0.12], [105700, 0.22], [201775, 0.24], [256225, 0.32], [384350, 0.35], [Infinity, 0.37]],
  hoh: [[17700, 0.1], [67450, 0.12], [105700, 0.22], [201750, 0.24], [256200, 0.32], [640600, 0.35], [Infinity, 0.37]],
};
/** Maximum zero-rate and 15%-rate amounts for qualified dividends and net capital gain. */
const CG: Record<FilingStatus, [number, number]> = { single: [49450, 545500], mfj: [98900, 613700], qss: [98900, 613700], mfs: [49450, 306850], hoh: [66200, 579600] };
const QBI_T: Record<FilingStatus, number> = { single: 201750, hoh: 201750, mfs: 201775, mfj: 403500, qss: 403500 };
const SS_BASE = 184500;
/** EITC: [earned income amount, max credit, phase-in rate, phaseout rate, threshold (other), threshold (MFJ)]. */
const EIC: [number, number, number, number, number, number][] = [
  [8680, 664, 0.0765, 0.0765, 10860, 18140],
  [13020, 4427, 0.34, 0.1598, 23890, 31160],
  [18290, 7316, 0.4, 0.2106, 23890, 31160],
  [18290, 8231, 0.45, 0.2106, 23890, 31160],
];
const EIC_INV = 12200;

export const EXPENSE_KEYS = ["adv", "car", "labor", "ins", "office", "supplies", "util", "other"] as const;
export type ExpenseKey = (typeof EXPENSE_KEYS)[number];
export const EXPENSE_LABELS: Record<ExpenseKey, string> = {
  adv: "Advertising (line 8)", car: "Car and truck (line 9)", labor: "Contract labor (line 11)", ins: "Insurance (line 15)",
  office: "Office expense (line 18)", supplies: "Supplies (line 22)", util: "Utilities (line 25)", other: "Other expenses (line 27a)",
};
export const EIC_RELATIONSHIPS = ["Son", "Daughter", "Stepchild", "Foster child", "Brother", "Sister", "Half brother", "Half sister", "Grandchild", "Niece", "Nephew"];
export const FILING_STATUSES: [FilingStatus, string][] = [["single", "Single"], ["mfj", "Married filing jointly"], ["mfs", "Married filing separately"], ["hoh", "Head of household"], ["qss", "Qualifying surviving spouse"]];

export const LINES = [
  ["L1z", "1z", "Wages (W-2 box 1 total)"],
  ["L2b", "2b", "Taxable interest"],
  ["L3b", "3b", "Ordinary dividends"],
  ["L4b", "4b", "IRA distributions, taxable"],
  ["L5b", "5b", "Pensions and annuities, taxable"],
  ["L6b", "6b", "Social Security benefits, taxable"],
  ["L7a", "7a", "Capital gain or (loss)"],
  ["L8", "8", "Additional income (Sched. 1)"],
  ["L9", "9", "Total income"],
  ["L10", "10", "Adjustments to income (Sched. 1)"],
  ["L11a", "11a", "Adjusted gross income"],
  ["L12e", "12e", "Standard or itemized deduction"],
  ["L12f", "12f", "Charitable deduction for non-itemizers"],
  ["L13a", "13a", "Schedule 1-A deductions"],
  ["L13b", "13b", "Qualified business income deduction"],
  ["L14", "14", "Total deductions"],
  ["L15", "15", "Taxable income"],
  ["L16", "16", "Tax"],
  ["L17", "17", "Sched. 2 Part I (excess advance PTC)"],
  ["L19", "19", "Child tax credit / credit for other dependents"],
  ["L20", "20", "Other nonrefundable credits (Sched. 3)"],
  ["L22", "22", "Tax after credits"],
  ["L23", "23", "Other taxes incl. SE tax (Sched. 2)"],
  ["L24", "24c", "Total tax"],
  ["L25d", "25d", "Federal income tax withheld"],
  ["L26", "26", "Estimated tax payments"],
  ["L27a", "27a", "Earned income credit"],
  ["L28", "28", "Additional child tax credit"],
  ["L29", "29", "American opportunity credit (refundable)"],
  ["L31", "31", "Other refundable credits (Sched. 3)"],
  ["L33", "33", "Total payments"],
  ["L34", "34", "Overpayment"],
  ["L35a", "35a", "Refund"],
  ["L36", "36", "Applied to 2027 estimated tax"],
  ["L37", "37", "Amount you owe"],
] as const;
export type LineKey = (typeof LINES)[number][0];
export const LINE_KEYS: LineKey[] = LINES.map((l) => l[0]);
export const LINE_INFO: Record<LineKey, { n: string; label: string }> = Object.fromEntries(LINES.map(([k, n, label]) => [k, { n, label }])) as Record<LineKey, { n: string; label: string }>;
export type Lines = Record<LineKey, number>;

/** Lines checked by default on a new answer key. */
export const DEFAULT_CHECKS: LineKey[] = ["L9", "L11a", "L12e", "L12f", "L13b", "L15", "L16", "L19", "L23", "L24", "L27a", "L28", "L33", "L34", "L37"];

export function n(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v == null || typeof v === "boolean") return 0;
  const x = parseFloat(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(x) ? x : 0;
}
const r = (x: number) => Math.round(x);

export function fmt(v: unknown): string {
  const x = Math.round(n(v));
  return (x < 0 ? "-" : "") + "$" + Math.abs(x).toLocaleString("en-US");
}

function sched(fs: FilingStatus) {
  return BR[fs === "qss" ? "mfj" : fs];
}
function rateTax(x: number, fs: FilingStatus): number {
  let t = 0;
  let lo = 0;
  for (const [hi, rt] of sched(fs)) {
    if (x > lo) t += (Math.min(x, hi) - lo) * rt;
    if (x <= hi) break;
    lo = hi;
  }
  return t;
}

/** Tax table below $100,000 (row midpoint), Tax Computation Worksheet at or above. */
export function tax(ti: number, fs: FilingStatus): number {
  if (ti < 5) return 0;
  if (ti >= 100000) return r(rateTax(ti, fs));
  let mid: number;
  if (ti < 15) mid = 10;
  else if (ti < 25) mid = 20;
  else if (ti < 3000) mid = Math.floor(ti / 25) * 25 + 12.5;
  else mid = Math.floor(ti / 50) * 50 + 25;
  return r(rateTax(mid, fs));
}

/** Qualified Dividends and Capital Gain Tax Worksheet (lines numbered as on the worksheet). */
export function qdcgTax(L1: number, qd: number, ncg: number, fs: FilingStatus): number {
  const th = CG[fs];
  const L4 = qd + ncg;
  const L5 = Math.max(0, L1 - L4);
  const L7 = Math.min(L1, th[0]);
  const L8 = Math.min(L5, L7);
  const L9 = L7 - L8;
  const L10 = Math.min(L1, L4);
  const L12 = L10 - L9;
  const L14 = Math.min(L1, th[1]);
  const L16 = Math.max(0, L14 - (L5 + L9));
  const L17 = Math.min(L12, L16);
  const L20 = L10 - (L9 + L17);
  const L23 = L17 * 0.15 + L20 * 0.2 + tax(L5, fs);
  return r(Math.min(L23, tax(L1, fs)));
}

/** EIC table amount: the row midpoint ($50 rows) run through the credit formula. */
export function eicAmt(x: number, kids: number, mfj: boolean): number {
  if (x < 1) return 0;
  const p = EIC[Math.min(kids, 3)];
  const mid = Math.floor(x / 50) * 50 + 25;
  const thr = mfj ? p[5] : p[4];
  return Math.max(0, r(Math.min(p[1], p[2] * mid) - p[3] * Math.max(0, mid - thr)));
}

const person = (): Person => ({ first: "", mi: "", last: "", ssn: "", age: "", a65: false, blind: false, occupation: "", phone: "", email: "", citizen: "" });

export function blankReturn(): TaxReturn {
  return {
    fs: "single", mfsLivedWith: false, tp: person(), sp: person(), addr: { street: "", city: "", state: "", zip: "" },
    deps: [], w2: [], int: [], div: [], g: [], r: [], ssa: [], schc: [], capg: [],
    other: { staterefund: "", desc: "", amt: "" },
    adj: { educator: "", hsa: "", seHealth: "", ira: "", sli: "", other: "" },
    ded: { type: "std", item: "", med: "", saltIncome: "", saltRE: "", saltPP: "", mortInt: "", charCash: "", charNon: "", otherItem: "", charStd: "", tips: "", overtime: "", carint: "", other1a: "" },
    cred: { dcExp: "", dcPersons: "", ed: [], nonref: "", ref: "" },
    health: { covered: "yes", ptcNet: "", aptcRepay: "" },
    pay: { est: "", prior: "", applyNext: "" },
    efile: { method: "dd", routing: "", account: "", acctType: "checking", pin: "", spPin: "", consent: false },
  };
}

const LIST_KEYS = ["deps", "w2", "int", "div", "g", "r", "ssa", "schc", "capg"] as const;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Fills in any missing fields so saved drafts from older versions (and anything a browser sends) always have the
 * full shape. Unknown keys are dropped; nothing here trusts the input's types beyond plain JSON.
 */
export function normalizeReturn(input: unknown): TaxReturn {
  const b = blankReturn();
  if (!isObj(input)) return b;
  const out = b as unknown as Record<string, unknown>;
  for (const key of Object.keys(b)) {
    const v = input[key];
    if (v == null) continue;
    const base = out[key];
    if (Array.isArray(base)) out[key] = Array.isArray(v) ? v.filter(isObj).slice(0, 50) : [];
    else if (isObj(base)) {
      if (!isObj(v)) continue;
      const merged: Record<string, unknown> = { ...base };
      for (const k of Object.keys(base)) if (v[k] != null) merged[k] = Array.isArray(base[k]) ? (Array.isArray(v[k]) ? (v[k] as unknown[]).filter(isObj).slice(0, 20) : []) : v[k];
      out[key] = merged;
    } else if (typeof v === typeof base) out[key] = v;
  }
  if (!(b.fs in STD)) b.fs = "single";
  for (const k of LIST_KEYS) if (!Array.isArray(b[k])) (b as unknown as Record<string, unknown>)[k] = [];
  return b;
}

export type Computed = {
  lines: Lines;
  notes: string[];
  d: {
    wages: number; interest: number; exemptInt: number; ordDiv: number; qualDiv: number; capDist: number; unemp: number; ssBen: number;
    st: number; lt: number; netCap: number; biz: { who: Who; gross: number; exp: number; net: number }[]; schcNet: number; seTax: number;
    halfSE: number; addl: number; sli: number; std: number; itemized: number; charItem: number; medAllowed: number; salt: number;
    senior: number; kids: number; others: number; credit: number; earned: number; dc: number; aotc: number; llc: number;
    eicKids: number; eicWhy: string; invInc: number;
  };
};

export function compute(input: unknown): Computed {
  const R = normalizeReturn(input);
  const fs = R.fs;
  const mfj = fs === "mfj";
  const mfs = fs === "mfs";
  const notes: string[] = [];
  const sum = <T,>(a: T[], f: (x: T) => unknown) => a.reduce((s, x) => s + r(n(f(x))), 0);
  const by = <T extends { who?: Who }>(a: T[], who: Who) => a.filter((x) => (who === "sp" ? x.who === "sp" : x.who !== "sp"));

  const wages = sum(R.w2, (x) => x.wages);
  const wagesBy = { tp: sum(by(R.w2, "tp"), (x) => x.wages), sp: sum(by(R.w2, "sp"), (x) => x.wages) };
  const interest = sum(R.int, (x) => x.amt);
  const exemptInt = sum(R.int, (x) => x.exempt);
  const ordDiv = sum(R.div, (x) => x.ord);
  const qualDiv = sum(R.div, (x) => x.qual);
  const capDist = sum(R.div, (x) => x.capd);
  if (qualDiv > ordDiv) notes.push("Qualified dividends (box 1b) cannot be more than ordinary dividends (box 1a).");
  const unemp = sum(R.g, (x) => x.unemp);
  let iraT = 0;
  let penT = 0;
  let early = 0;
  for (const x of R.r) {
    const tx = r(n(x.taxable === "" || x.taxable == null ? x.gross : x.taxable));
    if (x.ira) iraT += tx;
    else penT += tx;
    if (String(x.code ?? "").trim() === "1") early += tx;
  }
  const ssBen = sum(R.ssa, (x) => x.net);

  const st = sum(R.capg, (x) => x.st);
  const lt = sum(R.capg, (x) => x.lt) + capDist;
  const netCap = st + lt;
  const lossCap = mfs ? -1500 : -3000;
  const L7a = netCap >= 0 ? netCap : Math.max(netCap, lossCap);
  if (netCap < lossCap) notes.push(`Capital loss limited to ${mfs ? "$1,500" : "$3,000"}; the rest carries over to 2027.`);
  const ncg = Math.max(0, Math.min(lt, netCap));

  const biz = R.schc.map((b) => {
    const gross = r(n(b.receipts));
    const exp = EXPENSE_KEYS.reduce((s, k) => s + r(n(b[k])), 0);
    return { who: (b.who === "sp" ? "sp" : "tp") as Who, gross, exp, net: gross - exp };
  });
  const schcNet = biz.reduce((s, b) => s + b.net, 0);
  let seTax = 0;
  let halfSE = 0;
  const se = { tp: 0, sp: 0 };
  const seNet = { tp: 0, sp: 0 };
  for (const who of ["tp", "sp"] as Who[]) {
    const net = biz.filter((b) => b.who === who).reduce((s, b) => s + b.net, 0);
    seNet[who] = net;
    if (net <= 0) continue;
    const base = r(net * 0.9235);
    if (base < 400) continue;
    const t = r(Math.min(base, Math.max(0, SS_BASE - wagesBy[who])) * 0.124) + r(base * 0.029);
    se[who] = t;
    seTax += t;
    halfSE += r(t * 0.5);
  }

  const L1z = wages;
  const L2b = interest;
  const L3b = ordDiv;
  const L4b = iraT;
  const L5b = penT;
  const L8 = r(n(R.other.staterefund)) + schcNet + unemp + r(n(R.other.amt));

  const educator = Math.min(r(n(R.adj.educator)), mfj ? 600 : 300);
  const seHealth = r(n(R.adj.seHealth));
  const adjNoSli = educator + r(n(R.adj.hsa)) + halfSE + seHealth + r(n(R.adj.ira)) + r(n(R.adj.other));

  // Social Security Benefits Worksheet.
  let L6b = 0;
  if (ssBen > 0) {
    const w2 = r(ssBen * 0.5);
    const w7 = Math.max(0, w2 + L1z + L2b + L3b + L4b + L5b + L7a + L8 + exemptInt - adjNoSli);
    if (mfs && R.mfsLivedWith) L6b = r(Math.min(w7 * 0.85, ssBen * 0.85));
    else {
      const w9 = w7 - (mfj ? 32000 : 25000);
      if (w9 > 0) {
        const base2 = mfj ? 12000 : 9000;
        const w11 = Math.max(0, w9 - base2);
        const w14 = Math.min(w2, r(Math.min(w9, base2) / 2));
        L6b = r(Math.min(w14 + w11 * 0.85, ssBen * 0.85));
      }
    }
  }
  const L9 = L1z + L2b + L3b + L4b + L5b + L6b + L7a + L8;

  const sliIn = r(n(R.adj.sli));
  let sli = Math.min(2500, sliIn);
  if (sliIn > 2500) notes.push("Student loan interest is capped at $2,500.");
  if (sli > 0) {
    if (mfs) {
      sli = 0;
      notes.push("Student loan interest is not deductible when married filing separately.");
    } else {
      const magi = L9 - adjNoSli;
      const lo = mfj ? 175000 : 85000;
      const span = mfj ? 30000 : 15000;
      if (magi > lo) {
        sli -= magi >= lo + span ? sli : r((sli * (magi - lo)) / span);
        notes.push("Student loan interest reduced by the income phaseout.");
      }
    }
  }
  const L10 = adjNoSli + sli;
  const L11a = L9 - L10;

  const cnt = (R.tp.a65 ? 1 : 0) + (R.tp.blind ? 1 : 0) + (mfj ? (R.sp.a65 ? 1 : 0) + (R.sp.blind ? 1 : 0) : 0);
  const std = STD[fs] + ADD[fs] * cnt;
  // Schedule A.
  const medAllowed = Math.max(0, r(n(R.ded.med)) - r(L11a * 0.075));
  const saltPaid = r(n(R.ded.saltIncome)) + r(n(R.ded.saltRE)) + r(n(R.ded.saltPP));
  const saltCap = Math.max(mfs ? 5000 : 10000, (mfs ? 20200 : 40400) - r(Math.max(0, L11a - (mfs ? 252500 : 505000)) * 0.3));
  const salt = Math.min(saltPaid, saltCap);
  const charItem = Math.max(0, r(n(R.ded.charCash)) + r(n(R.ded.charNon)) - r(L11a * 0.005));
  const detail = medAllowed + salt + r(n(R.ded.mortInt)) + charItem + r(n(R.ded.otherItem));
  const itemized = detail > 0 ? detail : r(n(R.ded.item));
  let L12e: number;
  if (R.ded.type === "item") {
    L12e = itemized;
    if (L11a > (mfj || fs === "qss" ? 768700 : mfs ? 384350 : 640600)) notes.push("The 2026 limit on itemized deductions for the 37% bracket is not modeled.");
    if (itemized < std) notes.push(`Itemized deductions (${fmt(itemized)}) are less than the ${fmt(std)} standard deduction.`);
    if (saltPaid > saltCap) notes.push(`State and local taxes limited to ${fmt(saltCap)}.`);
  } else L12e = std;
  // 2026: cash gifts to charity for non-itemizers, up to $1,000 ($2,000 MFJ).
  const L12f = R.ded.type === "item" ? 0 : Math.min(r(n(R.ded.charStd)), mfj ? 2000 : 1000);

  // Schedule 1-A.
  const seniors = mfs ? 0 : (R.tp.a65 ? 1 : 0) + (mfj && R.sp.a65 ? 1 : 0);
  const senior = seniors ? Math.max(0, 6000 - r(Math.max(0, L11a - (mfj ? 150000 : 75000)) * 0.06)) * seniors : 0;
  const tipsIn = r(n(R.ded.tips));
  const otIn = r(n(R.ded.overtime));
  let tips = 0;
  let ot = 0;
  if (mfs && (tipsIn || otIn)) notes.push("Tips and overtime deductions require a joint return if married.");
  else {
    const red100 = Math.floor(Math.max(0, L11a - (mfj ? 300000 : 150000)) / 1000) * 100;
    tips = Math.max(0, Math.min(tipsIn, 25000) - red100);
    ot = Math.max(0, Math.min(otIn, mfj ? 25000 : 12500) - red100);
  }
  const car = Math.max(0, Math.min(r(n(R.ded.carint)), 10000) - Math.floor(Math.max(0, L11a - (mfj ? 200000 : 100000)) / 1000) * 200);
  const L13a = senior + tips + ot + car + r(n(R.ded.other1a));

  const tiBefore = Math.max(0, L11a - L12e - L12f - L13a);
  const qbiInc = schcNet - halfSE - seHealth;
  let L13b = 0;
  if (qbiInc > 0) {
    L13b = r(Math.min(0.2 * qbiInc, 0.2 * Math.max(0, tiBefore - (ncg + qualDiv))));
    // 2026 minimum deduction: $400 when active QBI is at least $1,000 (assumes material participation).
    if (qbiInc >= 1000 && L13b < 400) L13b = Math.min(400, tiBefore);
    if (tiBefore > QBI_T[fs]) notes.push("Taxable income is above the QBI threshold. This engine uses the simple 20% method only.");
  } else if (schcNet < 0) notes.push("Business loss: no QBI deduction this year (carryforward not modeled).");
  const L14 = L12e + L12f + L13a + L13b;
  const L15 = Math.max(0, L11a - L14);
  const L16 = qualDiv > 0 || ncg > 0 ? qdcgTax(L15, Math.min(qualDiv, ordDiv), ncg, fs) : tax(L15, fs);
  const L17 = r(n(R.health.aptcRepay));
  const L18 = L16 + L17;

  const earnBy = { tp: wagesBy.tp + seNet.tp - r(se.tp * 0.5), sp: wagesBy.sp + seNet.sp - r(se.sp * 0.5) };
  const earned = Math.max(0, wages + schcNet - halfSE);

  // Child and dependent care (Form 2441), 2026 rules: 50% rate phasing to 35%, then to 20%.
  let dc = 0;
  const dcP = r(n(R.cred.dcPersons));
  const dcExp = r(n(R.cred.dcExp));
  if (dcP > 0 && dcExp > 0) {
    if (mfs) notes.push("The dependent care credit is generally not allowed when married filing separately.");
    else {
      const ei = mfj ? Math.min(earnBy.tp, earnBy.sp) : earnBy.tp;
      const base = Math.max(0, Math.min(dcExp, dcP >= 2 ? 6000 : 3000, ei));
      let pct = L11a <= 15000 ? 50 : Math.max(35, 50 - Math.ceil((L11a - 15000) / 2000));
      const t2 = mfj ? 150000 : 75000;
      if (L11a > t2) pct = Math.max(20, pct - Math.ceil((L11a - t2) / (mfj ? 4000 : 2000)));
      dc = r((base * pct) / 100);
      if (mfj && ei <= 0) notes.push("Dependent care credit: both spouses need earned income (student/disabled rule not modeled).");
    }
  }
  // Education credits (Form 8863).
  let aotc = 0;
  let llcExp = 0;
  let L29 = 0;
  let aotcNon = 0;
  let llc = 0;
  if (R.cred.ed.length) {
    if (mfs) notes.push("Education credits are not allowed when married filing separately.");
    else {
      const lo2 = mfj ? 160000 : 80000;
      const hi2 = mfj ? 180000 : 90000;
      const f = L11a >= hi2 ? 0 : L11a <= lo2 ? 1 : Math.round(((hi2 - L11a) / (hi2 - lo2)) * 1000) / 1000;
      for (const s of R.cred.ed) {
        const e = r(n(s.exp));
        if (s.type === "llc") llcExp += e;
        else aotc += Math.min(e, 2000) + 0.25 * Math.max(0, Math.min(e, 4000) - 2000);
      }
      aotc = r(aotc * f);
      L29 = r(aotc * 0.4);
      aotcNon = aotc - L29;
      llc = r(Math.min(llcExp, 10000) * 0.2 * f);
    }
  }
  const L20 = Math.min(dc + aotcNon + llc + r(n(R.cred.nonref)), L18);

  // Child tax credit / credit for other dependents.
  const kids = R.deps.filter((d) => n(d.age) < 17 && d.ssn !== false).length;
  const others = R.deps.length - kids;
  const phaseAt = mfj ? 400000 : 200000;
  const phase = L11a > phaseAt ? Math.ceil((L11a - phaseAt) / 1000) * 50 : 0;
  const credit = Math.max(0, 2200 * kids + 500 * others - phase);
  if (fs === "hoh" && R.deps.length === 0) notes.push("Head of household needs a qualifying person. Check the dependents.");
  const L19 = Math.min(credit, L18 - L20);
  const L22 = L18 - L19 - L20;
  const addl = r(early * 0.1);
  if (addl) notes.push("10% additional tax on early distributions (code 1) assumes no exception applies.");
  const L23 = seTax + addl;
  const L24 = L22 + L23;

  const L25d = sum(R.w2, (x) => x.fedwh) + sum(R.int, (x) => x.fedwh) + sum(R.div, (x) => x.fedwh) + sum(R.g, (x) => x.fedwh) + sum(R.r, (x) => x.fedwh) + sum(R.ssa, (x) => x.fedwh);
  const L26 = r(n(R.pay.est)) + r(n(R.pay.prior));

  // Earned income credit.
  let L27a = 0;
  let eicWhy = "";
  const invInc = interest + exemptInt + ordDiv + Math.max(0, L7a);
  const eicKids = R.deps.filter((d) => {
    const a = n(d.age);
    return EIC_RELATIONSHIPS.includes(d.rel) && n(d.months) > 6 && d.ssn !== false && (a < 19 || (d.student && a < 24) || d.disabled);
  }).length;
  if (mfs) eicWhy = "Married filing separately: the separated-spouse exception is not modeled.";
  else if (earned <= 0) eicWhy = "No earned income.";
  else if (invInc > EIC_INV) eicWhy = "Investment income is over $12,200.";
  else {
    let ok = true;
    if (eicKids === 0) {
      const ages = [n(R.tp.age), ...(mfj ? [n(R.sp.age)] : [])];
      if (!R.tp.age) {
        ok = false;
        eicWhy = "Enter the taxpayer age on Basic Information to test eligibility without a qualifying child.";
      } else if (!ages.some((a) => a >= 25 && a <= 64)) {
        ok = false;
        eicWhy = "Without a qualifying child, the taxpayer (or spouse) must be 25 to 64.";
      }
    }
    if (ok) {
      const thr = EIC[Math.min(eicKids, 3)][mfj ? 5 : 4];
      L27a = eicAmt(earned, eicKids, mfj);
      if (L11a >= thr && L11a !== earned) L27a = Math.min(L27a, eicAmt(L11a, eicKids, mfj));
      if (!L27a) eicWhy = `Income is above the limit for ${eicKids} qualifying ${eicKids === 1 ? "child" : "children"}.`;
    }
  }

  let L28 = 0;
  if (kids > 0) {
    const unused = Math.min(credit - L19, 1700 * kids);
    const eiPart = earned > 2500 ? r((earned - 2500) * 0.15) : 0;
    L28 = Math.max(0, Math.min(unused, eiPart));
    if (kids >= 3 && unused > eiPart) notes.push("3+ children: the Schedule 8812 Part II-B alternative is not modeled.");
  }
  const L31 = r(n(R.health.ptcNet)) + r(n(R.cred.ref));
  const L33 = L25d + L26 + L27a + L28 + L29 + L31;
  const L34 = Math.max(0, L33 - L24);
  const L36 = Math.min(L34, Math.max(0, r(n(R.pay.applyNext))));
  const L35a = L34 - L36;
  const L37 = Math.max(0, L24 - L33);

  return {
    lines: { L1z, L2b, L3b, L4b, L5b, L6b, L7a, L8, L9, L10, L11a, L12e, L12f, L13a, L13b, L14, L15, L16, L17, L19, L20, L22, L23, L24, L25d, L26, L27a, L28, L29, L31, L33, L34, L35a, L36, L37 },
    notes,
    d: {
      wages, interest, exemptInt, ordDiv, qualDiv, capDist, unemp, ssBen, st, lt, netCap, biz, schcNet, seTax, halfSE, addl, sli, std, itemized, charItem,
      medAllowed, salt, senior, kids, others, credit, earned, dc, aotc, llc, eicKids, eicWhy, invInc,
    },
  };
}

export type Diagnostic = { level: "reject" | "warn"; where: string; msg: string };

function ssnOk(s: unknown): boolean {
  const d = String(s ?? "").replace(/\D/g, "");
  return d.length === 9 && !/^(000|9|666)/.test(d) && d.slice(3, 5) !== "00" && d.slice(5) !== "0000";
}

/** E-file style diagnostics: rejects (must fix before "transmitting") and warnings. */
export function diagnostics(input: unknown): Diagnostic[] {
  const R = normalizeReturn(input);
  const c = compute(R);
  const out: Diagnostic[] = [];
  const rej = (where: string, msg: string) => out.push({ level: "reject", where, msg });
  const warn = (where: string, msg: string) => out.push({ level: "warn", where, msg });
  if (!R.tp.first || !R.tp.last) rej("Taxpayer information", "Taxpayer first and last name are required.");
  if (!ssnOk(R.tp.ssn)) rej("Taxpayer information", "Taxpayer SSN must be 9 valid digits.");
  if (R.fs === "mfj" || R.fs === "mfs") {
    if (!R.sp.first || !R.sp.last) rej("Spouse information", "Spouse first and last name are required for this filing status.");
    if (!ssnOk(R.sp.ssn)) rej("Spouse information", "Spouse SSN must be 9 valid digits.");
  }
  if (!R.tp.citizen) warn("Taxpayer information", "Answer the 2026 question on U.S. citizenship or work authorization.");
  if (R.fs === "mfj" && !R.sp.citizen) warn("Spouse information", "Answer the 2026 citizenship or work authorization question for the spouse.");
  if (!R.addr.street || !R.addr.city || !R.addr.state || !/^\d{5}(-\d{4})?$/.test(R.addr.zip || "")) rej("Address & contact", "A complete mailing address with a 5-digit ZIP is required.");
  R.deps.forEach((d, i) => {
    const nm = d.name || `Dependent ${i + 1}`;
    if (!d.name) rej("Dependents", `Dependent ${i + 1} needs a name.`);
    if (d.ssn !== false && !ssnOk(d.ssnNum)) rej("Dependents", `${nm}: enter a valid 9-digit SSN, or uncheck "Has a valid SSN".`);
    if (EIC_RELATIONSHIPS.includes(d.rel) && n(d.months) < 7 && n(d.age) < 19) warn("Dependents", `${nm} lived with the taxpayer under 7 months. Confirm the dependency tests.`);
  });
  if (R.fs === "hoh" && !R.deps.length) rej("Filing status", "Head of household requires a qualifying person.");
  if (R.fs === "qss" && !R.deps.length) rej("Filing status", "Qualifying surviving spouse requires a dependent child.");
  R.w2.forEach((w, i) => {
    if (!w.employer) rej("Form W-2", `W-2 ${i + 1}: employer name is required.`);
    if (!/^\d{2}-?\d{7}$/.test(String(w.ein ?? ""))) rej("Form W-2", `W-2 ${i + 1}: employer EIN must be 9 digits (XX-XXXXXXX).`);
    if (n(w.fedwh) > n(w.wages)) warn("Form W-2", `W-2 ${i + 1}: withholding is more than wages.`);
  });
  R.r.forEach((x, i) => {
    if (!x.code) warn("1099-R", `1099-R ${i + 1}: enter the box 7 distribution code.`);
  });
  for (const m of c.notes) warn("Calculation", m);
  if (R.efile.method === "dd" && c.lines.L35a > 0) {
    if (!/^\d{9}$/.test(String(R.efile.routing ?? ""))) rej("Refund", "Routing number must be 9 digits.");
    if (!/^\d{4,17}$/.test(String(R.efile.account ?? ""))) rej("Refund", "Account number must be 4 to 17 digits.");
  }
  if (!/^\d{5}$/.test(String(R.efile.pin ?? "")) || R.efile.pin === "00000") rej("Signature", "Taxpayer self-select PIN must be 5 digits, not all zeros.");
  if (R.fs === "mfj" && (!/^\d{5}$/.test(String(R.efile.spPin ?? "")) || R.efile.spPin === "00000")) rej("Signature", "Spouse self-select PIN must be 5 digits, not all zeros.");
  if (!R.efile.consent) rej("Signature", "The taxpayer has not signed the e-file authorization (Form 8879).");
  return out;
}

export function rejectCount(input: unknown): number {
  return diagnostics(input).filter((d) => d.level === "reject").length;
}
