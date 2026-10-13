import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { PDFDocument, PDFTextField, StandardFonts } from "pdf-lib";
import { ValidationError } from "../commerce/validation.ts";
import { isMergeField, SIGNATURE_FIELD, SIGNING_FIELDS } from "./fields.ts";
import type { DocumentFileType } from "./files.ts";

// Templates: {{field}} typed in a Word document, or fillable PDF form fields named after the merge field.
// Values are inserted as plain text only. A document is a template when it uses at least one merge field.

export type TemplateScan = { fields: string[]; hasSignatureField: boolean };

const TAG = /\{\{([^{}]*)\}\}/g;
const NAME = /^(form\.)?[a-z][a-z0-9_]{0,39}$/;

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
export async function scanTemplate(bytes: Uint8Array, type: DocumentFileType): Promise<TemplateScan> {
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
  const names = pdf.getForm().getFields().map((f) => f.getName().trim());
  const hasSignatureField = names.includes(SIGNATURE_FIELD);
  return { fields: checkNames(names.filter((n) => n !== SIGNATURE_FIELD), type), hasSignatureField };
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
export async function fillTemplate(bytes: Uint8Array, type: DocumentFileType, values: Record<string, string>, opts: { keepSigning?: boolean } = {}): Promise<Uint8Array> {
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
    const name = field.getName().trim();
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
