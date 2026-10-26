import { ValidationError } from "../commerce/validation.ts";

// The content of a page: a short list of blocks. Everything is plain data that is checked on the way in (an unknown block
// type or field is dropped, never kept), and rendered as plain text by the renderer. The one exception is the "html"
// block: the owner's own code, which is never put into the page itself. It runs inside a sandboxed frame with no access
// to the platform's origin (no cookies, no storage, no sign-in), so it cannot read or change anything on the platform.

export const MAX_SECTIONS = 60;
/** Kept for the old name; a page holds at most this many sections. */
export const MAX_BLOCKS = MAX_SECTIONS;
export const MAX_ROWS = 20;
/** Elements in one column, and on the whole page. */
export const MAX_CHILDREN = 20;
export const MAX_ELEMENTS = 400;
export const MAX_TEXT = 5000;
export const MAX_HTML = 60000;
export const SECTION_TONES = ["plain", "soft", "accent", "dark"] as const;
export type SectionTone = (typeof SECTION_TONES)[number];

export type HeadingBlock = { id: string; type: "heading"; text: string; level: 1 | 2 | 3; align: "left" | "center" };
export type TextBlock = { id: string; type: "text"; text: string; align: "left" | "center" };
export type ImageBlock = { id: string; type: "image"; imageId: string; alt: string; size: "full" | "half" };
export type ButtonBlock = { id: string; type: "button"; label: string; href: string; style: "primary" | "secondary"; align: "left" | "center" };
/** A booking page of the office, by its link name (see Calendar → Appointment types). */
export type BookingBlock = { id: string; type: "booking"; slug: string; height: number };
/** One of the office's published forms, by its public id. */
export type FormBlock = { id: string; type: "form"; formId: string; height: number };
/** Custom HTML (with its own CSS and script) shown in a sandboxed frame. `height` is the starting height; the frame then fits its content. */
export type HtmlBlock = { id: string; type: "html"; code: string; height: number };
export type SpacerBlock = { id: string; type: "spacer"; size: "small" | "medium" | "large" };
export type DividerBlock = { id: string; type: "divider" };
export type LeafBlock = HeadingBlock | TextBlock | ImageBlock | ButtonBlock | BookingBlock | FormBlock | HtmlBlock | SpacerBlock | DividerBlock;
export const SECTION_PADS = ["none", "small", "medium", "large"] as const;
export const SECTION_WIDTHS = ["narrow", "wide", "full"] as const;
export const ROW_GAPS = ["small", "medium", "large"] as const;
/** How a row is split into columns: "2-1" is a wide column then a narrow one. */
export const LAYOUTS = { "1": [1], "1-1": [1, 1], "1-1-1": [1, 1, 1], "1-1-1-1": [1, 1, 1, 1], "2-1": [2, 1], "1-2": [1, 2] } as const;
export type LayoutKey = keyof typeof LAYOUTS;
export const LAYOUT_KEYS = Object.keys(LAYOUTS) as LayoutKey[];
export const LAYOUT_LABEL: Record<LayoutKey, string> = { "1": "1 column", "1-1": "2 columns", "1-1-1": "3 columns", "1-1-1-1": "4 columns", "2-1": "Wide + narrow", "1-2": "Narrow + wide" };

/** A column holds elements, top to bottom. */
export type ColumnBlock = { id: string; children: LeafBlock[] };
/** A row splits a section into side-by-side columns (they stack on a phone). */
export type RowBlock = { id: string; layout: LayoutKey; gap: (typeof ROW_GAPS)[number]; valign: "top" | "center"; columns: ColumnBlock[] };
/** A band of the page with its own background: sections hold rows, rows hold columns, columns hold elements. */
export type SectionBlock = { id: string; type: "section"; tone: SectionTone; pad: (typeof SECTION_PADS)[number]; width: (typeof SECTION_WIDTHS)[number]; rows: RowBlock[] };
/** A page is a list of sections. (Older pages stored loose elements and one-column sections; they are converted when read.) */
export type Block = SectionBlock;

