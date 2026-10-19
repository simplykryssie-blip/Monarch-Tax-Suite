import { EfinRuleError } from "./rules.ts";

// One canonical format for every phone number, EIN, EFIN, PTIN and address, used both while typing and when saving.
// Strict functions (format*) throw a field-tagged error on bad input; display* functions never throw, for old or odd data.

const digits = (v: string) => v.replace(/\D/g, "");

/** (555) 010-2030. Accepts a leading 1. Anything that is not 10 digits is rejected. */
export function formatPhone(raw: string, field = "person_phone"): string {
  let d = digits(raw);
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length !== 10) throw new EfinRuleError("Enter a 10-digit phone number, for example (555) 010-2030.", field);
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
export function displayPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  let d = digits(raw);
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
}
/** Live masks used while typing (never throw, never reject partial input). */
export function maskPhoneInput(raw: string): string {
  let d = digits(raw);
  if (d.length > 10 && d.startsWith("1")) d = d.slice(1);
  d = d.slice(0, 10);
  if (d.length <= 3) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
export const maskEinInput = (raw: string) => { const d = digits(raw).slice(0, 9); return d.length > 2 ? `${d.slice(0, 2)}-${d.slice(2)}` : d; };
export const maskEfinInput = (raw: string) => digits(raw).slice(0, 6);
export const maskPtinInput = (raw: string) => { const v = raw.toUpperCase().replace(/[^P0-9]/g, ""); const body = v.replace(/^P/, "").replace(/P/g, "").slice(0, 8); return v ? `P${body}` : ""; };
export const maskZipInput = (raw: string) => { const d = digits(raw).slice(0, 9); return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d; };
export const maskStateInput = (raw: string) => raw.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 2);

/** 12-3456789 */
export const formatEin = (nineDigits: string) => `${nineDigits.slice(0, 2)}-${nineDigits.slice(2)}`;

export function formatState(raw: string, field = "state"): string {
  const v = raw.trim().toUpperCase();
  if (!v) return "";
  if (!/^[A-Z]{2}$/.test(v)) throw new EfinRuleError("Use the two-letter state code, for example LA.", field);
  return v;
}
export function formatZip(raw: string, field = "zip"): string {
  const d = digits(raw);
  if (!d) return "";
  if (d.length === 5) return d;
  if (d.length === 9) return `${d.slice(0, 5)}-${d.slice(5)}`;
  throw new EfinRuleError("ZIP code must be 5 digits (or 9, like 70607-1234).", field);
}

const KEEP_UPPER = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW", "PO", "PMB", "US", "I"]);
const STREET_ABBR: Record<string, string> = { street: "St", avenue: "Ave", boulevard: "Blvd", drive: "Dr", road: "Rd", lane: "Ln", court: "Ct", highway: "Hwy", suite: "Ste", apartment: "Apt", parkway: "Pkwy", place: "Pl", circle: "Cir" };
/** "3418 GREINWICH BOULEVARD" -> "3418 Greinwich Blvd". Collapses spaces, fixes capitals, standard street abbreviations. */
export function formatStreet(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").split(" ").map((w) => {
    const bare = w.replace(/[.,]/g, "");
    const lower = bare.toLowerCase();
    if (STREET_ABBR[lower]) return STREET_ABBR[lower];
    if (KEEP_UPPER.has(bare.toUpperCase())) return bare.toUpperCase();
    if (/^\d/.test(bare)) return bare.toLowerCase().replace(/^(\d+)(st|nd|rd|th)$/, "$1$2") === bare.toLowerCase() ? bare.toLowerCase() : bare.toUpperCase();
    if (/^#/.test(bare)) return bare;
    return lower.replace(/(^|[-'])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
  }).join(" ");
}
export function formatCity(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase().replace(/(^|[\s.'-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
}
export const formatName = (raw: string) => raw.trim().replace(/\s+/g, " ");

export type Address = { line1: string; city: string; state: string; zip: string };
export function formatAddress(a: Partial<Address>, fields = { state: "state", zip: "zip" }): Address {
  return { line1: formatStreet(a.line1 ?? ""), city: formatCity(a.city ?? ""), state: formatState(a.state ?? "", fields.state), zip: formatZip(a.zip ?? "", fields.zip) };
}
/** "3418 Greinwich Blvd, Lake Charles, LA 70607" for display. */
export function displayAddress(a: Partial<Address> | null | undefined): string {
  if (!a) return "";
  const cityState = [a.city, a.state].filter(Boolean).join(", ");
  return [a.line1, [cityState, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}
