import { ValidationError } from "../commerce/validation.ts";

// The content of a page: a short list of blocks. Everything is plain data that is checked on the way in (an unknown block
// type or field is dropped, never kept), and rendered as plain text by the renderer. The one exception is the "html"
// block: the owner's own code, which is never put into the page itself. It runs inside a sandboxed frame with no access
// to the platform's origin (no cookies, no storage, no sign-in), so it cannot read or change anything on the platform.

export const MAX_BLOCKS = 60;
export const MAX_CHILDREN = 12;
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
/** A band of the page with its own background, holding other blocks. Sections do not nest. */
export type SectionBlock = { id: string; type: "section"; tone: SectionTone; children: LeafBlock[] };
export type Block = LeafBlock | SectionBlock;

export const LEAF_TYPES = ["heading", "text", "image", "button", "booking", "form", "html", "spacer", "divider"] as const;
export const BLOCK_LABEL: Record<Block["type"], string> = {
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

/**
 * Turns whatever the editor sent into a clean block list: unknown types and fields are dropped, text is trimmed and
 * limited, links are checked, sections hold only leaf blocks (no nesting), and counts are capped. Blocks that would be
 * empty (a heading with no words, a button with no safe link) are dropped rather than saved half-made.
 */
export function sanitizeBlocks(raw: unknown, fresh: () => string = freshId): Block[] {
  if (!Array.isArray(raw)) throw new ValidationError("The page content wasn't understood. Reload the page and try again.");
  if (raw.length > MAX_BLOCKS) throw new ValidationError(`A page can have at most ${MAX_BLOCKS} blocks.`);
  const seen = new Set<string>();
  const unique = (b: Block): Block => {
    if (seen.has(b.id)) b.id = fresh();
    seen.add(b.id);
    return b;
  };
  const out: Block[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const b = item as Record<string, unknown>;
    if (b.type === "section") {
      const children = Array.isArray(b.children) ? b.children : [];
      if (children.length > MAX_CHILDREN) throw new ValidationError(`A section can hold at most ${MAX_CHILDREN} blocks.`);
      const kids = children.map((c) => leaf(c, fresh)).filter((c): c is LeafBlock => c !== null).map((c) => unique(c) as LeafBlock);
      out.push(unique({ id: idOf(b.id, fresh), type: "section", tone: oneOf(b.tone, SECTION_TONES, "plain"), children: kids }));
      continue;
    }
    const l = leaf(item, fresh);
    if (l) out.push(unique(l));
  }
  return out;
}

/** A starting block of each kind for the "Add" menu. Fresh ids are made by the caller. */
export function newBlock(type: Block["type"], id: string): Block {
  switch (type) {
    case "section": return { id, type, tone: "plain", children: [] };
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

/** Image ids a page uses, so the renderer can look them all up at once. */
export function imageIdsOf(blocks: Block[]): string[] {
  const ids = new Set<string>();
  for (const b of blocks) {
    if (b.type === "image") ids.add(b.imageId);
    if (b.type === "section") for (const c of b.children) if (c.type === "image") ids.add(c.imageId);
  }
  return [...ids];
}

/** True when the page would show nothing. */
export const isEmptyPage = (blocks: Block[]) => blocks.every((b) => b.type === "section" ? b.children.length === 0 : b.type === "spacer" || b.type === "divider");
