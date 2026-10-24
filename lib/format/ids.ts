// How phone numbers, tax IDs and addresses are written. Pure, so the same rule runs in the input as you type and on the
// server when a value is saved. Each formatter takes whatever was typed or pasted and returns the standard form, cut off
// at the right length, so a half-typed value is still shown the right way.

export type IdKind = "phone" | "ssn" | "ein" | "efin" | "ptin" | "caf" | "zip" | "money";

export const digitsOf = (v: unknown): string => String(v ?? "").replace(/\D/g, "");

/** (555) 123-4567. A leading 1 is dropped; a number that starts with + (outside the US) is left as typed. */
export function formatPhone(v: unknown): string {
  const raw = String(v ?? "").trim();
  if (raw.startsWith("+") && !raw.startsWith("+1")) return raw.replace(/[^\d+ ]/g, "").slice(0, 20);
  let d = digitsOf(raw);
  if (d.length > 10 && d.startsWith("1")) d = d.slice(1);
  d = d.slice(0, 10);
  if (d.length === 0) return "";
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** 123-45-6789. Also the form of an ITIN (nine digits starting with 9). */
export function formatSsn(v: unknown): string {
  const d = digitsOf(v).slice(0, 9);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

/** 12-3456789. */
export function formatEin(v: unknown): string {
  const d = digitsOf(v).slice(0, 9);
  return d.length <= 2 ? d : `${d.slice(0, 2)}-${d.slice(2)}`;
}

/** An EFIN is six digits. */
export const formatEfin = (v: unknown): string => digitsOf(v).slice(0, 6);

/** P12345678: the letter P and eight digits. */
export function formatPtin(v: unknown): string {
  const d = digitsOf(v).slice(0, 8);
  const typedP = /^\s*p/i.test(String(v ?? ""));
  return d.length === 0 ? (typedP ? "P" : "") : `P${d}`;
}

/** A CAF number is nine digits, written 1234-56789. */
export function formatCaf(v: unknown): string {
  const d = digitsOf(v).slice(0, 9);
  return d.length <= 4 ? d : `${d.slice(0, 4)}-${d.slice(4)}`;
}

/** 12345 or 12345-6789. */
export function formatZip(v: unknown): string {
  const d = digitsOf(v).slice(0, 9);
  return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`;
}

/** A dollar amount as typed: $1,234.50. Digits and one point only, up to two decimals, commas added. */
export function formatMoney(v: unknown): string {
  const raw = String(v ?? "").replace(/[^\d.]/g, "");
  if (!raw) return "";
  const [whole = "", ...rest] = raw.split(".");
  const frac = rest.join("").slice(0, 2);
  const digits = whole.replace(/^0+(?=\d)/, "").slice(0, 8) || "0";
  return `$${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${raw.includes(".") ? `.${frac}` : ""}`;
}

/** The same amount with both decimals, for when the person has finished typing ($50 becomes $50.00). */
export function finishMoney(v: unknown): string {
  const s = formatMoney(v);
  if (!s) return "";
  const [whole, frac = ""] = s.split(".");
  return `${whole}.${frac.padEnd(2, "0")}`;
}

export const FORMATTERS: Record<IdKind, (v: unknown) => string> = {
  phone: formatPhone, ssn: formatSsn, ein: formatEin, efin: formatEfin, ptin: formatPtin, caf: formatCaf, zip: formatZip, money: formatMoney,
};

/** The longest a formatted value of each kind can be (and the most the input accepts). */
export const MAX_LENGTH: Record<IdKind, number> = { phone: 20, ssn: 11, ein: 10, efin: 6, ptin: 9, caf: 10, zip: 10, money: 14 };

export const INPUT_MODE: Record<IdKind, "tel" | "numeric" | "text" | "decimal"> = { phone: "tel", ssn: "numeric", ein: "numeric", efin: "numeric", ptin: "text", caf: "numeric", zip: "numeric", money: "decimal" };

const SMALL_WORDS = new Set(["of", "the", "and"]);
const KEEP_UPPER = /^(?:[nsew]{1,2}|po|pmb|apt|ste|ne|nw|se|sw|us|ii|iii|iv)$/i;

/**
 * A mailing address written one standard way: spaces tidied, words capitalised when it was typed all in one case, the state
 * in capitals and a trailing ZIP set as 12345 or 12345-6789. A mixed-case address someone already wrote carefully is not touched.
 */
export function formatAddress(v: unknown): string {
  let s = String(v ?? "").replace(/\s+/g, " ").replace(/\s+,/g, ",").replace(/,(?=\S)/g, ", ").trim();
  if (!s) return "";
  if (s === s.toLowerCase() || s === s.toUpperCase()) {
    s = s.toLowerCase().split(" ").map((w, i) => {
      if (/^\d/.test(w)) return w.replace(/(\d)(st|nd|rd|th)\b/g, "$1$2");
      if (KEEP_UPPER.test(w.replace(/[.,]/g, ""))) return w.toUpperCase();
      if (i > 0 && SMALL_WORDS.has(w)) return w;
      return w.replace(/(^|[-'])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
    }).join(" ");
  }
  s = s.replace(/\b([A-Za-z]{2})(,?\s+)(\d{5})(?:-?(\d{4}))?$/, (_m, st: string, _sep: string, z5: string, z4?: string) => `${st.toUpperCase()} ${z4 ? `${z5}-${z4}` : z5}`);
  return s;
}
