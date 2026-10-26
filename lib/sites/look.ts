// The design controls of a page: colours, type, spacing, borders and shadows for an element, a column, a row or a section, and
// whether it shows on a computer or a phone. Everything is plain data checked on the way in (a bad colour or an out-of-range
// number is dropped, never kept) and turned into inline CSS by `lookCss`, so there is no free-form CSS anywhere.

export type Look = {
  color?: string; bg?: string;
  size?: number; weight?: 400 | 500 | 600 | 700 | 800; italic?: boolean; upper?: boolean; spacing?: number; line?: number;
  align?: "left" | "center" | "right";
  padT?: number; padR?: number; padB?: number; padL?: number; marT?: number; marB?: number;
  radius?: number; borderW?: number; borderColor?: string; shadow?: "sm" | "md" | "lg";
  maxW?: number;
  hideDesktop?: boolean; hideMobile?: boolean;
};

export const SHADOWS = { sm: "0 1px 3px rgba(0,0,0,.14)", md: "0 6px 18px rgba(0,0,0,.14)", lg: "0 16px 40px rgba(0,0,0,.2)" } as const;
export const WEIGHTS = [400, 500, 600, 700, 800] as const;

const HEX = /^#[0-9a-f]{6}$/i;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const color = (v: unknown) => {
  if (typeof v !== "string") return undefined;
  const t = v.trim().toLowerCase();
  if (HEX.test(t)) return t;
  return /^#[0-9a-f]{3}$/.test(t) ? `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}` : undefined;
};
const num = (v: unknown, min: number, max: number): number | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 10) / 10)) : undefined;
};
const flag = (v: unknown) => (v === true || v === "true" || v === "on" ? true : undefined);

export function cleanLook(raw: unknown): Look {
  const r = obj(raw);
  const out: Look = {};
  const set = <K extends keyof Look>(k: K, v: Look[K] | undefined) => { if (v !== undefined) out[k] = v; };
  set("color", color(r.color)); set("bg", color(r.bg));
  set("size", num(r.size, 10, 120)); set("spacing", num(r.spacing, -2, 12)); set("line", num(r.line, 0.9, 2.6));
  const w = num(r.weight, 400, 800);
  if (w !== undefined && (WEIGHTS as readonly number[]).includes(Math.round(w / 100) * 100)) set("weight", (Math.round(w / 100) * 100) as Look["weight"]);
  set("italic", flag(r.italic)); set("upper", flag(r.upper));
  if (r.align === "left" || r.align === "center" || r.align === "right") out.align = r.align;
  for (const k of ["padT", "padR", "padB", "padL"] as const) set(k, num(r[k], 0, 240));
  for (const k of ["marT", "marB"] as const) set(k, num(r[k], 0, 240));
  set("radius", num(r.radius, 0, 80)); set("borderW", num(r.borderW, 0, 12)); set("borderColor", color(r.borderColor));
  if (r.shadow === "sm" || r.shadow === "md" || r.shadow === "lg") out.shadow = r.shadow;
  set("maxW", num(r.maxW, 120, 1400));
  set("hideDesktop", flag(r.hideDesktop)); set("hideMobile", flag(r.hideMobile));
  return out;
}

/** The inline CSS a look turns into. Spacing is in pixels; nothing here can reach outside its own box. */
export function lookCss(look: Look | undefined, opts: { text?: boolean } = {}): Record<string, string | number> {
  const l = look ?? {};
  const css: Record<string, string | number> = {};
  if (l.bg) css.background = l.bg;
  if (l.color) css.color = l.color;
  if (opts.text !== false) {
    if (l.size) css.fontSize = `${l.size}px`;
    if (l.weight) css.fontWeight = l.weight;
    if (l.italic) css.fontStyle = "italic";
    if (l.upper) css.textTransform = "uppercase";
    if (l.spacing !== undefined) css.letterSpacing = `${l.spacing}px`;
    if (l.line) css.lineHeight = l.line;
    if (l.align) css.textAlign = l.align;
  }
  if (l.padT !== undefined) css.paddingTop = `${l.padT}px`;
  if (l.padR !== undefined) css.paddingRight = `${l.padR}px`;
  if (l.padB !== undefined) css.paddingBottom = `${l.padB}px`;
  if (l.padL !== undefined) css.paddingLeft = `${l.padL}px`;
  if (l.marT !== undefined) css.marginTop = `${l.marT}px`;
  if (l.marB !== undefined) css.marginBottom = `${l.marB}px`;
  if (l.radius !== undefined) css.borderRadius = `${l.radius}px`;
  if (l.borderW) { css.borderWidth = `${l.borderW}px`; css.borderStyle = "solid"; css.borderColor = l.borderColor ?? "#d9d4c7"; }
  if (l.shadow) css.boxShadow = SHADOWS[l.shadow];
  if (l.maxW) { css.maxWidth = `${l.maxW}px`; css.marginLeft = css.marginLeft ?? "auto"; css.marginRight = "auto"; }
  return css;
}

/** Class names for showing or hiding on a computer or a phone. */
export const lookClasses = (look: Look | undefined) => [look?.hideDesktop ? "ws-hide-d" : "", look?.hideMobile ? "ws-hide-m" : ""].filter(Boolean).join(" ");
export const hasLook = (look: Look | undefined) => Boolean(look && Object.keys(look).length);
