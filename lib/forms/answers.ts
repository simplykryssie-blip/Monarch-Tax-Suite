import { DISPLAY_TYPES, inputFields, type DateBound, type Field, type FormDefinition } from "./definition.ts";
import { evaluate, isAnswered, type RawAnswer, type RawAnswers } from "./logic.ts";

// Checks a respondent's answers on the server. Only fields the respondent actually saw are kept and required;
// everything is reduced to plain text values. Pure: no server imports, so the public page can show the same messages.

export type AddressAnswer = { line1: string; line2?: string; city: string; state: string; zip: string; country?: string };
/** A checked answer: text, a list (checkboxes, upload ids) or an address. Signatures are kept separately. */
export type Answer = string | string[] | AddressAnswer;
export type Answers = Record<string, Answer>;

export const US_STATES = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "PR", "VI", "GU", "AS", "MP"];

const clean = (v: string, max: number) => v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/[\u2028\u2029]/g, " ").slice(0, max);
const oneLine = (v: string, max: number) => clean(v, max).replace(/\s+/g, " ").trim();
const multi = (v: string, max: number) => clean(v.replace(/\r\n?/g, "\n"), max).trim();
const digits = (v: string) => v.replace(/\D/g, "");
const asString = (v: RawAnswer) => (typeof v === "string" ? v : "");
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;

