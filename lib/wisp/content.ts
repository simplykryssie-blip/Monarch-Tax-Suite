// The WISP Generator's content and rules, ported from the owner's static build (wisp-generator-source): the 12-question
// audit in 4 weighted categories, the optional ERO profiling questions, 0–100 scoring, the fee comparison, and the
// 6-step builder with its fields. Pure, so the page, the server and the tests share one definition.

export const CATEGORIES = {
  access: { name: "Access Controls", weight: 30 },
  physical: { name: "Physical Security", weight: 20 },
  data: { name: "Data Protection", weight: 30 },
  incident: { name: "Incident Response", weight: 20 },
} as const;
export type Category = keyof typeof CATEGORIES;
export const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[];

export const QUESTIONS: { cat: Category; q: string; answers: [string, string, string] }[] = [
  { cat: "access", q: "Do you require unique usernames and strong passwords for everyone who accesses taxpayer data?", answers: ["Yes, enforced for all users", "Yes, but not consistently enforced", "No"] },
  { cat: "access", q: "Is multi-factor authentication (MFA) enabled on all systems containing taxpayer information?", answers: ["Yes, on all systems", "On some systems", "No"] },
  { cat: "access", q: "Do you limit access to taxpayer data to only the employees who need it for their job?", answers: ["Yes, role-based access", "Partially", "No — everyone can access everything"] },
  { cat: "physical", q: "Are physical documents containing taxpayer information stored in locked cabinets or rooms?", answers: ["Yes, always locked", "Sometimes", "No"] },
  { cat: "physical", q: "Do you have a clean-desk policy so taxpayer documents are never left out unattended?", answers: ["Yes, enforced", "Informal / inconsistent", "No"] },
  { cat: "physical", q: "Are workstations set to auto-lock after a short period of inactivity?", answers: ["Yes, 15 minutes or less", "Yes, but longer than 15 min", "No"] },
  { cat: "data", q: "Is taxpayer data encrypted both in transit and at rest?", answers: ["Yes, both", "Only one of the two", "No / not sure"] },
  { cat: "data", q: "Do you perform regular, tested backups of taxpayer data stored offsite or in the cloud?", answers: ["Yes, tested regularly", "Backups exist but untested", "No regular backups"] },
  { cat: "data", q: "Do you have a documented process for securely disposing of taxpayer data you no longer need?", answers: ["Yes, documented", "Informal", "No"] },
  { cat: "incident", q: "Do you have a written incident response plan for a data breach or suspected breach?", answers: ["Yes, written and reviewed", "Informal / in my head", "No"] },
  { cat: "incident", q: "Have all staff been trained to recognize phishing and social-engineering attempts in the last 12 months?", answers: ["Yes, all staff trained", "Some staff", "No training"] },
  { cat: "incident", q: "Do you know the IRS and FTC breach-notification steps you must follow within the required timeframes?", answers: ["Yes", "Vaguely", "No"] },
];

/** Optional profiling questions shown while the score is "calculated". */
export const ERO_QUESTIONS = [
  { id: "is_ero", label: "Are you an ERO (Electronic Return Originator) or do you work under one?", type: "select", options: ["Yes — I am an ERO", "I work under an ERO", "No"] },
  { id: "bureau", label: "Do you currently use a service bureau for your tax software?", type: "select", options: ["Yes", "No — I go direct", "Not yet, exploring options"] },
  { id: "per_return_fee", label: "What do you currently pay per funded return (all-in)?", type: "number", placeholder: "e.g. 250" },
  { id: "volume", label: "How many funded returns do you expect this season?", type: "number", placeholder: "e.g. 150" },
] as const;
export type EroAnswers = Partial<Record<(typeof ERO_QUESTIONS)[number]["id"], string>>;

/**
 * The firm's own all-in fee per funded return for the comparison. It is each firm's pricing, not the system's, so it
 * comes from the WISP product's "comparison_fee" setting; without one the comparison isn't shown.
 */
export function comparisonFee(metadata: Record<string, string> | null | undefined): number | null {
  const n = numberInput(metadata?.comparison_fee ?? "");
  return n !== null && n > 0 ? n : null;
}

