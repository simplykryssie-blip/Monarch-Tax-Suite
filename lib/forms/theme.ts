// How a public form looks: colours, font, logo and header image, plus optional custom CSS written by the office.
// Pure (no server imports) so the settings page, the public page and the tests share the same rules.
//
// Custom CSS is the office's own, but it is shown to its clients, so it is cleaned before use: every rule is scoped
// to the form (it can't restyle the admin or other pages), and anything that loads other pages' code, hides the
// form behind an overlay or reaches for scripts is dropped.

export const FORM_FONTS = {
  default: { label: "Default (matches the app)", stack: null },
  sans: { label: "Clean sans-serif (Helvetica / Arial)", stack: "Helvetica, Arial, sans-serif" },
  humanist: { label: "Friendly sans-serif (Trebuchet)", stack: "'Trebuchet MS', Verdana, sans-serif" },
  verdana: { label: "Wide and readable (Verdana)", stack: "Verdana, Geneva, sans-serif" },
  serif: { label: "Classic serif (Georgia)", stack: "Georgia, 'Times New Roman', serif" },
  palatino: { label: "Book serif (Palatino)", stack: "'Palatino Linotype', Palatino, Georgia, serif" },
  mono: { label: "Typewriter (Courier)", stack: "'Courier New', Courier, monospace" },
} as const;
export type FormFont = keyof typeof FORM_FONTS;

export type FormTheme = {
  /** Page background behind the form. */
  background: string | null;
  /** The form's own card. */
  card: string | null;
  text: string | null;
  /** The header band across the top (behind the logo / header image). */
  header: string | null;
  button: string | null;
  font: FormFont;
  /** Public image addresses (https), from an upload or pasted in. */
  logo_url: string | null;
  header_image_url: string | null;
  custom_css: string;
};

export const DEFAULT_THEME: FormTheme = { background: null, card: null, text: null, header: null, button: null, font: "default", logo_url: null, header_image_url: null, custom_css: "" };
export const MAX_CSS_CHARS = 10_000;

