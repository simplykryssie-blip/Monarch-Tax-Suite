import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { numberedBoxesPdf, pdfBoxes, typeIntoBoxes } from "../lib/documents/merge.ts";

// What the Match the boxes list and the Edit tab show for an official form's boxes.

async function form() {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([300, 400]);
  const p2 = doc.addPage([300, 400]);
  const f = doc.getForm();
  const low = f.createTextField("topmostSubform[0].Page1[0].f1_2[0]");
  low.addToPage(p1, { x: 20, y: 100, width: 150, height: 20 });
  const high = f.createTextField("topmostSubform[0].Page1[0].f1_1[0]");
  high.addToPage(p1, { x: 20, y: 300, width: 150, height: 20 });
  high.acroField.dict.set(PDFName.of("TU"), PDFString.of("Taxpayer's name, Part I line 1"));
  const second = f.createTextField("page2box");
  second.addToPage(p2, { x: 20, y: 300, width: 150, height: 20 });
  second.setText("already here");
  const check = f.createCheckBox("agree");
  check.addToPage(p2, { x: 20, y: 200, width: 12, height: 12 });
  return doc.save();
}

test("boxes come in reading order, with their page, what the form says they are, and what is typed in them", async () => {
  const boxes = await pdfBoxes(await form());
  assert.deepEqual(boxes.map((b) => [b.index, b.page, b.name.split(".").pop()]), [[1, 1, "f1_1[0]"], [2, 1, "f1_2[0]"], [3, 2, "page2box"], [4, 2, "agree"]]);
  assert.equal(boxes[0].hint, "Taxpayer's name, Part I line 1");
  assert.equal(boxes[1].hint, "");
  assert.equal(boxes[2].value, "already here");
  assert.equal(boxes[3].kind, "other");
});

test("the numbered copy is a valid PDF with the same boxes", async () => {
  const out = await numberedBoxesPdf(await form());
  assert.equal((await PDFDocument.load(out)).getForm().getFields().length, 4);
});

test("typing into boxes changes only the boxes named, and the form stays fillable", async () => {
  const out = await typeIntoBoxes(await form(), { "topmostSubform[0].Page1[0].f1_1[0]": "Jane Smith", agree: "x" });
  const boxes = await pdfBoxes(out);
  assert.equal(boxes[0].value, "Jane Smith");
  assert.equal(boxes[2].value, "already here");
  assert.equal(boxes.length, 4);
});
