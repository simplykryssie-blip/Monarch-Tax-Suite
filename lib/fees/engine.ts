import type { Applies, Charge, FeeLine, Receipt, ReturnFee, TaxReturn } from "./types.ts";

// The fee math. Pure functions only: which lines apply to a return, what each return owes, and the statement totals.
// Amounts are whole cents throughout.

/**
 * Monarch's own pricing, offered as a starting template a bureau can load into an empty schedule and then edit.
 * Nothing in the math reads it: every charge comes from the tenant's saved schedule.
 */
export const MONARCH_TEMPLATE: { label: string; amount_cents: number; applies: Applies }[] = [
  { label: "Service bureau fee", amount_cents: 7900, applies: "every_return" },
  { label: "Transmission fee", amount_cents: 2100, applies: "every_return" },
  { label: "Technology fee", amount_cents: 2400, applies: "every_return" },
  { label: "E-file fee", amount_cents: 9900, applies: "every_return" },
];

/** "$1,250.50", "79", " 21.5 " → cents. Negative or malformed amounts are null. */
export function parseMoney(raw: string | null | undefined): number | null {
  const v = (raw ?? "").replace(/[\s$,]/g, "");
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(v)) return null;
  const [whole, frac = ""] = v.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export const dollars = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

/** A stable line code from its label (and bank), so an office override can name the default line it replaces. */
export function codeFor(label: string, bankOptionId: string | null = null): string {
  const slug = label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "fee";
  return bankOptionId ? `${slug}:${bankOptionId.slice(0, 8)}` : slug;
}

/**
 * The lines that apply to an office: the bureau's default schedule with the office's override on top. An override
 * line replaces the default line with the same code; override lines with new codes are added.
 */
export function effectiveLines(defaults: FeeLine[], overrides: FeeLine[]): FeeLine[] {
  const byCode = new Map<string, FeeLine>();
  for (const l of [...defaults].sort(order)) byCode.set(l.code, l);
  for (const l of [...overrides].sort(order)) byCode.set(l.code, l);
  return [...byCode.values()].sort(order);
}
const order = (a: FeeLine, b: FeeLine) => a.sort_order - b.sort_order || a.label.localeCompare(b.label);

/**
 * What a return is charged. Every-return lines always; bank-product lines only when the return used a bank product,
 * and a line for a specific bank only for that bank.
 */
export function chargesFor(ret: Pick<TaxReturn, "bank_option_id">, lines: FeeLine[]): Charge[] {
  return lines
    .filter((l) => l.applies === "every_return" || (ret.bank_option_id !== null && (l.bank_option_id === null || l.bank_option_id === ret.bank_option_id)))
    .filter((l) => l.amount_cents > 0)
    .map((l) => ({ code: l.code, label: l.label, amount_cents: l.amount_cents, applies: l.applies, schedule_id: l.schedule_id, sort_order: l.sort_order }));
}

export type ReturnStatus = "paid" | "partly_paid" | "awaiting_funding" | "owed_by_ero" | "no_fees";
export const STATUS_LABEL: Record<ReturnStatus, string> = {
  paid: "Paid",
  partly_paid: "Partly paid",
  awaiting_funding: "Awaiting bank funding",
  owed_by_ero: "Owed by ERO",
  no_fees: "No fees",
};

export type ReturnLine = {
  ret: TaxReturn;
  fees: ReturnFee[];
  receipts: Receipt[];
  owed: number;
  collected: number;
  balance: number;
  status: ReturnStatus;
};

/** One return's position: what it owes, what's been collected (bank or ERO payments), and where it stands. */
export function returnLine(ret: TaxReturn, fees: ReturnFee[], receipts: Receipt[]): ReturnLine {
  const owed = fees.reduce((s, f) => s + f.amount_cents, 0);
  const collected = receipts.reduce((s, r) => s + r.collected_cents, 0);
  const balance = owed - collected;
  const status: ReturnStatus = owed === 0 ? "no_fees" : balance <= 0 ? "paid" : collected > 0 ? "partly_paid" : ret.bank_option_id ? "awaiting_funding" : "owed_by_ero";
  return { ret, fees, receipts, owed, collected, balance, status };
}

export type Period = { taxYear: number; month: number | null };

/** The date a return counts on for a monthly statement: when it was filed, otherwise when it was recorded. */
export const returnDate = (r: Pick<TaxReturn, "filed_on" | "created_at">) => (r.filed_on ?? r.created_at.slice(0, 10));

export function inPeriod(r: TaxReturn, p: Period): boolean {
  if (r.tax_year !== p.taxYear || r.archived_at) return false;
  if (p.month === null) return true;
  return Number(returnDate(r).slice(5, 7)) === p.month;
}

export type Statement = {
  period: Period;
  lines: ReturnLine[];
  totals: { returns: number; owed: number; collected: number; balance: number; bankReturns: number; owedByEro: number };
  byFee: { code: string; label: string; count: number; amount: number }[];
  payments: { date: string | null; kind: Receipt["kind"]; amount: number; ref: string; reference: string | null }[];
};

/** A statement for one office and period, built from its returns, their fees and the money received against them. */
export function buildStatement(period: Period, returns: TaxReturn[], fees: ReturnFee[], receipts: Receipt[]): Statement {
  const rs = returns.filter((r) => inPeriod(r, period)).sort((a, b) => returnDate(a).localeCompare(returnDate(b)) || a.return_ref.localeCompare(b.return_ref));
  const lines = rs.map((r) => returnLine(r, fees.filter((f) => f.return_id === r.id), receipts.filter((x) => x.return_id === r.id)));
  const byFee = new Map<string, { code: string; label: string; count: number; amount: number; order: number }>();
  for (const l of lines) for (const f of l.fees) {
    const cur = byFee.get(f.code) ?? { code: f.code, label: f.label, count: 0, amount: 0, order: f.sort_order };
    cur.count += 1;
    cur.amount += f.amount_cents;
    byFee.set(f.code, cur);
  }
  const payments = lines.flatMap((l) => l.receipts.map((x) => ({ date: x.received_on ?? x.created_at.slice(0, 10), kind: x.kind, amount: x.collected_cents, ref: l.ret.return_ref, reference: x.reference })))
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const sum = (f: (l: ReturnLine) => number) => lines.reduce((s, l) => s + f(l), 0);
  return {
    period,
    lines,
    totals: {
      returns: lines.length,
      owed: sum((l) => l.owed),
      collected: sum((l) => l.collected),
      balance: sum((l) => l.balance),
      bankReturns: lines.filter((l) => l.ret.bank_option_id).length,
      owedByEro: sum((l) => (l.ret.bank_option_id ? 0 : Math.max(l.balance, 0))),
    },
    byFee: [...byFee.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label)).map((f) => ({ code: f.code, label: f.label, count: f.count, amount: f.amount })),
    payments,
  };
}

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const periodLabel = (p: Period) => (p.month ? `${MONTHS[p.month - 1]} — tax year ${p.taxYear}` : `Season — tax year ${p.taxYear}`);

/** The tax year being filed now: the previous calendar year. */
export const defaultTaxYear = (now: Date = new Date()) => now.getUTCFullYear() - 1;
/** A ?year= value as a tax year, or the default. */
export const yearParam = (raw: string | undefined, now: Date = new Date()) => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : defaultTaxYear(now);
};
