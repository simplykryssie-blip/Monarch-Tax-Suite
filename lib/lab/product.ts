import type { LabKind } from "./types.ts";

// How a store product becomes a Monarch Tax Lab license. No imports from the commerce module, so its validation can
// use these rules without a cycle. Product settings (CRM → Products → settings):
//   delivery       = tax_lab
//   lab_role       = instructor | student
//   lab_seats      = student seats (instructor licenses only, 1 to 1000)
//   lab_term_days  = optional; days of access from activation (default 365)

export const DELIVERY = "tax_lab";
const DEFAULT_TERM_DAYS = 365;

const num = (v: unknown) => {
  const x = parseFloat(String(v ?? ""));
  return Number.isFinite(x) ? x : 0;
};

export function isLabProduct(metadata: Record<string, string> | null | undefined): boolean {
  return metadata?.delivery === DELIVERY;
}

/** The training settings of a product, or null when the product is not a Tax Lab product. */
export function labProductSettings(metadata: Record<string, string> | null | undefined): { kind: LabKind; seats: number; termDays: number } | null {
  if (!metadata || metadata.delivery !== DELIVERY) return null;
  const kind: LabKind = metadata.lab_role === "student" ? "student" : "instructor";
  const seats = kind === "instructor" ? Math.max(0, Math.min(1000, Math.floor(num(metadata.lab_seats)))) : 0;
  const days = Math.floor(num(metadata.lab_term_days));
  return { kind, seats, termDays: days >= 1 && days <= 3660 ? days : DEFAULT_TERM_DAYS };
}

/** Problems with a Tax Lab product's settings, shown before it can be published. */
export function labProductBlockers(metadata: Record<string, string> | null | undefined): string[] {
  if (!metadata || metadata.delivery !== DELIVERY) return [];
  const out: string[] = [];
  if (metadata.lab_role !== "instructor" && metadata.lab_role !== "student") out.push('Tax Lab products need a "lab_role" setting of instructor or student.');
  if (metadata.lab_role === "instructor") {
    const seats = Number(metadata.lab_seats);
    if (!Number.isInteger(seats) || seats < 1 || seats > 1000) out.push('Instructor licenses need a "lab_seats" setting: the number of student seats (1 to 1000).');
  }
  if (metadata.lab_term_days !== undefined) {
    const d = Number(metadata.lab_term_days);
    if (!Number.isInteger(d) || d < 1 || d > 3660) out.push('"lab_term_days" must be a whole number of days (1 to 3660). Leave it out for one year.');
  }
  return out;
}