/** A typed amount or count as a number: "$1,250.50", " 5 " and "250" all work; anything else is null. */
export function numberInput(raw: string): number | null {
  const v = raw.replace(/[\s$,]/g, "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(v)) return null;
  return Number.parseFloat(v);
}

/** What a number field keeps while typing: digits (and one decimal point where allowed), nothing else. */
export function numberDraft(raw: string, decimals: boolean): string {
  const v = raw.replace(/[^\d.]/g, "");
  if (!decimals) return v.replace(/\./g, "").slice(0, 6);
  const [whole, ...rest] = v.split(".");
  return (rest.length ? `${whole.slice(0, 7)}.${rest.join("").slice(0, 2)}` : whole.slice(0, 7));
}

// ------------------------------------------------------------------ scoring

/** Answers are indexes 0 (best) to 2 (worst), worth 2/1/0 points; an unanswered question counts as the worst. */
export function calculateScore(answers: (number | null | undefined)[]): { score: number; breakdown: Record<Category, number> } {
  const earned: Record<Category, number> = { access: 0, physical: 0, data: 0, incident: 0 };
  const possible: Record<Category, number> = { access: 0, physical: 0, data: 0, incident: 0 };
  QUESTIONS.forEach((q, i) => {
    const a = answers[i];
    const ans = a === 0 || a === 1 || a === 2 ? a : 2;
    earned[q.cat] += [2, 1, 0][ans];
    possible[q.cat] += 2;
  });
  let total = 0;
  const breakdown = {} as Record<Category, number>;
  for (const c of CATEGORY_KEYS) {
    const pct = possible[c] ? (earned[c] / possible[c]) * 100 : 0;
    breakdown[c] = Math.round(pct);
    total += pct * (CATEGORIES[c].weight / 100);
  }
  return { score: Math.round(total), breakdown };
}

export function scoreVerdict(score: number): { tone: "danger" | "warning" | "good"; headline: string; text: string } {
  if (score < 40) {
    return { tone: "danger", headline: "YOU DON'T HAVE A WISP", text: "Your score indicates critical gaps. Without a Written Information Security Plan, you are exposed to IRS compliance risk, potential penalties, and client data-breach liability. This is not a theoretical concern — the IRS requires every tax professional to maintain a WISP." };
  }
  if (score < 70) {
    return { tone: "warning", headline: "YOUR WISP HAS SERIOUS GAPS", text: "You have some protections in place, but significant vulnerabilities remain. A complete, documented WISP would close these gaps and demonstrate due diligence to the IRS." };
  }
  return { tone: "good", headline: "STRONG FOUNDATION", text: "Your security practices are solid. Formalize them into a written, attorney-ready WISP to complete your compliance posture and protect your firm." };
}

export const CATEGORY_ADVICE: Record<Category, string> = {
  access: "Enforce unique credentials, MFA everywhere, and role-based access.",
  physical: "Lock up documents, enforce clean-desk, set auto-lock timers.",
  data: "Encrypt in transit and at rest. Test backups. Document disposal.",
  incident: "Write your incident response plan and train staff on phishing.",
};

/**
 * The fee comparison, shown whenever the visitor gives their per-return fee and the firm has set its own. When they
 * pay more it shows the saving; when they pay the same or less it says so plainly, with what to check.
 */
export function feeComparison(ero: EroAnswers, ourFee: number | null): { theirFee: number; ourFee: number; lower: boolean; note: string } | null {
  const theirFee = numberInput(ero.per_return_fee ?? "");
  if (ourFee === null || theirFee === null || theirFee <= 0) return null;
  const vol = numberInput(ero.volume ?? "") ?? 0;
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (theirFee > ourFee) {
    const note = vol > 0
      ? `At ${fmt(vol)} returns, you'd save roughly $${fmt((theirFee - ourFee) * vol)} per season on per-return fees alone.`
      : `That's $${fmt(theirFee - ourFee)} more per return than our all-in $${fmt(ourFee)}.`;
    return { theirFee, ourFee, lower: false, note };
  }
  const note = theirFee === ourFee
    ? `You're paying the same as our all-in $${fmt(ourFee)} per return. Check that yours covers the bureau, transmission, technology and e-file fees too.`
    : `You're paying $${fmt(ourFee - theirFee)} less per return than our all-in $${fmt(ourFee)}. Check that yours covers the bureau, transmission, technology and e-file fees, and whether any are added on top.`;
  return { theirFee, ourFee, lower: true, note };
}

// ------------------------------------------------------------------ builder

export const BUILDER_STEPS = [
  { id: "firm", title: "Identifying Information", sub: "Who this WISP covers" },
  { id: "systems", title: "Systems & Data", sub: "Where data lives" },
  { id: "access", title: "Access Controls", sub: "Who can reach it" },
  { id: "protect", title: "Protections", sub: "Safeguards in place" },
  { id: "incident", title: "Incident Plan", sub: "When things go wrong" },
  { id: "review", title: "Review & Pay", sub: "Finalize your WISP" },
] as const;

export type BuilderField = { id: string; label: string; type: "text" | "tel" | "email" | "number" | "textarea" | "select"; required: boolean; placeholder?: string; options?: string[] };

export const BUILDER_FIELDS: Record<"firm" | "systems" | "access" | "protect" | "incident", BuilderField[]> = {
  firm: [
    { id: "firm_name", label: "Business Name", type: "text", required: true },
    { id: "business_email", label: "Business Email", type: "email", required: true, placeholder: "you@yourfirm.com" },
    { id: "phone", label: "Business Phone", type: "tel", required: true, placeholder: "(555) 555-0100" },
    { id: "owner_name", label: "Owner / Principal Name", type: "text", required: true },
    { id: "ein", label: "EIN (last 4 digits ok)", type: "text", required: false },
    { id: "address", label: "Business Address", type: "text", required: true },
  ],
  systems: [
    { id: "tax_software", label: "Tax software used", type: "text", required: true, placeholder: "e.g. TaxSlayer Pro, CrossLink" },
    { id: "data_locations", label: "Where is taxpayer data stored?", type: "textarea", required: true, placeholder: "List systems, cloud services, local drives…" },
    { id: "backup_method", label: "Backup method", type: "text", required: true, placeholder: "e.g. Encrypted cloud backup daily" },
  ],
  access: [
    { id: "num_users", label: "Number of people with data access", type: "number", required: true },
    { id: "mfa_status", label: "MFA status", type: "select", required: true, options: ["MFA on all systems", "MFA on some systems", "No MFA yet — will implement"] },
    { id: "access_policy", label: "Describe your access policy", type: "textarea", required: true, placeholder: "Who gets access to what, and how is it granted/revoked?" },
  ],
  protect: [
    { id: "encryption", label: "Encryption in use", type: "select", required: true, options: ["Encrypted in transit and at rest", "Encrypted in transit only", "Not yet encrypted"] },
    { id: "physical_security", label: "Physical security measures", type: "textarea", required: true, placeholder: "Locked cabinets, clean-desk policy, auto-lock timers…" },
    { id: "training", label: "Staff security training", type: "select", required: true, options: ["Annual training completed", "Training planned", "No formal training yet"] },
  ],
  incident: [
    { id: "ir_contact", label: "Incident response contact (name + role)", type: "text", required: true },
    { id: "ir_steps", label: "Your breach response steps", type: "textarea", required: true, placeholder: "1. Contain… 2. Assess… 3. Notify IRS/FTC…" },
    { id: "review_date", label: "WISP review date (annual)", type: "text", required: true, placeholder: "e.g. January 2027" },
  ],
};
export const ALL_FIELDS = Object.values(BUILDER_FIELDS).flat();
export type WispAnswers = Record<string, string>;

/** Shown on the page above the audit button. The PDF keeps its own disclaimer (DISCLAIMER). */
export const pageDisclaimer = (brand: string) => `This tool generates a Written Information Security Plan based on the information you provide. It is not legal advice. We recommend having an attorney review your plan before relying on it for compliance purposes. ${brand} is not a law firm and does not provide legal services.`;
/** The purchase acknowledgement the buyer must tick on the review step; checked again on the server. */
export const PURCHASE_ACK = "I understand this is a digital product. All sales are final — no refunds, exchanges, or transfers. The WISP is generated from my answers and is not legal advice. I am responsible for reviewing it and ensuring it meets my firm's compliance obligations.";
/** Below the download button after purchase. */
export const DONE_DISCLAIMER = "Your WISP was generated from the information you provided. It is not legal advice. Consider having an attorney review it.";

export const DISCLAIMER = "Attorney-ready means professionally formatted for attorney review, not attorney-approved. General guidance, not legal advice.";

const MAX: Record<BuilderField["type"], number> = { text: 200, tel: 30, email: 254, number: 7, textarea: 4000, select: 120 };
export const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export class WispInputError extends Error {
  readonly field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.field = field;
  }
}

