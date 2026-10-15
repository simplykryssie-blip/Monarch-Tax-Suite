// A small, safe rich-text format used by email templates and form paragraphs. It is stored as Markdown, so a
// template stays readable text. Only the syntax below is understood; everything else is plain text, and nothing is ever
// passed through as HTML.
//
//   # Heading            ## Subheading         (blank line between blocks)
//   - bullet             1. numbered
//   **bold**   *italic*   ++underline++
//   [text](https://link)      ![alt](https://picture)
//   [coloured text]{color=#b00020 size=18}    (colour as #rrggbb, size 10 to 40 px)
//   {{placeholder}}      (email templates only; filled in per recipient)

export type Inline =
  | { t: "text"; v: string }
  | { t: "token"; name: string }
  | { t: "b" | "i" | "u"; c: Inline[] }
  | { t: "a"; href: string; c: Inline[] }
  | { t: "img"; src: string; alt: string }
  | { t: "span"; color?: string; size?: number; c: Inline[] };

export type Block =
  | { t: "h"; level: 1 | 2; c: Inline[] }
  | { t: "p"; c: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; items: Inline[][] };

export const SIZE_MIN = 10;
export const SIZE_MAX = 40;
const URL_CHARS = "[^\\s<>\"'()*+\\\\]+";
const PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "img", re: new RegExp(`!\\[([^\\]]*)\\]\\((https://${URL_CHARS})\\)`) },
  { kind: "link", re: new RegExp(`\\[([^\\]]+)\\]\\(((?:https://|mailto:)${URL_CHARS})\\)`) },
  { kind: "span", re: /\[([^\]]+)\]\{([^}]*)\}/ },
  { kind: "b", re: /\*\*(.+?)\*\*/ },
  { kind: "u", re: /\+\+(.+?)\+\+/ },
  { kind: "i", re: /\*(?!\*)(.+?)\*/ },
  { kind: "token", re: /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/ },
];

export const isHexColor = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

function spanOptions(raw: string): { color?: string; size?: number } {
  const out: { color?: string; size?: number } = {};
  for (const part of raw.split(/\s+/)) {
    const [k, v = ""] = part.split("=");
    if (k === "color" && isHexColor(v)) out.color = v.toLowerCase();
    if (k === "size" && /^\d{2}$/.test(v) && Number(v) >= SIZE_MIN && Number(v) <= SIZE_MAX) out.size = Number(v);
  }
  return out;
}

