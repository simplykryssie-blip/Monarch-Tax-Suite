import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { MemoryDocumentStore } from "./documents-memory.ts";
import { MemoryWorkspace } from "./workspace-memory.ts";
import { finishClientDoc, startClientDoc } from "../lib/workspace/docs.ts";
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

describe("an official form the way the IRS ships it", () => {
  async function irsStyle(useObjectStreams: boolean) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const field = doc.getForm().createTextField("f1_1");
    field.addToPage(page, { x: 20, y: 200, width: 200, height: 24 });
    const ctx = doc.context;
    const js = ctx.register(ctx.obj({ Type: "Action", S: "JavaScript", JS: PDFString.of("event.value = 1") }));
    // A calculate and format script on the box, a document-level script tree, an XFA copy of the form and the usage-rights signature.
    field.acroField.getWidgets()[0].dict.set(PDFName.of("AA"), ctx.obj({ C: js, F: js }));
    doc.catalog.set(PDFName.of("Names"), ctx.obj({ JavaScript: ctx.obj({ Names: [PDFString.of("init"), js] }) }));
    doc.getForm().acroForm.dict.set(PDFName.of("XFA"), ctx.obj([PDFString.of("template"), ctx.register(ctx.flateStream("<xdp/>"))]));
    doc.catalog.set(PDFName.of("Perms"), ctx.obj({ UR3: ctx.obj({ Type: "Sig" }) }));
    return doc.save({ useObjectStreams });
  }
  for (const packed of [false, true]) {
    test(`${packed ? "compressed" : "plain"} objects: scripts, XFA and usage rights are removed; the fillable box stays`, async () => {
      const bytes = await irsStyle(packed);
      const out = await stripPdfActiveContent(bytes);
      assert.equal(out.stripped, true);
      const text = Buffer.from(out.bytes).toString("latin1");
      assert.doesNotMatch(text, /\/(JavaScript|JS|XFA|Perms|UR3)\b/);
      await checkDocumentFile(out.bytes, "pdf");
      assert.deepEqual((await PDFDocument.load(out.bytes)).getForm().getFields().map((f) => f.getName()), ["f1_1"]);
    });
  }
  test("a compressed PDF with nothing active in it is left exactly as it was", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.getForm().createTextField("a").addToPage(doc.getPage(0), { x: 10, y: 10, width: 50, height: 20 });
    const bytes = await doc.save({ useObjectStreams: true });
    const out = await stripPdfActiveContent(bytes);
    assert.equal(out.stripped, false);
    assert.equal(out.bytes, bytes);
  });
});

describe("what counts as active content is decided by the PDF's structure, not its raw bytes", () => {
  test("a clean PDF whose text or pictures happen to contain '/JS' or '/XFA' is accepted exactly as it was", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.catalog.set(PDFName.of("Note"), PDFString.of("see /JS and https://en.wikipedia.org/wiki/XFA and /JavaScript for details"));
    const bytes = await doc.save({ useObjectStreams: false });
    assert.equal(pdfHasActiveContent(bytes), true, "the byte scan alone would have refused it");
    const out = await stripPdfActiveContent(bytes);
    assert.equal(out.stripped, false);
    assert.equal(out.bytes, bytes);
    await checkDocumentFile(bytes, "pdf");
  });
  test("scripts written inside a list, a nested action chain or a name tree are found and removed", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const field = doc.getForm().createTextField("a");
    field.addToPage(page, { x: 10, y: 10, width: 80, height: 20 });
    const ctx = doc.context;
    const js = (code: string) => ctx.obj({ S: "JavaScript", JS: PDFString.of(code) });
    // The button's action carries a second script as its "Next" step; the page holds a list of actions inline.
    field.acroField.getWidgets()[0].dict.set(PDFName.of("A"), ctx.obj({ S: "GoTo", Next: [js("a()"), js("b()")] }));
    page.node.set(PDFName.of("Extra"), ctx.register(ctx.obj([js("c()"), "keep"])));
    doc.catalog.set(PDFName.of("Names"), ctx.obj({ JavaScript: ctx.obj({ Kids: [ctx.obj({ Names: [PDFString.of("x"), js("d()")] })] }) }));
    const bytes = await doc.save({ useObjectStreams: false });
    const out = await stripPdfActiveContent(bytes);
    assert.equal(out.stripped, true);
    assert.doesNotMatch(Buffer.from(out.bytes).toString("latin1"), /\/(JavaScript|JS)\b/);
    await checkDocumentFile(out.bytes, "pdf");
    assert.deepEqual((await PDFDocument.load(out.bytes)).getForm().getFields().map((f) => f.getName()), ["a"]);
  });
  test("an official form uploaded to a client's folder is cleaned and kept, not refused", async () => {
    const repo = new MemoryWorkspace();
    const store = new MemoryDocumentStore();
    const d = { tenantId: "00000000-0000-4000-8000-000000000001", repo, store };
    const client = await repo.insertClient({ full_name: "Test Client", email: null, phone: null, ssn_last4: null, address: null, created_by: null });
    const bytes = await formWithScripts();
    const started = await startClientDoc(d, { clientId: client.id, title: "Form 8879", fileName: "f8879.pdf", sizeBytes: bytes.byteLength }, null as never);
    store.put(started.doc.file_path, bytes);
    const stored = await finishClientDoc(d, started.doc.id);
    assert.equal(stored.status, "stored");
    assert.match(stored.file_path, /-clean\.pdf$/);
    assert.equal(store.objects.has(started.doc.file_path), false, "the original with scripts is not kept");
    const kept = store.objects.get(stored.file_path)!.bytes;
    await checkDocumentFile(kept, "pdf");
    assert.deepEqual((await PDFDocument.load(kept)).getForm().getFields().map((f) => f.getName()), ["TaxpayerName"]);
  });
});
