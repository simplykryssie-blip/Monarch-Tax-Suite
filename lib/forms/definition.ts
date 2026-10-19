// A form's definition: pages, sections, fields and logic. Pure data and checks with no server imports, so the builder,
// the public page and the server all use the same code. The server re-checks every definition it saves or publishes.

export const FIELD_TYPES = [
  "short_text", "long_text", "number", "email", "phone", "date", "dropdown", "radio", "checkboxes", "file", "signature", "address", "heading", "paragraph",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Display-only blocks: no answer. */
export const DISPLAY_TYPES: FieldType[] = ["heading", "paragraph"];
export const CHOICE_TYPES: FieldType[] = ["dropdown", "radio", "checkboxes"];
export const FILE_KINDS = ["pdf", "jpg", "png"] as const;
export type FileKind = (typeof FILE_KINDS)[number];
/** Identifier formats a short answer can be checked against. These are always stored encrypted. */
export const IDENTIFIER_FORMATS = ["efin", "ein", "ptin"] as const;
export type IdentifierFormat = (typeof IDENTIFIER_FORMATS)[number];

export const FIELD_LABELS: Record<FieldType, string> = {
  short_text: "Short answer", long_text: "Long answer", number: "Number", email: "Email", phone: "Phone", date: "Date",
  dropdown: "Dropdown", radio: "Radio buttons", checkboxes: "Checkboxes", file: "File upload", signature: "Signature", address: "Address",
  heading: "Heading", paragraph: "Paragraph",
};

export type DateBound = { kind: "fixed"; date: string } | { kind: "relative"; days: number };

export const FIELD_WIDTHS = ["full", "two_thirds", "half", "third"] as const;
export type FieldWidth = (typeof FIELD_WIDTHS)[number];
export const WIDTH_LABELS: Record<FieldWidth, string> = { full: "Full row", two_thirds: "Two thirds of a row", half: "Half a row (two side by side)", third: "One third (three side by side)" };
/** Columns a width takes out of the form's 6-column grid. */
export const WIDTH_COLUMNS: Record<FieldWidth, number> = { full: 6, two_thirds: 4, half: 3, third: 2 };
/** Types that can't share a row: they need the room. */
export const FULL_ROW_TYPES: FieldType[] = ["signature", "file", "heading", "paragraph"];
/** Types that can hold a staff-only value. Uploads and signatures are the respondent's own. */
export const INTERNAL_TYPES: FieldType[] = ["short_text", "long_text", "number", "email", "phone", "date", "dropdown", "radio"];
/** Types that take a starting value. */
export const DEFAULT_TYPES: FieldType[] = ["short_text", "long_text"];

export type Field = {
  id: string;
  type: FieldType;
  /** Names the answer: in the PDF, CSV, workflow conditions and document merge fields. Unique in the form. */
  key: string;
  label: string;
  help?: string;
  placeholder?: string;
  required: boolean;
  /** Share of the row: fields that fit on one row sit side by side (like columns in a form builder). */
  width: FieldWidth;
  /** short_text and long_text: the value the field starts with. With `locked`, the respondent can't change it. */
  defaultValue?: string;
  locked?: boolean;
  /** Staff-only: answered or noted by staff on the submission, never shown to the person filling in the form. */
  internal?: boolean;
  /** short_text: stored encrypted and shown masked. Always on for identifier formats. */
  sensitive?: boolean;
  format?: IdentifierFormat | null;
  minLength?: number | null;
  maxLength?: number | null;
  min?: number | null;
  max?: number | null;
  decimals?: boolean;
  phoneFormat?: "us" | "intl";
  dateMin?: DateBound | null;
  dateMax?: DateBound | null;
  options?: string[];
  minSelected?: number | null;
  maxSelected?: number | null;
  fileTypes?: FileKind[];
  maxFiles?: number;
  /** address: include the second street line and the country. */
  line2?: boolean;
  country?: boolean;
  /** paragraph: its text. */
  text?: string;
};

export type Section = { id: string; title: string; description?: string; fields: Field[] };

export const CONDITION_OPS = ["equals", "not_equals", "contains", "answered", "empty", "gt", "lt"] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];
export const OP_LABELS: Record<ConditionOp, string> = { equals: "equals", not_equals: "does not equal", contains: "contains", answered: "is answered", empty: "is empty", gt: "is greater than", lt: "is less than" };
/** `field` is a field id. */
export type Condition = { field: string; op: ConditionOp; value?: string };
export type SkipRule = { id: string; match: "all" | "any"; conditions: Condition[]; goto: string | "end" };
export type Page = { id: string; title: string; sections: Section[]; skips: SkipRule[] };
/** Show or hide a field or a whole section. `target` is a field or section id. */
export type ShowRule = { id: string; target: string; action: "show" | "hide"; match: "all" | "any"; conditions: Condition[] };

