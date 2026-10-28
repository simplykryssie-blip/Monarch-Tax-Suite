import type { SourceDocs } from "./types.ts";

// Practice copies of the client's documents as plain box data: [form, subtitle, boxes]. Rendered on screen
// (components/lab/client-file.tsx) and in the PDF packet (lib/lab/pdf.ts) from the same data.

export type DocBox = { label: string; value: string; wide?: boolean };
export type PracticeForm = { title: string; subtitle: string; boxes: DocBox[] };

const cents = (v: unknown) => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return (Number.isFinite(x) ? Math.round(x * 100) / 100 : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const wide = (label: string, value: string): DocBox => ({ label, value: value || "—", wide: true });
const amt = (label: string, value: unknown): DocBox => ({ label, value: cents(value) });

export function practiceForms(src: SourceDocs | null | undefined): PracticeForm[] {
  const s = src ?? {};
  const out: PracticeForm[] = [];
  for (const w of s.w2 ?? []) {
    out.push({ title: "Form W-2", subtitle: "Wage and Tax Statement 2026", boxes: [
      wide("a Employee's social security number", w.ssn), wide("b Employer identification number (EIN)", w.ein), wide("c Employer's name", w.employer), wide("e Employee's name", w.employee),
      amt("1 Wages, tips, other compensation", w.wages), amt("2 Federal income tax withheld", w.fedwh),
      amt("3 Social security wages", w.wages), amt("4 Social security tax withheld", w.wages * 0.062),
      amt("5 Medicare wages and tips", w.wages), amt("6 Medicare tax withheld", w.wages * 0.0145),
    ] });
  }
  for (const x of s.int ?? []) out.push({ title: "Form 1099-INT", subtitle: "Interest Income 2026", boxes: [wide("Payer's name", x.payer), wide("Recipient's name", x.recipient), amt("1 Interest income", x.amt), amt("4 Federal income tax withheld", x.fedwh), amt("8 Tax-exempt interest", x.exempt)] });
  for (const x of s.div ?? []) out.push({ title: "Form 1099-DIV", subtitle: "Dividends and Distributions 2026", boxes: [wide("Payer's name", x.payer), wide("Recipient's name", x.recipient), amt("1a Total ordinary dividends", x.ord), amt("1b Qualified dividends", x.qual), amt("2a Total capital gain distr.", x.capd), amt("4 Federal income tax withheld", x.fedwh)] });
  for (const x of s.g ?? []) out.push({ title: "Form 1099-G", subtitle: "Certain Government Payments 2026", boxes: [wide("Payer's name", x.payer), wide("Recipient's name", x.recipient), amt("1 Unemployment compensation", x.unemp), amt("4 Federal income tax withheld", x.fedwh)] });
  for (const x of s.r ?? []) out.push({ title: "Form 1099-R", subtitle: "Distributions From Pensions, Annuities, IRAs 2026", boxes: [
    wide("Payer's name", x.payer), wide("Recipient's name", x.recipient), amt("1 Gross distribution", x.gross),
    { label: "2a Taxable amount", value: x.taxable === null ? "" : cents(x.taxable) }, amt("4 Federal income tax withheld", x.fedwh),
    { label: "7 Distribution code(s) · IRA/SEP/SIMPLE", value: `${x.code || ""}   ${x.ira ? "[X]" : "[ ]"}` },
  ] });
  for (const x of s.ssa ?? []) out.push({ title: "Form SSA-1099", subtitle: "Social Security Benefit Statement 2026", boxes: [wide("Beneficiary", x.recipient), amt("5 Net benefits for 2026", x.net), amt("6 Voluntary federal income tax withheld", x.fedwh)] });
  for (const x of s.nec ?? []) out.push({ title: "Form 1099-NEC", subtitle: "Nonemployee Compensation 2026", boxes: [wide("Payer's name", x.payer), wide("Recipient's name", x.recipient), amt("1 Nonemployee compensation", x.amt), amt("4 Federal income tax withheld", 0)] });
  return out;
}
