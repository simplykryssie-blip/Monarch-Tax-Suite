import test from "node:test";
import assert from "node:assert/strict";
import { holdsHtml, isHtmlOnly, widthOf, type SectionBlock } from "../lib/sites/blocks.ts";
import { fixScreenUnits } from "../lib/sites/html-frame.ts";

const section = (width: SectionBlock["width"], leaves: { type: string }[]) => ({ id: "s", type: "section", tone: "plain", pad: "medium", width, rows: [{ id: "r", layout: "one", gap: "medium", valign: "top", columns: [{ id: "c", children: leaves.map((l, i) => ({ id: String(i), ...l })) }] }] }) as unknown as SectionBlock;

test("a section with pasted HTML is always shown edge to edge; other sections keep the chosen width", () => {
  const html = section("narrow", [{ type: "html" }]);
  assert.equal(widthOf(html), "full");
  assert.ok(isHtmlOnly(html));
  const mixed = section("narrow", [{ type: "html" }, { type: "heading" }]);
  assert.equal(widthOf(mixed), "full");
  assert.ok(holdsHtml(mixed) && !isHtmlOnly(mixed));
  const text = section("narrow", [{ type: "heading" }]);
  assert.equal(widthOf(text), "narrow");
  assert.equal(widthOf(section("wide", [])), "wide");
});

test("screen-height units in pasted code become fixed heights so the frame cannot grow forever", () => {
  assert.equal(fixScreenUnits("a{min-height:100vh}b{height: 50vh}c{height:80dvh}"), "a{min-height:720px}b{height: 360px}c{height:576px}");
  assert.equal(fixScreenUnits("width:100vw;line-height:1.6"), "width:100vw;line-height:1.6");
});
