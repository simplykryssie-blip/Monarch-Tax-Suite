// The intake and interview sheet students fill in (on screen, or by hand from the printed packet). Shared by the
// practice page, the instructor review and the PDF packet so all three always show the same questions.

export type IntakeSection = { sec: string; checks?: [string, string][]; fields?: [string, string, "line" | "area"][] };

export const INTAKE: IntakeSection[] = [
  { sec: "About the taxpayer", fields: [["who", "Names, ages and occupations (taxpayer and spouse)", "area"], ["marital", "Marital status on December 31, 2026", "line"], ["contact", "Address, phone and email", "area"]] },
  { sec: "Household", fields: [["household", "Everyone who lived in the home in 2026: name, relationship, age, months in the home, student or disabled, who paid most of their support", "area"]] },
  {
    sec: "Income received in 2026",
    checks: [["inc_w2", "Wages (Form W-2)"], ["inc_tips", "Tips not on a W-2"], ["inc_se", "Self-employment, gig or cash income (1099-NEC, 1099-K)"], ["inc_int", "Interest or dividends (1099-INT, 1099-DIV)"], ["inc_unemp", "Unemployment (1099-G)"], ["inc_ret", "Pension, annuity or IRA distributions (1099-R)"], ["inc_ssa", "Social Security (SSA-1099)"], ["inc_sales", "Sold stocks, crypto or property"], ["inc_rent", "Rental income"], ["inc_gamb", "Gambling winnings (W-2G)"], ["inc_other", "Other income"]],
    fields: [["inc_notes", "Income details and amounts", "area"]],
  },
  {
    sec: "Expenses and deductions",
    checks: [["exp_care", "Child or dependent care"], ["exp_edu", "College tuition (1098-T)"], ["exp_sli", "Student loan interest (1098-E)"], ["exp_home", "Mortgage interest or property tax (1098)"], ["exp_char", "Charitable donations"], ["exp_med", "Large medical expenses"], ["exp_ret", "IRA or retirement contributions"], ["exp_hsa", "HSA contributions (5498-SA)"], ["exp_teach", "Teacher classroom expenses"], ["exp_est", "Estimated tax payments"], ["exp_biz", "Business expenses"]],
    fields: [["exp_notes", "Expense details and amounts", "area"]],
  },
  {
    sec: "Health coverage and life events",
    checks: [["hc_cover", "Everyone had health coverage all year"], ["hc_1095a", "Marketplace insurance (1095-A)"], ["life_baby", "Had or adopted a child"], ["life_marry", "Married, divorced or separated"], ["life_move", "Moved"], ["life_home", "Bought or sold a home"], ["life_irs", "Received a letter from the IRS"]],
    fields: [["life_notes", "Details", "area"]],
  },
  { sec: "Refund and follow-up", fields: [["refund", "Refund preference and bank details collected", "line"], ["followup", "Missing documents and follow-up questions", "area"]] },
];

/** The filled-in sheet as label/value rows (for review screens and the PDF). */
export function intakeRows(intake: Record<string, string | boolean> | null | undefined): [string, string][] {
  const I = intake ?? {};
  const rows: [string, string][] = [];
  for (const s of INTAKE) {
    const yes = (s.checks ?? []).filter(([k]) => I[k] === true).map(([, label]) => label);
    if (yes.length) rows.push([`${s.sec}: yes`, yes.join("; ")]);
    for (const [k, label] of s.fields ?? []) {
      const v = I[k];
      if (typeof v === "string" && v.trim()) rows.push([label, v]);
    }
  }
  return rows;
}