function dayOf(b: DateBound, today: string): string {
  if (b.kind === "fixed") return b.date;
  const t = Date.parse(`${today}T00:00:00Z`) + b.days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
const longDay = (iso: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

export function formatIdentifier(format: NonNullable<Field["format"]>, raw: string): string | null {
  const v = raw.replace(/[\s-]/g, "").toUpperCase();
  if (format === "efin") return /^\d{6}$/.test(v) ? v : null;
  if (format === "ein") return /^\d{9}$/.test(v) ? `${v.slice(0, 2)}-${v.slice(2)}` : null;
  return /^P\d{8}$/.test(v) ? v : null;
}
const FORMAT_HELP = { efin: "An EFIN is six digits.", ein: "An EIN is nine digits, like 12-3456789.", ptin: "A PTIN is the letter P followed by eight digits." };

/** One field's answer, checked. Returns the clean value, or an error message. Empty answers return null. */
export function checkAnswer(field: Field, raw: RawAnswer, today: string): { value: Answer | null; error?: string } {
  const label = field.label || field.key;
  if (!isAnswered(raw)) return field.required ? { value: null, error: `${label} is required.` } : { value: null };
  switch (field.type) {
    case "short_text":
    case "long_text": {
      const max = field.maxLength ?? (field.type === "short_text" ? 200 : 5000);
      const v = field.type === "short_text" ? oneLine(asString(raw), 2000) : multi(asString(raw), 25000);
      if (field.format) {
        const id = formatIdentifier(field.format, v);
        return id ? { value: id } : { value: null, error: `${label}: ${FORMAT_HELP[field.format]}` };
      }
      if (v.length > max) return { value: null, error: `${label} can be at most ${max} characters.` };
      if (field.minLength && v.length < field.minLength) return { value: null, error: `${label} needs at least ${field.minLength} characters.` };
      return { value: v };
    }
    case "number": {
      const v = asString(raw).trim().replace(/,/g, "");
      if (!/^-?\d+(\.\d+)?$/.test(v) || v.length > 20) return { value: null, error: `${label} must be a number.` };
      if (!field.decimals && v.includes(".")) return { value: null, error: `${label} must be a whole number.` };
      const n = Number(v);
      if (field.min !== null && field.min !== undefined && n < field.min) return { value: null, error: `${label} must be at least ${field.min}.` };
      if (field.max !== null && field.max !== undefined && n > field.max) return { value: null, error: `${label} must be at most ${field.max}.` };
      return { value: v };
    }
    case "email": {
      const v = oneLine(asString(raw), 300).toLowerCase();
      return v.length <= 254 && EMAIL.test(v) ? { value: v } : { value: null, error: `${label}: enter a valid email address.` };
    }
    case "phone": {
      const v = oneLine(asString(raw), 40);
      if (field.phoneFormat === "intl") {
        const d = digits(v);
        return /^\+?\d[\d\s().-]*$/.test(v) && d.length >= 8 && d.length <= 15 ? { value: `+${d}` } : { value: null, error: `${label}: enter the number with its country code, like +44 20 7946 0000.` };
      }
      let d = digits(v);
      if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
      return d.length === 10 ? { value: `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` } : { value: null, error: `${label}: enter a 10-digit phone number.` };
    }
    case "date": {
      const v = asString(raw).trim();
      if (!ISO_DAY.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) return { value: null, error: `${label}: enter a real date.` };
      if (field.dateMin && v < dayOf(field.dateMin, today)) return { value: null, error: `${label} can't be before ${longDay(dayOf(field.dateMin, today))}.` };
      if (field.dateMax && v > dayOf(field.dateMax, today)) return { value: null, error: `${label} can't be after ${longDay(dayOf(field.dateMax, today))}.` };
      return { value: v };
    }
    case "dropdown":
    case "radio": {
      const v = asString(raw).trim();
      return field.options?.includes(v) ? { value: v } : { value: null, error: `${label}: choose one of the options.` };
    }
    case "checkboxes": {
      const list = Array.isArray(raw) ? [...new Set(raw.map((x) => (typeof x === "string" ? x : "")))] : [];
      if (list.some((x) => !field.options?.includes(x))) return { value: null, error: `${label}: choose from the options shown.` };
      if (field.minSelected && list.length < field.minSelected) return { value: null, error: `${label}: tick at least ${field.minSelected}.` };
      if (field.maxSelected && list.length > field.maxSelected) return { value: null, error: `${label}: tick at most ${field.maxSelected}.` };
      return { value: field.options!.filter((o) => list.includes(o)) };
    }
    case "file": {
      const list = Array.isArray(raw) ? raw.map((x) => (typeof x === "string" ? x : x?.id)).filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/.test(x)) : [];
      if (!list.length) return field.required ? { value: null, error: `${label}: upload a file.` } : { value: null };
      if (list.length > (field.maxFiles ?? 1)) return { value: null, error: `${label}: at most ${field.maxFiles ?? 1} file${(field.maxFiles ?? 1) > 1 ? "s" : ""}.` };
      return { value: [...new Set(list)] };
    }
    case "address": {
      const a = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, string>;
      const part = (k: string, max: number) => oneLine(typeof a[k] === "string" ? a[k] : "", max);
      const country = field.country ? part("country", 80) || "United States" : "United States";
      const us = /^(us|usa|united states( of america)?)$/i.test(country);
      const out: AddressAnswer = { line1: part("line1", 200), city: part("city", 100), state: part("state", 60), zip: part("zip", 20) };
      if (field.line2) out.line2 = part("line2", 200);
      if (field.country) out.country = country;
      const missing = [!out.line1 && "street", !out.city && "city", !out.state && "state", !out.zip && us && "ZIP code"].filter(Boolean);
      if (missing.length) return { value: null, error: `${label}: enter the ${missing.join(", ")}.` };
      if (us) {
        const st = out.state.toUpperCase();
        if (!US_STATES.includes(st)) return { value: null, error: `${label}: use the two-letter state code, like LA.` };
        out.state = st;
        const z = digits(out.zip);
        if (z.length !== 5 && z.length !== 9) return { value: null, error: `${label}: the ZIP code is 5 digits (or 9).` };
        out.zip = z.length === 9 ? `${z.slice(0, 5)}-${z.slice(5)}` : z;
      }
      return { value: out };
    }
    default:
      return { value: null };
  }
}

/**
 * Pre-filled, locked answers always carry the builder's value, whatever the browser sent. Staff-only fields are never
 * accepted from a respondent.
 */
export function withLocked(def: FormDefinition, raw: RawAnswers): RawAnswers {
  const out: RawAnswers = { ...raw };
  for (const f of inputFields(def)) {
    if (f.internal) delete out[f.key];
    else if (f.locked && f.defaultValue) out[f.key] = f.defaultValue;
  }
  return out;
}

/** The answers a respondent starts with: every pre-filled value, then anything they already entered. */
export function startingAnswers(def: FormDefinition, entered: RawAnswers = {}): RawAnswers {
  const out: RawAnswers = {};
  for (const f of inputFields(def)) if (f.defaultValue && !f.internal) out[f.key] = f.defaultValue;
  return withLocked(def, { ...out, ...entered });
}

export type CheckedAnswers = { answers: Answers; errors: Record<string, string>; visible: Set<string>; signatureVisible: boolean };

/**
 * Checks every visible field. Answers to hidden or skipped fields are dropped, even if the browser sent them.
 * `signed` says whether the respondent completed the signature field (checked separately).
 */
export function checkAnswers(def: FormDefinition, rawIn: RawAnswers, opts: { today: string; signed: boolean }): CheckedAnswers {
  const raw = withLocked(def, rawIn);
  const { visible } = evaluate(def, raw);
  const answers: Answers = {};
  const errors: Record<string, string> = {};
  let signatureVisible = false;
  for (const f of inputFields(def)) {
    if (f.internal || !visible.has(f.id) || DISPLAY_TYPES.includes(f.type)) continue;
    if (f.type === "signature") {
      signatureVisible = true;
      if (f.required && !opts.signed) errors[f.key] = `${f.label || "Signature"}: sign before submitting.`;
      continue;
    }
    const r = checkAnswer(f, raw[f.key], opts.today);
    if (r.error) errors[f.key] = r.error;
    else if (r.value !== null) answers[f.key] = r.value;
  }
  return { answers, errors, visible, signatureVisible };
}

/** A saved-for-later draft: no required checks, only lengths clamped and shapes kept. */
export function draftAnswers(def: FormDefinition, rawIn: RawAnswers): RawAnswers {
  const out: RawAnswers = {};
  const raw = withLocked(def, rawIn);
  for (const f of inputFields(def)) {
    const v = raw[f.key];
    if (f.internal || f.type === "signature" || v === undefined || v === null) continue;
    if (typeof v === "string") out[f.key] = clean(v, f.type === "long_text" ? 25000 : 2000);
    else if (Array.isArray(v)) out[f.key] = f.type === "file"
      ? v.slice(0, 5).map((x) => (typeof x === "string" ? { id: x, name: "" } : { id: String(x?.id ?? "").slice(0, 36), name: clean(String(x?.name ?? ""), 160) }))
      : v.slice(0, 50).map((x) => clean(typeof x === "string" ? x : "", 120));
    else if (typeof v === "object") out[f.key] = Object.fromEntries(Object.entries(v).slice(0, 8).map(([k, x]) => [k.slice(0, 10), clean(typeof x === "string" ? x : "", 200)]));
  }
  return out;
}

/** An answer as one line of text, for the PDF, CSV, emails and merge fields. */
export function answerText(field: Pick<Field, "type">, value: Answer | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(", ");
  return [value.line1, value.line2, [value.city, [value.state, value.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "), value.country && !/^united states$/i.test(value.country) ? value.country : ""].filter(Boolean).join(", ");
}
