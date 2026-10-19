import { parseRich, type Block, type Inline } from "./richtext.ts";

// The editor works on HTML in the browser and saves Markdown (see richtext.ts). These two functions are the bridge.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inlineToEditor(nodes: Inline[]): string {
  return nodes.map((n) => {
    switch (n.t) {
      case "text": return esc(n.v).replace(/\n/g, "<br>");
      case "token": return `<span data-token="${esc(n.name)}" contenteditable="false" class="re-chip">{{${esc(n.name)}}}</span>`;
      case "b": return `<b>${inlineToEditor(n.c)}</b>`;
      case "i": return `<i>${inlineToEditor(n.c)}</i>`;
      case "u": return `<u>${inlineToEditor(n.c)}</u>`;
      case "a": return `<a href="${esc(n.href)}">${inlineToEditor(n.c)}</a>`;
      case "img": return `<img src="${esc(n.src)}" alt="${esc(n.alt)}">`;
      case "span": return `<span style="${n.color ? `color:${n.color};` : ""}${n.size ? `font-size:${n.size}px;` : ""}">${inlineToEditor(n.c)}</span>`;
    }
  }).join("");
}

function blockToEditor(b: Block): string {
  switch (b.t) {
    case "h": return `<h${b.level}>${inlineToEditor(b.c)}</h${b.level}>`;
    case "p": return `<p>${inlineToEditor(b.c)}</p>`;
    case "ul": return `<ul>${b.items.map((i) => `<li>${inlineToEditor(i)}</li>`).join("")}</ul>`;
    case "ol": return `<ol>${b.items.map((i) => `<li>${inlineToEditor(i)}</li>`).join("")}</ol>`;
  }
}

/** Markdown to the HTML shown in the editor. Text is escaped; only the supported tags are produced. */
export function markdownToEditorHtml(md: string): string {
  const html = parseRich(md).map(blockToEditor).join("");
  return html || "<p><br></p>";
}

const HEX = /^#[0-9a-f]{6}$/i;
export function cssColorToHex(v: string): string | null {
  const t = v.trim().toLowerCase();
  if (HEX.test(t)) return t;
  const m = t.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)));
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

function wrapWith(text: string, mark: string): string {
  const lead = text.match(/^\s*/)?.[0] ?? "";
  const trail = text.match(/\s*$/)?.[0] ?? "";
  return `${lead}${mark}${text.trim()}${mark}${trail}`;
}

/** The editor's HTML back to Markdown. Anything outside the supported set is kept as its text. */
export function editorToMarkdown(root: HTMLElement): string {
  const inline = (node: Node): string => {
    if (node.nodeType === 3) return node.textContent ?? "";
    if (node.nodeType !== 1) return "";
    const el = node as HTMLElement;
    const kids = () => Array.from(el.childNodes).map(inline).join("");
    const tag = el.tagName.toLowerCase();
    if (tag === "br") return "\n";
    if (tag === "span" && el.dataset.token) return `{{${el.dataset.token}}}`;
    if (tag === "img") {
      const src = el.getAttribute("src") ?? "";
      return /^https:\/\//.test(src) ? `![${(el.getAttribute("alt") ?? "").replace(/[\]\n]/g, " ")}](${src})` : "";
    }
    const inner = kids();
    if (!inner.trim()) return inner;
    const wrap = (mark: string) => wrapWith(inner, mark);
    // A browser can put colour or size straight on a <b>, <i> or <u>.
    const styled = (core: string) => {
      const color = cssColorToHex(el.style.color);
      const px = /^(\d{2})px$/.exec(el.style.fontSize)?.[1];
      const size = px && Number(px) >= 10 && Number(px) <= 40 ? px : null;
      const opts = [color ? `color=${color}` : "", size ? `size=${size}` : ""].filter(Boolean).join(" ");
      return opts ? `[${core.replace(/\n/g, " ")}]{${opts}}` : core;
    };
    if (tag === "b" || tag === "strong") return styled(wrap("**"));
    if (tag === "i" || tag === "em") return styled(wrap("*"));
    if (tag === "u") return styled(wrap("++"));
    if (tag === "a") {
      const href = el.getAttribute("href") ?? "";
      return /^(https:\/\/|mailto:)/.test(href) ? `[${inner.replace(/\n/g, " ")}](${href})` : inner;
    }
    if (tag === "span" || tag === "font") {
      // A browser may write bold, italic and underline as styles on a span.
      const weight = el.style.fontWeight;
      const bold = weight === "bold" || Number(weight) >= 600;
      const italic = el.style.fontStyle === "italic";
      const underline = /underline/.test(el.style.textDecorationLine || el.style.textDecoration);
      let styled = inner;
      if (underline) styled = wrapWith(styled, "++");
      if (italic) styled = wrapWith(styled, "*");
      if (bold) styled = wrapWith(styled, "**");
      const color = cssColorToHex(el.style.color || el.getAttribute("color") || "");
      const px = /^(\d{2})px$/.exec(el.style.fontSize)?.[1];
      const size = px && Number(px) >= 10 && Number(px) <= 40 ? px : null;
      const opts = [color ? `color=${color}` : "", size ? `size=${size}` : ""].filter(Boolean).join(" ");
      return opts ? `[${styled.replace(/\n/g, " ")}]{${opts}}` : styled;
    }
    return inner;
  };
  const list = (el: HTMLElement, ordered: boolean) =>
    Array.from(el.children).filter((c) => c.tagName === "LI").map((li, i) => `${ordered ? `${i + 1}. ` : "- "}${inline(li).replace(/\n+/g, " ").trim()}`).join("\n");
  const out: string[] = [];
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === 3) { const t = (node.textContent ?? "").trim(); if (t) out.push(t); continue; }
    if (node.nodeType !== 1) continue;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === "ul" || tag === "ol") { const l = list(el, tag === "ol"); if (l) out.push(l); continue; }
    if (/^h[1-6]$/.test(tag)) { const t = inline(el).replace(/\n+/g, " ").trim(); if (t) out.push(`${tag === "h1" ? "#" : "##"} ${t}`); continue; }
    const t = inline(el).trim();
    if (t) out.push(t);
  }
  return out.join("\n\n");
}