export function parseInline(s: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let rest = s;
  while (rest) {
    let best: { kind: string; m: RegExpExecArray } | null = null;
    for (const p of PATTERNS) {
      const m = p.re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { kind: p.kind, m };
    }
    if (!best) { out.push({ t: "text", v: rest }); break; }
    const { kind, m } = best;
    if (m.index > 0) out.push({ t: "text", v: rest.slice(0, m.index) });
    const inner = (text: string) => (depth < 6 ? parseInline(text, depth + 1) : [{ t: "text" as const, v: text }]);
    if (kind === "img") out.push({ t: "img", alt: m[1], src: m[2] });
    else if (kind === "link") out.push({ t: "a", href: m[2], c: inner(m[1]) });
    else if (kind === "span") {
      const o = spanOptions(m[2]);
      out.push(o.color || o.size ? { t: "span", ...o, c: inner(m[1]) } : { t: "text", v: m[0] });
    } else if (kind === "token") out.push({ t: "token", name: m[1] });
    else out.push({ t: kind as "b" | "i" | "u", c: inner(m[1]) });
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

const LIST_ITEM = /^(?:[-*]\s+|\d+[.)]\s+)/;

export function parseRich(md: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of md.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    const block = raw.trim();
    if (!block) continue;
    const heading = block.match(/^(#{1,2})\s+([^\n]*)$/);
    if (heading) { blocks.push({ t: "h", level: heading[1].length === 1 ? 1 : 2, c: parseInline(heading[2]) }); continue; }
    const lines = block.split("\n");
    if (lines.every((l) => /^[-*]\s+/.test(l))) { blocks.push({ t: "ul", items: lines.map((l) => parseInline(l.replace(LIST_ITEM, ""))) }); continue; }
    if (lines.every((l) => /^\d+[.)]\s+/.test(l))) { blocks.push({ t: "ol", items: lines.map((l) => parseInline(l.replace(LIST_ITEM, ""))) }); continue; }
    blocks.push({ t: "p", c: parseInline(block) });
  }
  return blocks;
}

// ---------------------------------------------------------------- plain text

export function inlineText(nodes: Inline[], values: Record<string, string> = {}): string {
  return nodes.map((n) => {
    switch (n.t) {
      case "text": return n.v;
      case "token": return values[n.name] ?? "";
      case "img": return n.alt ? `[${n.alt}]` : "";
      case "a": { const label = inlineText(n.c, values); return label === n.href ? label : `${label} (${n.href})`; }
      default: return inlineText(n.c, values);
    }
  }).join("");
}

export function richToText(blocks: Block[], values: Record<string, string> = {}): string {
  return blocks.map((b) => {
    if (b.t === "ul") return b.items.map((i) => `- ${inlineText(i, values)}`).join("\n");
    if (b.t === "ol") return b.items.map((i, n) => `${n + 1}. ${inlineText(i, values)}`).join("\n");
    return inlineText(b.c, values);
  }).join("\n\n");
}

// ---------------------------------------------------------------- HTML (email)

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** HTML for email. Placeholder values are escaped and inserted last, so a value can never add formatting or links. */
export function inlineHtml(nodes: Inline[], value: (name: string) => string): string {
  return nodes.map((n) => {
    switch (n.t) {
      case "text": return esc(n.v).replace(/\n/g, "<br>");
      case "token": return esc(value(n.name)).replace(/\n/g, "<br>");
      case "b": return `<strong>${inlineHtml(n.c, value)}</strong>`;
      case "i": return `<em>${inlineHtml(n.c, value)}</em>`;
      case "u": return `<u>${inlineHtml(n.c, value)}</u>`;
      case "a": return `<a href="${esc(n.href)}" style="color:#7a5c00">${inlineHtml(n.c, value)}</a>`;
      case "img": return `<img src="${esc(n.src)}" alt="${esc(n.alt)}" style="max-width:100%;height:auto;border:0;display:block;margin:8px 0">`;
      case "span": return `<span style="${n.color ? `color:${n.color};` : ""}${n.size ? `font-size:${n.size}px;` : ""}">${inlineHtml(n.c, value)}</span>`;
    }
  }).join("");
}

export function blockHtml(b: Block, value: (name: string) => string): string {
  switch (b.t) {
    case "h": return b.level === 1
      ? `<h2 style="font-size:20px;margin:0 0 12px;color:#111">${inlineHtml(b.c, value)}</h2>`
      : `<h3 style="font-size:17px;margin:0 0 10px;color:#111">${inlineHtml(b.c, value)}</h3>`;
    case "ul": return `<ul style="margin:0 0 14px;padding-left:22px;line-height:1.6">${b.items.map((i) => `<li>${inlineHtml(i, value)}</li>`).join("")}</ul>`;
    case "ol": return `<ol style="margin:0 0 14px;padding-left:22px;line-height:1.6">${b.items.map((i) => `<li>${inlineHtml(i, value)}</li>`).join("")}</ol>`;
    case "p": return `<p style="margin:0 0 14px;line-height:1.6">${inlineHtml(b.c, value)}</p>`;
  }
}

/** Placeholder names used anywhere in the blocks. */
export function tokensIn(blocks: Block[]): string[] {
  const found = new Set<string>();
  const walk = (nodes: Inline[]) => { for (const n of nodes) { if (n.t === "token") found.add(n.name); else if ("c" in n) walk(n.c); } };
  for (const b of blocks) { if (b.t === "ul" || b.t === "ol") b.items.forEach(walk); else walk(b.c); }
  return [...found];
}