export type FormDefinition = { version: 1; pages: Page[]; rules: ShowRule[] };

export const LIMITS = { fields: 200, pages: 20, rules: 100, sectionsPerPage: 20, options: 200, conditions: 10 };
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_FIELD = 5;
export const MAX_SUBMISSION_FILE_BYTES = 60 * 1024 * 1024;

const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const ID = /^[a-z][a-z0-9]{3,24}$/;

export class DefinitionError extends Error {
  /** The field, section or page the problem is about, so the builder can select it. */
  target?: string;
  constructor(message: string, target?: string) {
    super(message);
    this.target = target;
  }
}

/** A short random id for a page, section, field or rule. */
export function newId(prefix: "p" | "s" | "f" | "r"): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return prefix + Array.from(bytes, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}

/** A key from a label: "Business name (legal)" -> business_name_legal. Made unique against `taken`. */
export function keyFromLabel(label: string, taken: Set<string>): string {
  let base = label.toLowerCase().normalize("NFKD").replace(/\p{Mark}/gu, "").replace(/[^\p{Letter}\p{Number}]+/gu, " ").replace(/[^a-z0-9 ]/g, "").trim().replace(/\s+/g, "_").slice(0, 34);
  if (!/^[a-z]/.test(base)) base = `field_${base}`.slice(0, 34);
  base = base.replace(/_+$/, "") || "field";
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base}_${i}`;
  return key;
}

export function emptyDefinition(): FormDefinition {
  return { version: 1, pages: [{ id: newId("p"), title: "Page 1", sections: [{ id: newId("s"), title: "", fields: [] }], skips: [] }], rules: [] };
}

/** A new field of `type` with sensible defaults. */
export function newField(type: FieldType, taken: Set<string>): Field {
  const label = type === "heading" ? "Heading" : type === "paragraph" ? "Paragraph" : FIELD_LABELS[type];
  const base: Field = { id: newId("f"), type, key: keyFromLabel(label, taken), label, required: false, width: "full" };
  switch (type) {
    case "dropdown":
    case "radio":
      return { ...base, options: ["Option 1", "Option 2"] };
    case "checkboxes":
      return { ...base, options: ["Option 1", "Option 2"] };
    case "file":
      return { ...base, fileTypes: ["pdf", "jpg", "png"], maxFiles: 1, label: "Upload a file" };
    case "phone":
      return { ...base, phoneFormat: "us" };
    case "address":
      return { ...base, line2: true, country: false };
    case "paragraph":
      return { ...base, text: "Write the text shown here." };
    case "signature":
      return { ...base, required: true, label: "Signature" };
    default:
      return base;
  }
}

export const allFields = (def: FormDefinition): Field[] => def.pages.flatMap((p) => p.sections.flatMap((s) => s.fields));
export const inputFields = (def: FormDefinition): Field[] => allFields(def).filter((f) => !DISPLAY_TYPES.includes(f.type));
/** The definition the person filling in the form gets: staff-only fields (and rules aimed at them) are removed. */
export function publicDefinition(def: FormDefinition): FormDefinition {
  const hidden = new Set(allFields(def).filter((f) => f.internal).map((f) => f.id));
  if (!hidden.size) return def;
  return {
    ...def,
    pages: def.pages.map((p) => ({ ...p, sections: p.sections.map((s) => ({ ...s, fields: s.fields.filter((f) => !hidden.has(f.id)) })) })),
    rules: def.rules.filter((r) => !hidden.has(r.target)),
  };
}
export const hasSignature = (def: FormDefinition) => allFields(def).some((f) => f.type === "signature");

// ------------------------------------------------------------------------------------------------ checking

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
const longStr = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
const intOrNull = (v: unknown, lo: number, hi: number): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && Number.isInteger(n) && n >= lo && n <= hi ? n : null;
};
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= 1e12 ? n : null;
};
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
function bound(v: unknown): DateBound | null {
  if (!v || typeof v !== "object") return null;
  const b = v as Record<string, unknown>;
  if (b.kind === "fixed" && typeof b.date === "string" && ISO_DAY.test(b.date) && !Number.isNaN(Date.parse(`${b.date}T00:00:00Z`))) return { kind: "fixed", date: b.date };
  if (b.kind === "relative") {
    const days = intOrNull(b.days, -36500, 36500);
    if (days !== null) return { kind: "relative", days };
  }
  return null;
}

function cleanField(raw: unknown, keys: Set<string>): Field {
  const r = (raw ?? {}) as Record<string, unknown>;
  const type = r.type as FieldType;
  if (!FIELD_TYPES.includes(type)) throw new DefinitionError("A field has an unknown type.");
  const id = str(r.id, 30);
  if (!ID.test(id)) throw new DefinitionError("A field has an invalid id.");
  const label = str(r.label, 300);
  const display = DISPLAY_TYPES.includes(type);
  if (!label && type !== "paragraph") throw new DefinitionError("Every field needs a label.", id);
  const key = str(r.key, 40);
  if (!KEY.test(key)) throw new DefinitionError(`"${label || "A field"}" needs a key of lowercase letters, numbers and underscores, starting with a letter.`, id);
  if (keys.has(key)) throw new DefinitionError(`Two fields use the key "${key}". Each key must be unique.`, id);
  keys.add(key);
  const internal = INTERNAL_TYPES.includes(type) && r.internal === true;
  const width = FIELD_WIDTHS.includes(r.width as FieldWidth) && !FULL_ROW_TYPES.includes(type) ? (r.width as FieldWidth) : "full";
  const f: Field = { id, type, key, label, required: !display && !internal && r.required === true, width };
  if (internal) f.internal = true;
  const help = longStr(r.help, 500);
  if (help) f.help = help;
  const placeholder = str(r.placeholder, 120);
  if (placeholder && ["short_text", "long_text", "number", "email", "phone"].includes(type)) f.placeholder = placeholder;
  const named = `"${label || key}"`;
  switch (type) {
    case "short_text":
    case "long_text": {
      const cap = type === "short_text" ? 1000 : 20000;
      f.minLength = intOrNull(r.minLength, 0, cap);
      f.maxLength = intOrNull(r.maxLength, 1, cap) ?? (type === "short_text" ? 200 : 5000);
      if (f.minLength !== null && f.minLength > f.maxLength) throw new DefinitionError(`${named}: the minimum length is more than the maximum.`, id);
      const start = type === "short_text" ? str(r.defaultValue, 2000) : longStr(r.defaultValue, 25000);
      if (start) {
        if (start.length > f.maxLength) throw new DefinitionError(`${named}: the pre-filled value is longer than the maximum length.`, id);
        f.defaultValue = start;
        if (r.locked === true && !internal) f.locked = true;
      }
      if (type === "short_text") {
        const format = IDENTIFIER_FORMATS.includes(r.format as IdentifierFormat) ? (r.format as IdentifierFormat) : null;
        f.format = format;
        f.sensitive = format !== null || r.sensitive === true;
      }
      break;
    }
    case "number":
      f.min = numOrNull(r.min);
      f.max = numOrNull(r.max);
      f.decimals = r.decimals === true;
      if (f.min !== null && f.max !== null && f.min > f.max) throw new DefinitionError(`${named}: the minimum is more than the maximum.`, id);
      break;
    case "phone":
      f.phoneFormat = r.phoneFormat === "intl" ? "intl" : "us";
      break;
    case "date":
      f.dateMin = bound(r.dateMin);
      f.dateMax = bound(r.dateMax);
      break;
    case "dropdown":
    case "radio":
    case "checkboxes": {
      const options = Array.isArray(r.options) ? r.options.map((o) => str(o, 120)).filter(Boolean) : [];
      const unique = [...new Set(options)];
      const min = type === "checkboxes" ? 1 : 2;
      const max = type === "dropdown" ? LIMITS.options : 50;
      if (unique.length < min) throw new DefinitionError(`${named} needs at least ${min} option${min > 1 ? "s" : ""}.`, id);
      if (unique.length > max) throw new DefinitionError(`${named} can have at most ${max} options.`, id);
      if (unique.length !== options.length) throw new DefinitionError(`${named} lists the same option twice.`, id);
      f.options = unique;
      if (type === "checkboxes") {
        f.minSelected = intOrNull(r.minSelected, 0, unique.length);
        f.maxSelected = intOrNull(r.maxSelected, 1, unique.length);
        if (f.minSelected !== null && f.maxSelected !== null && f.minSelected > f.maxSelected) throw new DefinitionError(`${named}: the minimum number to tick is more than the maximum.`, id);
      }
      break;
    }
    case "file": {
      const kinds = Array.isArray(r.fileTypes) ? FILE_KINDS.filter((k) => (r.fileTypes as unknown[]).includes(k)) : [];
      if (!kinds.length) throw new DefinitionError(`${named}: choose which file types are accepted.`, id);
      f.fileTypes = kinds;
      f.maxFiles = intOrNull(r.maxFiles, 1, MAX_FILES_PER_FIELD) ?? 1;
      break;
    }
    case "address":
      f.line2 = r.line2 !== false;
      f.country = r.country === true;
      break;
    case "paragraph":
      f.text = longStr(r.text, 3000);
      if (!f.text) throw new DefinitionError("A paragraph block needs text.", id);
      break;
  }
  return f;
}

function cleanConditions(raw: unknown, ownerName: string, before: Map<string, Field>, target?: string): Condition[] {
  const list = Array.isArray(raw) ? raw : [];
  if (!list.length) throw new DefinitionError(`${ownerName} needs at least one condition.`, target);
  if (list.length > LIMITS.conditions) throw new DefinitionError(`${ownerName} can have at most ${LIMITS.conditions} conditions.`, target);
  return list.map((c: Record<string, unknown>) => {
    const fieldId = str(c?.field, 30);
    const field = before.get(fieldId);
    if (!field) throw new DefinitionError(`${ownerName} tests a field that was deleted or comes after it. Rules can only test fields that appear earlier in the form.`, target);
    if (field.internal) throw new DefinitionError(`${ownerName} tests "${field.label}", which is staff-only. Respondents never see it, so rules can't depend on it.`, target);
    if (DISPLAY_TYPES.includes(field.type) || field.type === "signature" || field.type === "file") {
      if (c?.op !== "answered" && c?.op !== "empty") throw new DefinitionError(`${ownerName}: "${field.label}" can only be tested for "is answered" or "is empty".`, target);
    }
    const op = CONDITION_OPS.includes(c?.op as ConditionOp) ? (c.op as ConditionOp) : null;
    if (!op) throw new DefinitionError(`${ownerName} has an unknown test.`, target);
    if (op === "answered" || op === "empty") return { field: fieldId, op };
    const value = str(c?.value, 120);
    if ((op === "gt" || op === "lt") && field.type !== "number" && field.type !== "date") throw new DefinitionError(`${ownerName}: "greater than" and "less than" work only on numbers and dates.`, target);
    if (op === "gt" || op === "lt") {
      if (field.type === "number" && numOrNull(value) === null) throw new DefinitionError(`${ownerName}: enter a number to compare "${field.label}" with.`, target);
      if (field.type === "date" && !ISO_DAY.test(value)) throw new DefinitionError(`${ownerName}: enter a date to compare "${field.label}" with.`, target);
    }
    if (field.options && (op === "equals" || op === "not_equals" || op === "contains") && !field.options.includes(value)) throw new DefinitionError(`${ownerName}: "${value}" is not one of the options of "${field.label}".`, target);
    if (!value) throw new DefinitionError(`${ownerName}: enter the value to compare with.`, target);
    return { field: fieldId, op, value };
  });
}