/** Checks the builder's answers on the server exactly as the page does, and keeps only known fields. */
export function checkAnswers(raw: unknown): WispAnswers {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: WispAnswers = {};
  for (const f of ALL_FIELDS) {
    const v = typeof r[f.id] === "string" ? (r[f.id] as string).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, MAX[f.type]) : "";
    if (f.required && !v) throw new WispInputError(`"${f.label}" is required.`, f.id);
    if (v && f.type === "select" && !f.options!.includes(v)) throw new WispInputError(`Choose an option for "${f.label}".`, f.id);
    if (v && f.type === "email" && !EMAIL.test(v)) throw new WispInputError("Please enter a valid business email address.", f.id);
    if (v && f.type === "number" && !/^\d{1,6}$/.test(v.replace(/[\s,]/g, ""))) throw new WispInputError(`"${f.label}" must be a whole number.`, f.id);
    if (v) out[f.id] = f.type === "number" ? v.replace(/[\s,]/g, "") : v;
  }
  return out;
}

export function checkEmail(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim().toLowerCase().slice(0, 254) : "";
  if (!EMAIL.test(v)) throw new WispInputError("Please enter a valid email address.", "delivery_email");
  return v;
}

/** The audit's answers (0–2 per question) and the optional ERO answers, from untrusted input. */
export function checkAudit(rawAnswers: unknown, rawEro: unknown): { answers: (0 | 1 | 2 | null)[]; ero: EroAnswers } {
  const list = Array.isArray(rawAnswers) ? rawAnswers : [];
  const answers = QUESTIONS.map((_, i) => (list[i] === 0 || list[i] === 1 || list[i] === 2 ? list[i] : null)) as (0 | 1 | 2 | null)[];
  const r = (rawEro && typeof rawEro === "object" ? rawEro : {}) as Record<string, unknown>;
  const ero: EroAnswers = {};
  for (const q of ERO_QUESTIONS) {
    const v = typeof r[q.id] === "string" ? (r[q.id] as string).trim().slice(0, 40) : "";
    if (!v) continue;
    if (q.type === "select" && !(q.options as readonly string[]).includes(v)) continue;
    if (q.type === "number") {
      const n = numberInput(v);
      if (n === null) continue;
      ero[q.id] = String(n);
      continue;
    }
    ero[q.id] = v;
  }
  return { answers, ero };
}
