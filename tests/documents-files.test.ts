import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { checkDocumentFile, pdfHasActiveContent, stripPdfActiveContent } from "../lib/documents/files.ts";

// An official form (like the IRS 8879) carries scripts. They are stripped, the fillable boxes stay.

async function formWithScripts() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const field = doc.getForm().createTextField("TaxpayerName");
  field.addToPage(page, { x: 20, y: 200, width: 200, height: 24 });
  const ctx = doc.context;
  const js = ctx.register(ctx.obj({ Type: "Action", S: "JavaScript", JS: PDFString.of("app.alert('hi')") }));
  doc.catalog.set(PDFName.of("OpenAction"), js);
  const widget = field.acroField.getWidgets()[0];
  widget.dict.set(PDFName.of("AA"), ctx.obj({ K: js }));
  return doc.save({ useObjectStreams: false });
}

describe("scripts in uploaded PDFs", () => {
  test("a form with scripts is refused as is, and accepted once stripped, with its boxes kept", async () => {
    const bytes = await formWithScripts();
    assert.equal(pdfHasActiveContent(bytes), true);
    await assert.rejects(checkDocumentFile(bytes, "pdf"), /scripts or embedded files/);
    const out = await stripPdfActiveContent(bytes);
    assert.equal(out.stripped, true);
    assert.equal(pdfHasActiveContent(out.bytes), false);
    await checkDocumentFile(out.bytes, "pdf");
    const names = (await PDFDocument.load(out.bytes)).getForm().getFields().map((f) => f.getName());
    assert.deepEqual(names, ["TaxpayerName"]);
  });
  test("a clean PDF is left exactly as it was", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const bytes = await doc.save();
    const out = await stripPdfActiveContent(bytes);
    assert.equal(out.stripped, false);
    assert.equal(out.bytes, bytes);
  });
});
