import { describe, test } from "node:test";
import assert from "node:assert/strict";
import PizZip from "pizzip";
import { PDFDocument } from "pdf-lib";
import { checkDocumentFile, cleanDocumentName, sha256Hex } from "../lib/documents/files.ts";
import { fillTemplate, missingValues, pdfBoxes, scanTemplate } from "../lib/documents/merge.ts";
import { applySignature, isSignaturePng } from "../lib/documents/signing.ts";

// Phase 2 Step 1, Piece 1: file checks, merge fields and signing. Fixtures are built here; no real documents.

export function makeDocx(paragraphsXml: string, extra: Record<string, string> = {}): Uint8Array {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphsXml}</w:body></w:document>`);
  for (const [k, v] of Object.entries(extra)) zip.file(k, v);
  return new Uint8Array(zip.generate({ type: "uint8array" }));
}
const p = (...runs: string[]) => `<w:p>${runs.map((r) => `<w:r><w:t xml:space="preserve">${r}</w:t></w:r>`).join("")}</w:p>`;
const docxText = (bytes: Uint8Array) => new PizZip(bytes).file("word/document.xml")!.asText().replace(/<[^>]+>/g, "");

export async function makePdf(fields: string[], opts: { signatureBox?: boolean } = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  page.drawText("Engagement letter", { x: 50, y: 740, size: 18 });
  const form = pdf.getForm();
  fields.forEach((name, i) => form.createTextField(name).addToPage(page, { x: 50, y: 680 - i * 40, width: 300, height: 24 }));
  if (opts.signatureBox) form.createTextField("signature").addToPage(page, { x: 50, y: 120, width: 240, height: 48 });
  return pdf.save();
}

describe("uploads are checked by content", () => {
  test("names: .pdf and .docx only; macro-enabled named explicitly", () => {
    assert.deepEqual(cleanDocumentName("C:\\x\\Engagement Letter.PDF"), { fileName: "Engagement Letter.PDF", fileType: "pdf" });
    assert.throws(() => cleanDocumentName("letter.docm"), /Macro-enabled/);
    assert.throws(() => cleanDocumentName("tool.exe"), /Only PDF/);
  });

  test("a renamed file, an encrypted or scripted PDF, and a macro or encrypted Word file are refused", async () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]);
    await assert.rejects(checkDocumentFile(exe, "pdf"), /not a PDF/);
    await assert.rejects(checkDocumentFile(exe, "docx"), /not a Word document/);
    const enc = new TextEncoder().encode("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<</Encrypt 5 0 R>>\n%%EOF");
    await assert.rejects(checkDocumentFile(enc, "pdf"), /password-protected or encrypted/);
    const js = new TextEncoder().encode("%PDF-1.7\n1 0 obj<</S/JavaScript/JS(app.alert(1))>>endobj\n%%EOF");
    await assert.rejects(checkDocumentFile(js, "pdf"), /scripts/);
    await assert.rejects(checkDocumentFile(makeDocx(p("x"), { "word/vbaProject.bin": "macro" }), "docx"), /macros/);
    await assert.rejects(checkDocumentFile(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), "docx"), /encrypted, or in the old \.doc format/);
    await assert.rejects(checkDocumentFile(new Uint8Array(25 * 1024 * 1024 + 1), "pdf"), /at most 25 MB/);
  });

  test("a real PDF and a real DOCX pass", async () => {
    await checkDocumentFile(await makePdf(["client_name"]), "pdf");
    await checkDocumentFile(makeDocx(p("Hello")), "docx");
  });
});

describe("merge fields", () => {
  test("Word: fields split across formatting are found and filled; headers count too", async () => {
    const bytes = makeDocx(p("Dear {{cli", "ent_name}}, from {{ firm_name }}") + p("Order {{order_number}}"), {
      "word/header1.xml": `<?xml version="1.0"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${p("{{firm_", "legal_name}}")}</w:hdr>`,
    });
    const scan = await scanTemplate(bytes, "docx");
    assert.deepEqual(scan.fields, ["client_name", "firm_legal_name", "firm_name", "order_number"]);
    const filled = await fillTemplate(bytes, "docx", { client_name: "Ana <b>Ruiz</b> & Co", firm_name: "Acme Tax", order_number: "1007", firm_legal_name: "Acme Tax LLC" });
    const text = docxText(filled);
    assert.match(text, /Dear Ana &lt;b&gt;Ruiz&lt;\/b&gt; &amp; Co, from Acme Tax/);
    assert.match(text, /Order 1007/);
    assert.doesNotMatch(text, /\{\{/);
  });

  test("Word: unknown, malformed and unclosed fields, and signing fields, are refused at upload", async () => {
    await assert.rejects(scanTemplate(makeDocx(p("{{clinet_name}}")), "docx"), /Unknown merge field: \{\{clinet_name\}\}/);
    await assert.rejects(scanTemplate(makeDocx(p("{{#items}}x{{/items}}")), "docx"), /not valid merge fields/);
    await assert.rejects(scanTemplate(makeDocx(p("{{client_name}")), "docx"), /not closed/);
    await assert.rejects(scanTemplate(makeDocx(p("{{signer_name}}")), "docx"), /only work in PDF/);
  });

  test("PDF: fields named after merge fields are filled and flattened; the signature box is not a merge field", async () => {
    const bytes = await makePdf(["client_name", "firm_name"], { signatureBox: true });
    assert.deepEqual(await scanTemplate(bytes, "pdf"), { fields: ["client_name", "firm_name"], hasSignatureField: true });
    const filled = await fillTemplate(bytes, "pdf", { client_name: "Ana Ruiz", firm_name: "Acme Tax" });
    const reread = await PDFDocument.load(filled);
    assert.equal(reread.getForm().getFields().length, 0, "flattened");
    // An official form names its boxes anything: they are left blank until matched, not refused.
    assert.deepEqual(await scanTemplate(await makePdf(["Text1"]), "pdf"), { fields: [], hasSignatureField: false });
  });

  test("a field with no value is reported, so the step fails instead of sending a blank", () => {
    assert.deepEqual(missingValues(["client_name", "firm_phone", "signer_name"], { client_name: "Ana", firm_phone: " " }), ["firm_phone"]);
    assert.deepEqual(missingValues(["signer_name"], {}, { atSigning: true }), ["signer_name"]);
  });
});

describe("signing", () => {
  const facts = {
    documentName: "Engagement letter", requestId: "00000000-0000-4000-8000-0000000000aa", firmName: "Acme Tax",
    signerName: "Ana Ruiz", signerEmail: "ana@example.com", consentText: "I agree to sign this document electronically. ".repeat(4),
    originalSha256: "a".repeat(64), timeZone: "America/New_York", ipHash: "b".repeat(16), userAgent: "Test browser",
    timeline: [{ label: "Sent", at: new Date("2026-10-13T12:00:00Z") }, { label: "Signed", at: new Date("2026-10-13T12:05:00Z") }],
  };

  test("the signature goes in the signature box, signer fields are filled, and a certificate page is added", async () => {
    const template = await makePdf(["client_name", "signer_name", "signed_date"], { signatureBox: true });
    const delivered = await fillTemplate(template, "pdf", { client_name: "Ana Ruiz" }, { keepSigning: true });
    assert.ok((await PDFDocument.load(delivered)).getForm().getFields().length > 0, "signing fields stay open until signing");
    const signed = await applySignature({ pdf: delivered, mark: { method: "typed", text: "Ana Ruiz" }, signedName: "Ana Ruiz", signedDate: "October 13, 2026", certificate: facts });
    const doc = await PDFDocument.load(signed);
    assert.equal(doc.getPageCount(), 2, "certificate page appended");
    assert.equal(doc.getForm().getFields().length, 0, "flattened");
    assert.notEqual(sha256Hex(signed), sha256Hex(delivered));
  });

  test("without a signature box the signature is placed on the certificate page; drawn signatures must be PNG", async () => {
    const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
    const padded = new Uint8Array(200);
    padded.set(png);
    assert.equal(isSignaturePng(new Uint8Array([1, 2, 3])), false);
    const delivered = await fillTemplate(await makePdf(["client_name"]), "pdf", { client_name: "Ana" }, { keepSigning: true });
    const signed = await applySignature({ pdf: delivered, mark: { method: "drawn", png }, signedName: "Ana Ruiz", signedDate: "October 13, 2026", certificate: facts });
    assert.equal((await PDFDocument.load(signed)).getPageCount(), 2);
  });
});

describe("Excel and image files", () => {
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpgBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
  test("names are accepted by extension, macro workbooks are not", () => {
    assert.deepEqual(cleanDocumentName("Budget 2026.XLSX"), { fileName: "Budget 2026.XLSX", fileType: "xlsx" });
    assert.deepEqual(cleanDocumentName("scan.jpeg").fileType, "jpg");
    assert.deepEqual(cleanDocumentName("id.png").fileType, "png");
    assert.throws(() => cleanDocumentName("macros.xlsm"), /Macro-enabled Excel/);
    assert.throws(() => cleanDocumentName("tool.exe"), /Only PDF, Word/);
  });
  test("images are checked by content", async () => {
    await checkDocumentFile(pngBytes, "png");
    await checkDocumentFile(jpgBytes, "jpg");
    await assert.rejects(checkDocumentFile(jpgBytes, "png"), /not a PNG/);
    await assert.rejects(checkDocumentFile(pngBytes, "jpg"), /not a JPG/);
  });
  test("workbooks must be real, unprotected and macro-free", async () => {
    const zip = (files: Record<string, string>) => { const z = new PizZip(); for (const [k, v] of Object.entries(files)) z.file(k, v); return new Uint8Array(z.generate({ type: "uint8array" })); };
    await checkDocumentFile(zip({ "[Content_Types].xml": "<Types/>", "xl/workbook.xml": "<workbook/>" }), "xlsx");
    await assert.rejects(checkDocumentFile(zip({ "[Content_Types].xml": "<Types/>", "word/document.xml": "<w/>" }), "xlsx"), /not an Excel workbook/);
    await assert.rejects(checkDocumentFile(zip({ "[Content_Types].xml": "<Types/>", "xl/workbook.xml": "<workbook/>", "xl/vbaProject.bin": "x" }), "xlsx"), /macros/);
    await assert.rejects(checkDocumentFile(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4]), "xlsx"), /old \.xls/);
    await assert.rejects(checkDocumentFile(new Uint8Array([1, 2, 3, 4, 5]), "xlsx"), /not an Excel workbook/);
  });
});

describe("matching the boxes of an official PDF", () => {
  const MAP = { "f1_01[0]": "client_name", "f1_02[0]": "firm_name", "f1_03[0]": "ask.tax_years", "Sig_Taxpayer": "signature", "f1_04[0]": "signer_name" };
  const official = () => makePdf(["f1_01[0]", "f1_02[0]", "f1_03[0]", "f1_04[0]", "f1_99[0]", "Sig_Taxpayer"]);

  test("an official form's own box names are accepted, listed, and used once matched", async () => {
    const bytes = await official();
    assert.deepEqual((await pdfBoxes(bytes)).map((b) => b.name), ["f1_01[0]", "f1_02[0]", "f1_03[0]", "f1_04[0]", "f1_99[0]", "Sig_Taxpayer"]);
    assert.deepEqual(await scanTemplate(bytes, "pdf"), { fields: [], hasSignatureField: false }, "nothing matched yet: nothing to fill");
    assert.deepEqual(await scanTemplate(bytes, "pdf", MAP), { fields: ["ask.tax_years", "client_name", "firm_name", "signer_name"], hasSignatureField: true });
  });

  test("matched boxes are filled, the rest stay blank, and the signing boxes stay open until signing", async () => {
    const filled = await fillTemplate(await official(), "pdf", { client_name: "Ana Ruiz", firm_name: "Acme Tax", "ask.tax_years": "2025" }, { keepSigning: true, map: MAP });
    const form = (await PDFDocument.load(filled)).getForm();
    assert.equal(form.getTextField("f1_01[0]").getText(), "Ana Ruiz");
    assert.equal(form.getTextField("f1_02[0]").getText(), "Acme Tax");
    assert.equal(form.getTextField("f1_03[0]").getText(), "2025");
    assert.equal(form.getTextField("f1_99[0]").getText() ?? "", "", "an unmatched box is left alone");
    assert.equal(form.getTextField("f1_04[0]").getText() ?? "", "", "the signer's name waits for the signing");
    const facts2 = { documentName: "8879", requestId: "r1", firmName: "Acme", signerName: "Ana Ruiz", signerEmail: "a@x.test", consentText: "I agree.", originalSha256: "0".repeat(64), timeZone: "America/Chicago", ipHash: null, userAgent: null, timeline: [{ label: "Sent", at: new Date("2026-10-13T12:00:00Z") }] };
    const signed = await applySignature({ pdf: filled, map: MAP, mark: { method: "typed", text: "Ana Ruiz" }, signedName: "Ana Ruiz", signedDate: "October 13, 2026", certificate: facts2 });
    const doc = await PDFDocument.load(signed);
    assert.equal(doc.getPageCount(), 2, "the certificate page is added after the form");
    assert.equal(doc.getForm().getFields().length, 0, "flattened, with the name written where it was matched");
  });
});
