import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString, PDFTextField, StandardFonts, rgb } from "pdf-lib";
import { ValidationError } from "../commerce/validation.ts";
import { effectiveName, isMergeField, SIGNATURE_FIELD, SIGNING_FIELDS, type FieldMap } from "./fields.ts";
import type { DocumentFileType } from "./files.ts";

// Templates: {{field}} typed in a Word document, or fillable PDF form fields named after the merge field.
// Values are inserted as plain text only. A document is a template when it uses at least one merge field.

export type TemplateScan = { fields: string[]; hasSignatureField: boolean };

const TAG = /\{\{([^{}]*)\}\}/g;
const NAME = /^((form|ask)\.)?[a-z][a-z0-9_]{0,39}$/;

/** Word splits text into runs; join each paragraph's text so {{field}} written with mixed formatting is found. */
function docxParagraphTexts(xml: string): string[] {
  return xml.split(/<\/w:p>/).map((p) => [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(""));
}

const DOCX_PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

function decodeXml(s: string) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function checkNames(names: string[], type: DocumentFileType): string[] {
  // PDF field names are free text, so anything that is not a merge field is simply unknown.
  const bad = type === "docx" ? names.filter((n) => !NAME.test(n)) : [];
  if (bad.length) throw new ValidationError(`These are not valid merge fields: ${bad.map((b) => `{{${b}}}`).join(", ")}. Merge fields are lowercase names like {{client_name}}.`);
  const unknown = names.filter((n) => !isMergeField(n));
  if (unknown.length) throw new ValidationError(`Unknown merge field${unknown.length > 1 ? "s" : ""}: ${unknown.map((u) => (type === "pdf" ? `"${u}"` : `{{${u}}}`)).join(", ")}. Use the names in the merge field list${type === "pdf" ? `, or name the signature box "${SIGNATURE_FIELD}"` : ""}.`);
  const signing = names.filter((n) => SIGNING_FIELDS.includes(n));
  if (type === "docx" && signing.length) throw new ValidationError(`${signing.map((s) => `{{${s}}}`).join(", ")} only work in PDF documents, which are the ones that can be signed.`);
  return [...new Set(names)].sort();
}

/** Lists the merge fields a document uses. Throws on unknown or malformed fields. */
export async function scanTemplate(bytes: Uint8Array, type: DocumentFileType, map: FieldMap = {}): Promise<TemplateScan> {
  if (type !== "docx" && type !== "pdf") return { fields: [], hasSignatureField: false };
  if (type === "docx") {
    const zip = new PizZip(bytes);
    const names: string[] = [];
    for (const path of Object.keys(zip.files).filter((p) => DOCX_PARTS.test(p))) {
      for (const text of docxParagraphTexts(zip.file(path)!.asText())) {
        const decoded = decodeXml(text);
        for (const m of decoded.matchAll(TAG)) names.push(m[1].trim());
        if (/\{\{|\}\}/.test(decoded.replace(TAG, ""))) {
          throw new ValidationError("A merge field is not closed. Each one must look like {{client_name}}, with two braces on each side.");
        }
      }
    }
    return { fields: checkNames(names, type), hasSignatureField: false };
  }
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  // A box with a name that is not a merge field is left blank, not refused: official forms name their boxes anything.
  // They are matched to what goes in them on the document's page.
  const names = pdf.getForm().getFields().map((f) => effectiveName(f.getName().trim(), map)).filter((n) => n === SIGNATURE_FIELD || isMergeField(n));
  const hasSignatureField = names.includes(SIGNATURE_FIELD);
  return { fields: checkNames(names.filter((n) => n !== SIGNATURE_FIELD), type), hasSignatureField };
}

export type PdfBox = {
  name: string; kind: "text" | "other";
  /** Reading order on the form (top to bottom, page by page); the number shown beside the box and on the numbered preview. */
  index: number;
  page: number | null;
  /** What the form itself says the box is for (its tooltip), when it says. */
  hint: string;
  /** What is typed in it now (text boxes). */
  value: string;
  rects: { page: number; x: number; y: number; w: number; h: number }[];
};

/** The boxes of a fillable PDF in reading order, with what each one is for, where it is, and what it holds. */
export async function pdfBoxes(bytes: Uint8Array): Promise<PdfBox[]> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const pageOf = new Map<PDFDict, number>();
  pdf.getPages().forEach((page, i) => {
    const annots = page.node.Annots();
    for (let k = 0; annots && k < annots.size(); k++) {
      const a = annots.lookup(k);
      if (a instanceof PDFDict) pageOf.set(a, i + 1);
    }
  });
  const seen = new Set<string>();
  const out: PdfBox[] = [];
  for (const f of pdf.getForm().getFields()) {
    const name = f.getName().trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const tip = f.acroField.dict.get(PDFName.of("TU"));
    const hint = tip instanceof PDFString || tip instanceof PDFHexString ? tip.decodeText().replace(/\s+/g, " ").trim().slice(0, 300) : "";
    const rects = f.acroField.getWidgets().flatMap((w) => {
      const page = pageOf.get(w.dict);
      if (!page) return [];
      const r = w.getRectangle();
      return [{ page, x: r.x, y: r.y, w: r.width, h: r.height }];
    });
    let value = "";
    if (f instanceof PDFTextField) { try { value = f.getText() ?? ""; } catch { value = ""; } }
    out.push({ name, kind: f instanceof PDFTextField ? "text" : "other", index: 0, page: rects[0]?.page ?? null, hint, value, rects });
  }
  out.sort((a, b) => (a.page ?? 1e9) - (b.page ?? 1e9) || Math.round((b.rects[0]?.y ?? 0) / 8) - Math.round((a.rects[0]?.y ?? 0) / 8) || (a.rects[0]?.x ?? 0) - (b.rects[0]?.x ?? 0));
  out.forEach((b, i) => { b.index = i + 1; });
  return out;
}

