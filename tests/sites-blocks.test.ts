import assert from "node:assert/strict";
import test from "node:test";
import { cleanHref, elementsOf, imageIdsOf, isEmptyPage, LAYOUTS, MAX_CHILDREN, MAX_ELEMENTS, MAX_HTML, MAX_ROWS, MAX_SECTIONS, newElement, newRow, newSection, sanitizeBlocks, sectionsOf, type LeafBlock } from "../lib/sites/blocks.ts";

let n = 0;
const fresh = () => `id${++n}abcd`;
const IMG = "11111111-1111-4111-8111-111111111111";
const els = (raw: unknown): LeafBlock[] => elementsOf(sanitizeBlocks(raw, fresh));

test("links: https, same-site paths, mailto and tel only", () => {
  assert.equal(cleanHref("https://example.com/a?b=1"), "https://example.com/a?b=1");
  assert.equal(cleanHref("/about"), "/about");
  assert.equal(cleanHref("/"), "/");
  assert.equal(cleanHref("mailto:office@example.com"), "mailto:office@example.com");
  assert.equal(cleanHref("tel:+1 (555) 010-0000"), "tel:+1 (555) 010-0000");
  for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "http://example.com", "//evil.com", "example.com", "https://u:p@example.com", "https://localhost", "vbscript:x", "", "  ", null, 5, "/a b<script>"]) assert.equal(cleanHref(bad), null, String(bad));
});

test("unknown types and fields are dropped; known ones are cleaned", () => {
  const out = els([
    { type: "script", src: "x" },
    { type: "html", html: "<script>alert(1)</script>" },
    { type: "heading", text: "  Welcome  \n to us ", level: 9, onclick: "x", style: "color:red" },
    { type: "text", text: "Hello\r\nworld\u0000", align: "right" },
    { type: "button", label: "Call", href: "tel:5550100000" },
    { type: "button", label: "Evil", href: "javascript:alert(1)" },
    "nope", null, 5,
  ]);
  assert.deepEqual(out.map((b) => b.type), ["heading", "text", "button"]);
  assert.deepEqual(out[0], { id: out[0].id, type: "heading", text: "Welcome to us", level: 3, align: "left" });
  assert.equal((out[1] as { text: string }).text, "Hello\nworld");
  assert.equal((out[1] as { align: string }).align, "left");
  assert.ok(!("onclick" in out[0]) && !("style" in out[0]));
});

test("images need a real library id; booking needs a link name; forms a 16-character id", () => {
  const blocks = sanitizeBlocks([
    { type: "image", imageId: IMG, alt: "Our office", size: "half" },
    { type: "image", imageId: "https://evil.com/x.png" },
    { type: "image", imageId: "../../etc/passwd" },
    { type: "booking", slug: "intro-call", height: 99999 },
    { type: "booking", slug: "Bad Slug!" },
    { type: "form", formId: "Abcdefgh12345678", height: 10 },
    { type: "form", formId: "short" },
  ], fresh);
  const out = elementsOf(blocks);
  assert.deepEqual(out.map((b) => b.type), ["image", "booking", "form"]);
  assert.equal((out[1] as { height: number }).height, 1200);
  assert.equal((out[2] as { height: number }).height, 400);
  assert.deepEqual(imageIdsOf(blocks), [IMG]);
});

test("a page is sections > rows > columns > elements, and rows get the columns their layout calls for", () => {
  const [s] = sanitizeBlocks([{ type: "section", tone: "dark", pad: "large", width: "full", rows: [
    { layout: "1-1-1", gap: "large", valign: "center", columns: [{ children: [{ type: "heading", text: "A" }] }, { children: [{ type: "text", text: "B" }] }] },
    { layout: "weird", columns: [{ children: [{ type: "text", text: "x" }] }, { children: [{ type: "text", text: "y" }] }] },
    { layout: "1", columns: [{ children: [{ type: "text", text: "p" }] }, { children: [{ type: "text", text: "q" }] }] },
  ] }], fresh);
  assert.deepEqual([s.tone, s.pad, s.width], ["dark", "large", "full"]);
  assert.deepEqual(s.rows.map((r) => [r.layout, r.columns.length]), [["1-1-1", 3], ["1-1", 2], ["1", 1]]);
  assert.equal(s.rows[0].gap, "large");
  assert.equal(s.rows[0].valign, "center");
  assert.equal(s.rows[0].columns[2].children.length, 0, "a missing column starts empty");
  assert.deepEqual(s.rows[2].columns[0].children.map((c) => (c as { text: string }).text), ["p", "q"], "extra columns are folded into the last one, not lost");
});