export class ThemeError extends Error {}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
function color(raw: unknown, what: string): string | null {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return null;
  if (!HEX.test(v)) throw new ThemeError(`${what} must be a colour like #1a2b3c.`);
  return v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase() : v.toLowerCase();
}
function imageUrl(raw: unknown, what: string): string | null {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return null;
  let u: URL;
  try { u = new URL(v); } catch { throw new ThemeError(`${what} must be a web address starting with https://.`); }
  if (u.protocol !== "https:" || v.length > 600 || /[\s"'()<>\\]/.test(v)) throw new ThemeError(`${what} must be a web address starting with https://.`);
  return u.toString();
}

/** Reads stored theme settings, filling defaults. Never throws; anything unusable falls back to the default. */
export function readTheme(raw: unknown): FormTheme {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const safe = <T,>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };
  return {
    background: safe(() => color(r.background, ""), null),
    card: safe(() => color(r.card, ""), null),
    text: safe(() => color(r.text, ""), null),
    header: safe(() => color(r.header, ""), null),
    button: safe(() => color(r.button, ""), null),
    font: typeof r.font === "string" && r.font in FORM_FONTS ? (r.font as FormFont) : "default",
    logo_url: safe(() => imageUrl(r.logo_url, ""), null),
    header_image_url: safe(() => imageUrl(r.header_image_url, ""), null),
    custom_css: typeof r.custom_css === "string" ? r.custom_css.slice(0, MAX_CSS_CHARS) : "",
  };
}

/** Checks theme settings from the settings page. Throws ThemeError naming the problem. */
export function checkTheme(raw: unknown): FormTheme {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const css = typeof r.custom_css === "string" ? r.custom_css.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim() : "";
  if (css.length > MAX_CSS_CHARS) throw new ThemeError(`Custom CSS can be at most ${MAX_CSS_CHARS.toLocaleString("en-US")} characters.`);
  const font = typeof r.font === "string" && r.font in FORM_FONTS ? (r.font as FormFont) : "default";
  return {
    background: color(r.background, "The page background"),
    card: color(r.card, "The form background"),
    text: color(r.text, "The text colour"),
    header: color(r.header, "The header colour"),
    button: color(r.button, "The button colour"),
    font,
    logo_url: imageUrl(r.logo_url, "The logo address"),
    header_image_url: imageUrl(r.header_image_url, "The header image address"),
    custom_css: css,
  };
}

/** Whether the theme changes anything. An unthemed form keeps the app's standard look. */
export const isThemed = (t: FormTheme): boolean =>
  !!(t.background || t.card || t.text || t.header || t.button || t.logo_url || t.header_image_url || t.custom_css) || t.font !== "default";

/** The class that scopes a form's custom CSS. */
export const THEME_SCOPE = "mf-themed";

/** Readable text (dark or light) on a given background, for the header and button labels. */
export function onColor(hex: string | null): string {
  const m = hex && /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#171714" : "#ffffff";
}

/** CSS custom properties for the wrapper element. */
export function themeVars(t: FormTheme): Record<string, string> {
  const v: Record<string, string> = {};
  if (t.background) v["--mf-bg"] = t.background;
  if (t.card) v["--mf-card"] = t.card;
  if (t.text) v["--mf-text"] = t.text;
  if (t.header) { v["--mf-header"] = t.header; v["--mf-on-header"] = onColor(t.header); }
  if (t.button) { v["--mf-button"] = t.button; v["--mf-on-button"] = onColor(t.button); }
  const stack = FORM_FONTS[t.font].stack;
  if (stack) v["--mf-font"] = stack;
  return v;
}

// ------------------------------------------------------------------------------------------------ custom CSS

const ALLOWED_AT = new Set(["media", "supports"]);
const SELECTOR_OK = /^[\w\s.#:>+~*,\-\[\]="'^$|()%]+$/;
const ROOT_TOKENS = /^(html|body|:root)\b/i;

/** A value is dropped when it could load code, hide the page, or escape its box. */
function badValue(prop: string, value: string): boolean {
  const v = value.toLowerCase();
  if (v.includes("\\") || v.includes("/*") || v.includes("<") || v.includes(">")) return true;
  if (/(expression|javascript:|vbscript:|data:text|data:application|behavior|binding|@import)/.test(v)) return true;
  if (/^(behavior|-moz-binding|-ms-behavior)$/.test(prop)) return true;
  if (prop === "position" && /\b(fixed|sticky)\b/.test(v)) return true;
  for (const m of v.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)) {
    const u = m[2].trim();
    if (!(/^https:\/\/[^\s'"()]+$/.test(u) || /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(u))) return true;
  }
  if (v.includes("url(") && !/url\(\s*(['"]?)[^'"()]*\1\s*\)/.test(v)) return true;
  if (/image-set|element\(|paint\(/.test(v)) return true;
  return false;
}

function cleanDeclarations(body: string): string {
  const out: string[] = [];
  // Split on `;` outside of parentheses and quotes (data: URLs and url("a;b") contain them).
  const parts: string[] = [];
  let depth = 0; let quote = ""; let cur = "";
  for (const ch of body) {
    if (quote) { cur += ch; if (ch === quote) quote = ""; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === ";" && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  parts.push(cur);
  for (const part of parts) {
    const i = part.indexOf(":");
    if (i < 1) continue;
    const prop = part.slice(0, i).trim().toLowerCase();
    const value = part.slice(i + 1).trim();
    if (!/^(--)?[a-z][a-z0-9-]*$/.test(prop) || !value) continue;
    if (badValue(prop, value)) continue;
    out.push(`${prop}:${value}`);
  }
  return out.join(";");
}

function scopeSelector(sel: string, scope: string): string | null {
  const s = sel.trim();
  if (!s || !SELECTOR_OK.test(s) || s.includes("\\") || /[<>]\s*[<>]/.test(s)) return null;
  if (ROOT_TOKENS.test(s)) return `${scope}${s.replace(ROOT_TOKENS, "")}`;
  return `${scope} ${s}`;
}

function scopeBlock(css: string, scope: string, depth: number): string {
  const out: string[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) break;
    const head = css.slice(i, open).trim();
    // Find the matching close brace.
    let level = 1; let j = open + 1;
    while (j < css.length && level > 0) { if (css[j] === "{") level++; else if (css[j] === "}") level--; j++; }
    const body = css.slice(open + 1, level === 0 ? j - 1 : j);
    i = j;
    if (head.startsWith("@")) {
      const name = /^@([a-z-]+)/i.exec(head)?.[1]?.toLowerCase() ?? "";
      if (!ALLOWED_AT.has(name) || depth > 1 || !/^@[a-z-]+\s*[\w\s:()\-,.>=<%]*$/i.test(head) || /[<]/.test(head)) continue;
      const inner = scopeBlock(body, scope, depth + 1);
      if (inner) out.push(`${head}{${inner}}`);
      continue;
    }
    const selectors = head.split(",").map((s) => scopeSelector(s, scope));
    if (selectors.some((s) => s === null)) continue;
    const decl = cleanDeclarations(body);
    if (decl) out.push(`${(selectors as string[]).join(",")}{${decl}}`);
  }
  return out.join("\n");
}

/**
 * Cleans an office's custom CSS and scopes every rule to the form: `body` and `html` mean the form's page, and any
 * other selector only matches inside it. Imports, fonts from other sites, scripts, fixed overlays and anything
 * unreadable are dropped, rule by rule.
 */
export function sanitizeCss(raw: string, scope = `.${THEME_SCOPE}`): string {
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/@(import|charset|namespace)\b[^;{}]*;?/gi, " ").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").slice(0, MAX_CSS_CHARS);
  return scopeBlock(css, scope, 0).replace(/<\/?style/gi, "");
}