/**
 * Checks and cleans a definition from the builder. Throws DefinitionError naming the problem (and where it is).
 * Rules may only test fields that come before their target, and skips only jump forward, so logic can never loop.
 */
export function checkDefinition(raw: unknown): FormDefinition {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rawPages = Array.isArray(r.pages) ? r.pages : [];
  if (!rawPages.length) throw new DefinitionError("A form needs at least one page.");
  if (rawPages.length > LIMITS.pages) throw new DefinitionError(`A form can have at most ${LIMITS.pages} pages.`);
  const keys = new Set<string>();
  const ids = new Set<string>();
  const claim = (id: string, what: string) => {
    if (!ID.test(id) || ids.has(id)) throw new DefinitionError(`A ${what} has a missing or repeated id.`);
    ids.add(id);
  };
  let count = 0;
  const pages: Page[] = rawPages.map((p: Record<string, unknown>, pi: number) => {
    const id = str(p?.id, 30);
    claim(id, "page");
    const rawSections = Array.isArray(p?.sections) ? p.sections : [];
    if (!rawSections.length) throw new DefinitionError(`Page ${pi + 1} needs at least one section.`, id);
    if (rawSections.length > LIMITS.sectionsPerPage) throw new DefinitionError(`Page ${pi + 1} can have at most ${LIMITS.sectionsPerPage} sections.`, id);
    const sections: Section[] = rawSections.map((s: Record<string, unknown>) => {
      const sid = str(s?.id, 30);
      claim(sid, "section");
      const fields = (Array.isArray(s?.fields) ? s.fields : []).map((f: unknown) => {
        const field = cleanField(f, keys);
        claim(field.id, "field");
        return field;
      });
      count += fields.length;
      const section: Section = { id: sid, title: str(s?.title, 200), fields };
      const description = longStr(s?.description, 1000);
      if (description) section.description = description;
      return section;
    });
    return { id, title: str(p?.title, 120) || `Page ${pi + 1}`, sections, skips: [] };
  });
  if (count > LIMITS.fields) throw new DefinitionError(`A form can have at most ${LIMITS.fields} fields.`);
  const signatures = pages.flatMap((p) => p.sections.flatMap((s) => s.fields)).filter((f) => f.type === "signature");
  if (signatures.length > 1) throw new DefinitionError("A form can have one signature field.", signatures[1].id);

  // Order of every field, section and page, for "only earlier fields" and "only forward" checks.
  const order = new Map<string, number>();
  const pageIndex = new Map<string, number>();
  let n = 0;
  pages.forEach((p, pi) => {
    pageIndex.set(p.id, pi);
    order.set(p.id, n++);
    for (const s of p.sections) {
      order.set(s.id, n++);
      for (const f of s.fields) order.set(f.id, n++);
    }
  });
  const fieldsBefore = (position: number) => new Map(pages.flatMap((p) => p.sections.flatMap((s) => s.fields)).filter((f) => order.get(f.id)! < position).map((f) => [f.id, f]));
  const fieldById = new Map(pages.flatMap((p) => p.sections.flatMap((s) => s.fields)).map((f) => [f.id, f]));
  const sectionById = new Map(pages.flatMap((p) => p.sections).map((s) => [s.id, s]));

  // Skips: on each page, tested after the page; may only jump forward.
  rawPages.forEach((p: Record<string, unknown>, pi: number) => {
    const page = pages[pi];
    const list = Array.isArray(p?.skips) ? p.skips : [];
    const endOfPage = pi + 1 < pages.length ? order.get(pages[pi + 1].id)! : n;
    page.skips = list.map((k: Record<string, unknown>, ki: number) => {
      const rid = str(k?.id, 30);
      claim(rid, "rule");
      const goto = str(k?.goto, 30);
      const name = `Skip rule ${ki + 1} on "${page.title}"`;
      if (goto !== "end") {
        const to = pageIndex.get(goto);
        if (to === undefined) throw new DefinitionError(`${name} goes to a page that was deleted.`, page.id);
        if (to <= pi + 1) throw new DefinitionError(`${name} must jump forward past the next page (or to the end).`, page.id);
      }
      return { id: rid, match: k?.match === "any" ? "any" : "all", conditions: cleanConditions(k?.conditions, name, fieldsBefore(endOfPage), page.id), goto };
    });
  });

  const rawRules = Array.isArray(r.rules) ? r.rules : [];
  const totalSkips = pages.reduce((a, p) => a + p.skips.length, 0);
  if (rawRules.length + totalSkips > LIMITS.rules) throw new DefinitionError(`A form can have at most ${LIMITS.rules} logic rules.`);
  const rules: ShowRule[] = rawRules.map((x: Record<string, unknown>) => {
    const rid = str(x?.id, 30);
    claim(rid, "rule");
    const target = str(x?.target, 30);
    const owner = fieldById.get(target) ?? sectionById.get(target);
    if (!owner) throw new DefinitionError("A show/hide rule points at a field or section that was deleted.");
    const name = `The show/hide rule on "${("label" in owner ? owner.label : owner.title) || "a section"}"`;
    return { id: rid, target, action: x?.action === "hide" ? "hide" : "show", match: x?.match === "any" ? "any" : "all", conditions: cleanConditions(x?.conditions, name, fieldsBefore(order.get(target)!), target) };
  });
  return { version: 1, pages, rules };
}

/** A definition that can be published: at least one field that takes an answer. */
export function checkPublishable(def: FormDefinition) {
  if (!inputFields(def).length) throw new DefinitionError("Add at least one question before publishing.");
}