test("older pages convert: loose elements are gathered into one section, one-column sections become one row", () => {
  const out = sanitizeBlocks([
    { type: "heading", text: "Hi" }, { type: "text", text: "there" },
    { type: "section", tone: "soft", children: [{ type: "text", text: "inside" }, { type: "section", children: [{ type: "text", text: "nested" }] }, { type: "image", imageId: IMG }] },
    { type: "section", tone: "neon", children: "x" },
  ], fresh);
  assert.equal(out.length, 3);
  assert.deepEqual([out[0].tone, out[0].width, out[0].rows.length, out[0].rows[0].columns[0].children.map((c) => c.type)], ["plain", "narrow", 1, ["heading", "text"]]);
  assert.equal(out[1].tone, "soft");
  assert.deepEqual(out[1].rows[0].columns[0].children.map((c) => c.type), ["text", "image"], "sections do not nest");
  assert.equal(out[2].tone, "plain");
  assert.equal(out[2].rows.length, 0);
  assert.deepEqual(imageIdsOf(out), [IMG]);
  assert.deepEqual(sectionsOf(out), sanitizeBlocks(out), "a converted page is stable");
});

test("limits: sections, rows, elements per column and on the page, duplicate ids", () => {
  assert.throws(() => sanitizeBlocks(Array.from({ length: MAX_SECTIONS + 1 }, () => ({ type: "section", rows: [] })), fresh), /at most 60 sections/);
  assert.throws(() => sanitizeBlocks([{ type: "section", rows: Array.from({ length: MAX_ROWS + 1 }, () => ({ layout: "1", columns: [] })) }], fresh), new RegExp(`at most ${MAX_ROWS} rows`));
  assert.throws(() => sanitizeBlocks([{ type: "section", rows: [{ layout: "1", columns: [{ children: Array.from({ length: MAX_CHILDREN + 1 }, () => ({ type: "divider" })) }] }] }], fresh), new RegExp(`at most ${MAX_CHILDREN} elements`));
  const wide = { type: "section", rows: Array.from({ length: MAX_ROWS }, () => ({ layout: "1-1-1-1", columns: Array.from({ length: 4 }, () => ({ children: Array.from({ length: 6 }, () => ({ type: "divider" })) })) })) };
  assert.throws(() => sanitizeBlocks([wide, wide], fresh), new RegExp(`at most ${MAX_ELEMENTS} elements`));
  assert.throws(() => sanitizeBlocks("nope" as never), /wasn't understood/);
  const dup = elementsOf(sanitizeBlocks([{ id: "sameid1", type: "divider" }, { id: "sameid1", type: "divider" }], fresh));
  assert.notEqual(dup[0].id, dup[1].id);
  const long = els([{ type: "text", text: "x".repeat(9000) }]);
  assert.equal((long[0] as { text: string }).text.length, 5000);
});

test("new elements, rows and sections pass their own checks (when filled in)", () => {
  const ids = fresh;
  const section = newSection(ids, "2-1");
  assert.deepEqual([section.rows.length, section.rows[0].columns.length], [1, 2]);
  assert.equal(newRow("1-1-1-1", ids).columns.length, LAYOUTS["1-1-1-1"].length);
  const filled = els([newElement("heading", "abc123"), newElement("text", "abc124"), newElement("button", "abc125"), newElement("spacer", "abc126"), newElement("divider", "abc127")]);
  assert.equal(filled.length, 5);
  assert.equal(els([newElement("image", "abc128"), newElement("booking", "abc129"), newElement("form", "abc130")]).length, 0, "blank image, booking and form elements are not saved until chosen");
  assert.equal(sanitizeBlocks([section], fresh)[0].rows[0].columns.length, 2, "empty sections and columns are kept");
});

test("a page with only spacing is empty", () => {
  assert.equal(isEmptyPage([]), true);
  assert.equal(isEmptyPage(sanitizeBlocks([{ type: "spacer" }, { type: "section", children: [] }], fresh)), true);
  assert.equal(isEmptyPage(sanitizeBlocks([{ type: "text", text: "hi" }], fresh)), false);
});

test("custom html element: kept as written, limited, never empty, height clamped", () => {
  const code = '<div style="color:red">Hi</div>\n<script>console.log(1)</script>';
  const [b] = els([{ type: "html", code, height: 50 }]) as { code: string; height: number }[];
  assert.equal(b.code, code, "the owner's code is stored as written (it only ever runs in the sandboxed frame)");
  assert.equal(b.height, 100);
  assert.equal(els([{ type: "html", code: "   " }]).length, 0);
  assert.equal((els([{ type: "html", code: "x".repeat(70000), height: 9999 }])[0] as { code: string }).code.length, MAX_HTML);
  assert.equal(els([newElement("html", "abc131")]).length, 0, "a blank html element is not saved");
  assert.equal(els([{ type: "section", children: [{ type: "html", code: "<p>x</p>" }] }]).length, 1);
});

test("pages saved before sections had rows can still be read (images, emptiness)", () => {
  const old = [{ id: "h1aaaa", type: "heading", text: "Hi" }, { id: "s1aaaa", type: "section", tone: "soft", children: [{ id: "i1aaaa", type: "image", imageId: IMG }] }] as never;
  assert.deepEqual(imageIdsOf(old), [IMG]);
  assert.equal(isEmptyPage(old), false);
  assert.equal(isEmptyPage([{ type: "section", children: [] }] as never), true);
});