/** The same PDF with every box outlined and numbered (the numbers on the Match the boxes list), for showing where each one is. */
export async function numberedBoxesPdf(bytes: Uint8Array): Promise<Uint8Array> {
  const boxes = await pdfBoxes(bytes);
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = pdf.getPages();
  for (const b of boxes) {
    for (const r of b.rects) {
      const page = pages[r.page - 1];
      if (!page) continue;
      const tag = String(b.index);
      const w = font.widthOfTextAtSize(tag, 7) + 4;
      page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, borderColor: rgb(0.85, 0.1, 0.1), borderWidth: 0.8, color: rgb(1, 0.9, 0.2), opacity: 0.18, borderOpacity: 0.9 });
      page.drawRectangle({ x: r.x, y: r.y + r.h, width: w, height: 9, color: rgb(0.85, 0.1, 0.1) });
      page.drawText(tag, { x: r.x + 2, y: r.y + r.h + 2, size: 7, font, color: rgb(1, 1, 1) });
    }
  }
  return pdf.save();
}

/** Types into the text boxes of a PDF (by box name) and keeps the form fillable. Boxes that aren't text boxes are left alone. */
export async function typeIntoBoxes(bytes: Uint8Array, values: Record<string, string>): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const form = pdf.getForm();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const f of form.getFields()) {
    const name = f.getName().trim();
    if (!(f instanceof PDFTextField) || !(name in values)) continue;
    const v = pdfSafe(values[name]).slice(0, 500);
    if (f.isMultiline()) f.enableMultiline();
    f.setText(v || undefined);
  }
  form.updateFieldAppearances(font);
  return pdf.save();
}

/** Fields the document uses that have no value. Filling must not happen while this is non-empty. */
export function missingValues(fields: string[], values: Record<string, string>, opts: { atSigning?: boolean } = {}): string[] {
  return fields.filter((f) => (opts.atSigning || !SIGNING_FIELDS.includes(f)) && !(values[f] ?? "").trim());
}

const plain = (v: string) => v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").slice(0, 2000);

/** The standard PDF fonts only cover Western characters; anything else becomes "?" rather than failing. */
function pdfSafe(v: string) {
  return plain(v).replace(/[^\u0009\u000a\u000d -~ -ÿ–—‘’“”•…€]/g, "?");
}

/**
 * Fills a template. DOCX: every {{field}} is replaced. PDF: each field named after a merge field gets its value;
 * `keepSigning` leaves the signing fields (and the signature box) open so they can be filled when the person signs;
 * otherwise the form is flattened so the copy cannot be edited.
 */
export async function fillTemplate(bytes: Uint8Array, type: DocumentFileType, values: Record<string, string>, opts: { keepSigning?: boolean; map?: FieldMap } = {}): Promise<Uint8Array> {
  if (type !== "docx" && type !== "pdf") return bytes;
  if (type === "docx") {
    const zip = new PizZip(bytes);
    const doc = new Docxtemplater(zip, {
      delimiters: { start: "{{", end: "}}" },
      paragraphLoop: true,
      linebreaks: true,
      parser: (tag: string) => ({ get: () => plain(values[tag.trim()] ?? "") }),
      nullGetter: () => "",
    });
    doc.render({});
    return new Uint8Array(doc.getZip().generate({ type: "uint8array", compression: "DEFLATE" }));
  }
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const form = pdf.getForm();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const field of form.getFields()) {
    const name = effectiveName(field.getName().trim(), opts.map);
    if (!(field instanceof PDFTextField)) continue;
    if (name === SIGNATURE_FIELD || (opts.keepSigning && SIGNING_FIELDS.includes(name))) continue;
    if (!isMergeField(name)) continue;
    field.setText(pdfSafe(values[name] ?? ""));
    field.enableReadOnly();
  }
  form.updateFieldAppearances(font);
  if (!opts.keepSigning) form.flatten();
  return pdf.save();
}
