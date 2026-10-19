import assert from "node:assert/strict";
import test from "node:test";
import { cleanHref, imageIdsOf, isEmptyPage, MAX_BLOCKS, MAX_CHILDREN, newBlock, sanitizeBlocks } from "../lib/sites/blocks.ts";

let n = 0;
const fresh = () => `id${++n}abcd`;
const IMG = "11111111-1111-4111-8111-111111111111";

test("links: https, same-site paths, mailto and tel only", () => {
  assert.equal(cleanHref("https://example.com/a?b=1"), "https://example.com/a?b=1");
  assert.equal(cleanHref("/about"), "/about");
  assert.equal(cleanHref("/"), "/");
  assert.equal(cleanHref("mailto:office@example.com"), "mailto:office@example.com");
  assert.equal(cleanHref("tel:+1 (555) 010-0000"), "tel:+1 (555) 010-0000");
  for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "http://example.com", "//evil.com", "example.com", "https://u:p@example.com", "https://localhost", "vbscript:x", "", "  ", null, 5, "/a b<script>"]) assert.equal(cleanHref(bad), null, String(bad));
});

test("unknown types and fields are dropped; known ones are cleaned", () => {
  const out = sanitizeBlocks([
    { type: "script", src: "x" },
    { type: "html", html: "<script>alert(1)</script>" },
    { type: "heading", text: "  Welcome  \n to us ", level: 9, onclick: "x", style: "color:red" },
    { type: "text", text: "Hello\r\nworld\u0000", align: "right" },
    { type: "button", label: "Call", href: "tel:5550100000" },
    { type: "button", label: "Evil", href: "javascript:alert(1)" },
    "nope", null, 5,
  ], fresh);
  assert.deepEqual(out.map((b) => b.type), ["heading", "text", "button"]);
  assert.deepEqual(out[0], { id: out[0].id, type: "heading", text: "Welcome to us", level: 3, align: "left" });
  assert.equal((out[1] as { text: string }).text, "Hello\nworld");
  assert.equal((out[1] as { align: string }).align, "left");
  assert.ok(!("onclick" in out[0]) && !("style" in out[0]));
});

test("images need a real library id; booking needs a link name; forms a 16-character id", () => {
  const out = sanitizeBlocks([
    { type: "image", imageId: IMG, alt: "Our office", size: "half" },
    { type: "image", imageId: "https://evil.com/x.png" },
    { type: "image", imageId: "../../etc/passwd" },
    { type: "booking", slug: "intro-call", height: 99999 },
    { type: "booking", slug: "Bad Slug!" },
    { type: "form", formId: "Abcdefgh12345678", height: 10 },
    { type: "form", formId: "short" },
  ], fresh);
  assert.deepEqual(out.map((b) => b.type), ["image", "booking", "form"]);
  assert.equal((out[1] as { height: number }).height, 1200);
  assert.equal((out[2] as { height: number }).height, 400);
  assert.deepEqual(imageIdsOf(out), [IMG]);
});

test("sections hold leaf blocks only and do not nest", () => {
  const out = sanitizeBlocks([{ type: "section", tone: "dark", children: [{ type: "heading", text: "Hi" }, { type: "section", children: [{ type: "text", text: "inner" }] }, { type: "image", imageId: IMG }] }, { type: "section", tone: "neon", children: "x" }], fresh);
  assert.equal(out.length, 2);
  const s = out[0] as { tone: string; children: { type: string }[] };
  assert.equal(s.tone, "dark");
  assert.deepEqual(s.children.map((c) => c.type), ["heading", "image"]);
  assert.equal((out[1] as { tone: string; children: unknown[] }).tone, "plain");
  assert.deepEqual(imageIdsOf(out), [IMG]);
});

test("limits: block count, section size, duplicate ids", () => {
  assert.throws(() => sanitizeBlocks(Array.from({ length: MAX_BLOCKS + 1 }, () => ({ type: "divider" })), fresh), /at most 60/);
  assert.throws(() => sanitizeBlocks([{ type: "section", children: Array.from({ length: MAX_CHILDREN + 1 }, () => ({ type: "divider" })) }], fresh), /at most 12/);
  assert.throws(() => sanitizeBlocks("nope" as never), /wasn't understood/);
  const dup = sanitizeBlocks([{ id: "sameid1", type: "divider" }, { id: "sameid1", type: "divider" }], fresh);
  assert.notEqual(dup[0].id, dup[1].id);
  const long = sanitizeBlocks([{ type: "text", text: "x".repeat(9000) }], fresh);
  assert.equal((long[0] as { text: string }).text.length, 5000);
});

test("new blocks of every kind pass their own checks (when filled in)", () => {
  assert.equal(newBlock("section", "abc123").type, "section");
  assert.ok(sanitizeBlocks([newBlock("heading", "abc123"), newBlock("text", "abc124"), newBlock("button", "abc125"), newBlock("spacer", "abc126"), newBlock("divider", "abc127")], fresh).length === 5);
  assert.equal(sanitizeBlocks([newBlock("image", "abc128"), newBlock("booking", "abc129"), newBlock("form", "abc130")], fresh).length, 0, "blank image, booking and form blocks are not saved until chosen");
});

test("a page with only spacing is empty", () => {
  assert.equal(isEmptyPage([]), true);
  assert.equal(isEmptyPage(sanitizeBlocks([{ type: "spacer" }, { type: "section", children: [] }], fresh)), true);
  assert.equal(isEmptyPage(sanitizeBlocks([{ type: "text", text: "hi" }], fresh)), false);
});