export const LEAF_TYPES = ["heading", "text", "image", "button", "booking", "form", "html", "spacer", "divider"] as const;
export const BLOCK_LABEL: Record<LeafBlock["type"] | "section", string> = {
  section: "Section", heading: "Heading", text: "Text", image: "Image", button: "Button", booking: "Booking", form: "Form", html: "Custom HTML", spacer: "Space", divider: "Divider",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9_-]{6,40}$/;
const SLUG = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;
const FORM_ID = /^[A-Za-z0-9]{16}$/;

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, max) : "");
const line = (v: unknown, max: number) => text(v, max).replace(/\s+/g, " ").trim();
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback);
const idOf = (v: unknown, fresh: () => string) => (typeof v === "string" && ID.test(v) ? v : fresh());
const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

/**
 * Where a button may point: a web address (https), a page on the same site ("/about"), an email (mailto:) or a phone
 * number (tel:). Anything else (javascript:, data:, http:, a bare word) is refused.
 */
export function cleanHref(raw: unknown): string | null {
  const v = line(raw, 500);
  if (!v) return null;
  if (/^\/(?!\/)[A-Za-z0-9\-._~/?#=&%]*$/.test(v)) return v;
  if (/^mailto:[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/i.test(v)) return v;
  if (/^tel:\+?[0-9][0-9\-.() ]{4,24}$/i.test(v)) return v;
  try {
    const u = new URL(v);
    if (u.protocol === "https:" && u.hostname.includes(".") && !u.username && !u.password) return u.toString();
  } catch {
    // not a URL
  }
  return null;
}

let counter = 0;
const freshId = () => `b${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function leaf(raw: unknown, fresh: () => string): LeafBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const id = idOf(b.id, fresh);
  switch (b.type) {
    case "heading": {
      const t = line(b.text, 200);
      return t ? { id, type: "heading", text: t, level: clampInt(b.level, 1, 3, 2) as 1 | 2 | 3, align: oneOf(b.align, ["left", "center"], "left") } : null;
    }
    case "text": {
      const t = text(b.text, MAX_TEXT).trim();
      return t ? { id, type: "text", text: t, align: oneOf(b.align, ["left", "center"], "left") } : null;
    }
    case "image": {
      const imageId = typeof b.imageId === "string" && UUID.test(b.imageId) ? b.imageId.toLowerCase() : "";
      return imageId ? { id, type: "image", imageId, alt: line(b.alt, 200), size: oneOf(b.size, ["full", "half"], "full") } : null;
    }
    case "button": {
      const label = line(b.label, 60);
      const href = cleanHref(b.href);
      return label && href ? { id, type: "button", label, href, style: oneOf(b.style, ["primary", "secondary"], "primary"), align: oneOf(b.align, ["left", "center"], "left") } : null;
    }
    case "booking": {
      const slug = typeof b.slug === "string" ? b.slug.trim().toLowerCase() : "";
      return SLUG.test(slug) ? { id, type: "booking", slug, height: clampInt(b.height, 400, 1200, 760) } : null;
    }
    case "form": {
      const formId = typeof b.formId === "string" ? b.formId.trim() : "";
      return FORM_ID.test(formId) ? { id, type: "form", formId, height: clampInt(b.height, 400, 1600, 900) } : null;
    }
    case "html": {
      const code = text(b.code, MAX_HTML).trim();
      return code ? { id, type: "html", code, height: clampInt(b.height, 100, 2000, 400) } : null;
    }
    case "spacer":
      return { id, type: "spacer", size: oneOf(b.size, ["small", "medium", "large"], "medium") };
    case "divider":
      return { id, type: "divider" };
    default:
      return null;
  }
}

const cleanColumn = (raw: unknown, fresh: () => string, unique: (b: { id: string }) => void, count: { n: number }): ColumnBlock => {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const kids = Array.isArray(r.children) ? r.children : [];
  if (kids.length > MAX_CHILDREN) throw new ValidationError(`A column can hold at most ${MAX_CHILDREN} elements.`);
  const children = kids.map((c) => leaf(c, fresh)).filter((c): c is LeafBlock => c !== null);
  count.n += children.length;
  if (count.n > MAX_ELEMENTS) throw new ValidationError(`A page can have at most ${MAX_ELEMENTS} elements.`);
  children.forEach(unique);
  const col = { id: idOf(r.id, fresh), children };
  unique(col);
  return col;
};

function cleanRow(raw: unknown, fresh: () => string, unique: (b: { id: string }) => void, count: { n: number }): RowBlock {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const given = Array.isArray(r.columns) ? r.columns : [];
  const byCount: Record<number, LayoutKey> = { 1: "1", 2: "1-1", 3: "1-1-1", 4: "1-1-1-1" };
  const layout = typeof r.layout === "string" && r.layout in LAYOUTS ? (r.layout as LayoutKey) : byCount[Math.min(4, Math.max(1, given.length))];
  const want = LAYOUTS[layout].length;
  const columns = given.slice(0, want).map((c) => cleanColumn(c, fresh, unique, count));
  // Extra columns (a smaller layout) are folded into the last one so nothing is lost; missing ones start empty.
  for (const extra of given.slice(want)) {
    const e = cleanColumn(extra, fresh, unique, count);
    columns[want - 1].children.push(...e.children);
    if (columns[want - 1].children.length > MAX_CHILDREN) throw new ValidationError(`A column can hold at most ${MAX_CHILDREN} elements.`);
  }
  while (columns.length < want) columns.push(cleanColumn({}, fresh, unique, count));
  const row: RowBlock = { id: idOf(r.id, fresh), layout, gap: oneOf(r.gap, ROW_GAPS, "medium"), valign: oneOf(r.valign, ["top", "center"], "top"), columns };
  unique(row);
  return row;
}

/**
 * Turns whatever the editor sent (or an older page) into a clean list of sections: unknown types and fields are dropped,
 * text is trimmed and limited, links are checked, rows have the columns their layout calls for, and counts are capped.
 * Elements that would be empty (a heading with no words, a button with no safe link) are dropped rather than saved
 * half-made. Loose elements from the old editor are gathered into a section; one-column sections become one row.
 */
export function sanitizeBlocks(raw: unknown, fresh: () => string = freshId): Block[] {
  if (!Array.isArray(raw)) throw new ValidationError("The page content wasn't understood. Reload the page and try again.");
  if (raw.length > MAX_ELEMENTS) throw new ValidationError(`A page can have at most ${MAX_SECTIONS} sections.`);
  const seen = new Set<string>();
  const unique = (b: { id: string }) => {
    if (seen.has(b.id)) b.id = fresh();
    seen.add(b.id);
  };
  const count = { n: 0 };
  const out: Block[] = [];
  let loose: LeafBlock[] = [];
  const flush = () => {
    if (!loose.length) return;
    count.n += loose.length;
    if (count.n > MAX_ELEMENTS) throw new ValidationError(`A page can have at most ${MAX_ELEMENTS} elements.`);
    loose.forEach(unique);
    const col: ColumnBlock = { id: fresh(), children: loose };
    const row: RowBlock = { id: fresh(), layout: "1", gap: "medium", valign: "top", columns: [col] };
    const sec: SectionBlock = { id: fresh(), type: "section", tone: "plain", pad: "medium", width: "narrow", rows: [row] };
    [col, row, sec].forEach(unique);
    out.push(sec);
    loose = [];
  };
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const b = item as Record<string, unknown>;
    if (b.type === "section") {
      flush();
      let rowsRaw: unknown[];
      let legacy = false;
      if (Array.isArray(b.rows)) rowsRaw = b.rows;
      else {
        legacy = true;
        const children = Array.isArray(b.children) ? b.children : [];
        rowsRaw = children.length ? [{ layout: "1", columns: [{ children }] }] : [];
      }
      if (rowsRaw.length > MAX_ROWS) throw new ValidationError(`A section can hold at most ${MAX_ROWS} rows.`);
      const rows = rowsRaw.map((r) => cleanRow(r, fresh, unique, count));
      const sec: SectionBlock = {
        id: idOf(b.id, fresh), type: "section", tone: oneOf(b.tone, SECTION_TONES, "plain"),
        pad: oneOf(b.pad, SECTION_PADS, "medium"), width: oneOf(b.width, SECTION_WIDTHS, legacy ? "narrow" : "wide"), rows,
      };
      unique(sec);
      out.push(sec);
      if (out.length > MAX_SECTIONS) throw new ValidationError(`A page can have at most ${MAX_SECTIONS} sections.`);
      continue;
    }
    const l = leaf(item, fresh);
    if (l) loose.push(l);
  }
  flush();
  if (out.length > MAX_SECTIONS) throw new ValidationError(`A page can have at most ${MAX_SECTIONS} sections.`);
  return out;
}

/** Sections for showing a stored page (never throws: a page that can't be read shows nothing). Ids are stable between calls. */
export function sectionsOf(stored: unknown): Block[] {
  let i = 0;
  try {
    return sanitizeBlocks(stored ?? [], () => `gen${(i++).toString(36).padStart(4, "0")}`);
  } catch {
    return [];
  }
}

/** A starting element of each kind for the "Add" panel. Fresh ids are made by the caller. */
export function newElement(type: LeafBlock["type"], id: string): LeafBlock {
  switch (type) {
    case "heading": return { id, type, text: "Heading", level: 2, align: "left" };
    case "text": return { id, type, text: "Write something here.", align: "left" };
    case "image": return { id, type, imageId: "", alt: "", size: "full" };
    case "button": return { id, type, label: "Book now", href: "/", style: "primary", align: "left" };
    case "booking": return { id, type, slug: "", height: 760 };
    case "form": return { id, type, formId: "", height: 900 };
    case "html": return { id, type, code: "", height: 400 };
    case "spacer": return { id, type, size: "medium" };
    case "divider": return { id, type };
  }
}

/** An empty row for a layout. */
export function newRow(layout: LayoutKey, ids: () => string): RowBlock {
  return { id: ids(), layout, gap: "medium", valign: "top", columns: LAYOUTS[layout].map(() => ({ id: ids(), children: [] })) };
}

/** A new section with one empty row (one column, unless a layout is given). */
export function newSection(ids: () => string, layout: LayoutKey = "1"): SectionBlock {
  return { id: ids(), type: "section", tone: "plain", pad: "medium", width: "wide", rows: [newRow(layout, ids)] };
}

/** Every element on the page, in reading order. */
export function elementsOf(blocks: Block[]): LeafBlock[] {
  // A page saved before sections had rows is converted first, so every stored page can be read.
  const sections = (blocks as unknown[]).every((s) => s && typeof s === "object" && Array.isArray((s as { rows?: unknown }).rows)) ? blocks : sectionsOf(blocks);
  return sections.flatMap((s) => s.rows.flatMap((r) => r.columns.flatMap((c) => c.children)));
}

/** Image ids a page uses, so the renderer can look them all up at once. */
export function imageIdsOf(blocks: Block[]): string[] {
  const ids = new Set<string>();
  for (const e of elementsOf(blocks)) if (e.type === "image") ids.add(e.imageId);
  return [...ids];
}

/** True when the page would show nothing. */
export const isEmptyPage = (blocks: Block[]) => elementsOf(blocks).every((e) => e.type === "spacer" || e.type === "divider");
