import { createHash } from "node:crypto";
import PizZip from "pizzip";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFStream, type PDFObject } from "pdf-lib";
import { ValidationError } from "../commerce/validation.ts";

// Uploaded documents are checked by what they contain, not by their name. PDF, Word (.docx), Excel (.xlsx) and images
// (JPG, PNG) only; macro-enabled, encrypted and active-content files are refused.

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const DOCUMENT_URL_SECONDS = 60;
export type DocumentFileType = "pdf" | "docx" | "xlsx" | "png" | "jpg";
/** Types that can hold merge fields and be signed: only PDF and Word are read as templates. */
export const TEMPLATE_TYPES: DocumentFileType[] = ["pdf", "docx"];
/** Types a browser can show in a tab. */
export const VIEWABLE_TYPES: DocumentFileType[] = ["pdf", "png", "jpg"];

export const CONTENT_TYPES: Record<DocumentFileType, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  png: "image/png",
  jpg: "image/jpeg",
};

export const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** A safe file name ending in an accepted extension, and the type it claims. */
export function cleanDocumentName(raw: string): { fileName: string; fileType: DocumentFileType } {
  const base = (raw.split(/[\\/]/).pop() ?? "").normalize("NFKC").replace(/[^A-Za-z0-9._ -]/g, "_").replace(/\s+/g, " ").trim().slice(-120);
  const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
  if (ext === "docm" || ext === "dotm") throw new ValidationError("Macro-enabled Word files (.docm) are not accepted. Save it as a regular .docx and upload that.");
  if (ext === "xlsm" || ext === "xltm") throw new ValidationError("Macro-enabled Excel files (.xlsm) are not accepted. Save it as a regular .xlsx and upload that.");
  const fileType: DocumentFileType | null = ext === "pdf" || ext === "docx" || ext === "xlsx" || ext === "png" ? ext : ext === "jpg" || ext === "jpeg" ? "jpg" : null;
  if (!fileType) throw new ValidationError("Only PDF, Word (.docx), Excel (.xlsx) and image (JPG, PNG) files can be uploaded.");
  if (base.length <= ext.length + 1 || base.startsWith(".")) throw new ValidationError("Give the file a name, for example engagement-letter.pdf.");
  return { fileName: base, fileType };
}

const startsWith = (bytes: Uint8Array, sig: number[]) => sig.every((b, i) => bytes[i] === b);
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPG_MAGIC = [0xff, 0xd8, 0xff];
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]; // old .doc, and encrypted Office files

function latin1(bytes: Uint8Array) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
}

/** Throws a ValidationError with a plain reason when the file is not an acceptable document of `type`. */
export async function checkDocumentFile(bytes: Uint8Array, type: DocumentFileType): Promise<void> {
  if (bytes.byteLength === 0) throw new ValidationError("The file is empty.");
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new ValidationError("Files can be at most 25 MB.");
  if (type === "pdf") {
    if (!startsWith(bytes, PDF_MAGIC)) throw new ValidationError("This file is not a PDF, even though its name ends in .pdf.");
    const raw = latin1(bytes);
    if (/\/Encrypt\b/.test(raw)) throw new ValidationError("This PDF is password-protected or encrypted. Save an unprotected copy and upload that.");
    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(bytes, { updateMetadata: false });
    } catch {
      throw new ValidationError("This PDF could not be read. It may be damaged; export it again and upload the new copy.");
    }
    const hit = walkPdf(doc, false);
    if (hit) {
      console.error(`pdf refused: active content at ${hit}`);
      throw new ValidationError("This PDF contains scripts or embedded files, which are not accepted. Print it to a new PDF and upload that.");
    }
    return;
  }
  if (type === "png" || type === "jpg") {
    if (!startsWith(bytes, type === "png" ? PNG_MAGIC : JPG_MAGIC)) throw new ValidationError(`This file is not a ${type === "png" ? "PNG" : "JPG"} image, even though its name says it is.`);
    return;
  }
  if (type === "xlsx") {
    if (startsWith(bytes, OLE_MAGIC)) throw new ValidationError("This Excel file is encrypted, or in the old .xls format. Save it as an unprotected .xlsx and upload that.");
    if (!startsWith(bytes, ZIP_MAGIC)) throw new ValidationError("This file is not an Excel workbook, even though its name ends in .xlsx.");
    let book: PizZip;
    try {
      book = new PizZip(bytes);
    } catch {
      throw new ValidationError("This Excel file could not be read. It may be damaged; save it again and upload the new copy.");
    }
    if (!book.file("xl/workbook.xml")) throw new ValidationError("This file is not an Excel workbook.");
    if (book.file(/vbaProject\.bin$/i).length || /macroEnabled/i.test(book.file("[Content_Types].xml")?.asText() ?? "")) throw new ValidationError("This Excel file contains macros, which are not accepted. Save it as a regular .xlsx and upload that.");
    if (book.file(/^xl\/embeddings\//i).length || book.file(/activeX/i).length) throw new ValidationError("This Excel file contains embedded objects or controls, which are not accepted. Remove them and upload it again.");
    return;
  }
  if (startsWith(bytes, OLE_MAGIC)) throw new ValidationError("This Word file is encrypted, or in the old .doc format. Save it as an unprotected .docx and upload that.");
  if (!startsWith(bytes, ZIP_MAGIC)) throw new ValidationError("This file is not a Word document, even though its name ends in .docx.");
  let zip: PizZip;
  try {
    zip = new PizZip(bytes);
  } catch {
    throw new ValidationError("This Word file could not be read. It may be damaged; save it again and upload the new copy.");
  }
  if (!zip.file("word/document.xml")) throw new ValidationError("This file is not a Word document.");
  const types = zip.file("[Content_Types].xml")?.asText() ?? "";
  if (zip.file(/vbaProject\.bin$/i).length || /macroEnabled/i.test(types)) throw new ValidationError("This Word file contains macros, which are not accepted. Save it as a regular .docx and upload that.");
  if (zip.file(/^word\/embeddings\//i).length || zip.file(/activeX/i).length) throw new ValidationError("This Word file contains embedded objects or controls, which are not accepted. Remove them and upload it again.");
}

/** Names that suggest scripts, attachments or XFA somewhere in a PDF's raw bytes. Only a hint that a closer look is worth it. */
const ACTIVE = /\/(JavaScript|JS|Launch|EmbeddedFile|XFA)\b/;
/** PDFs saved with compressed object streams hide their objects from a plain byte scan, so they are opened and checked structurally. */
const PACKED = /\/ObjStm\b/;

/** True when the PDF's raw bytes hint at scripts, launch actions, embedded files or XFA (it may be a false alarm; see `walkPdf`). */
export const pdfHasActiveContent = (bytes: Uint8Array) => ACTIVE.test(latin1(bytes));

// Keys that only ever hold scripts, attachments, form scripts or the Reader-extension signature, wherever they appear.
const ACTIVE_KEYS = ["JS", "JavaScript", "XFA", "Perms", "AA", "EF", "RF", "EmbeddedFiles", "OpenAction", "AF", "Collection"].map((k) => PDFName.of(k));
const ACTION_KINDS = new Set(["/JavaScript", "/Launch"]);
const nameOf = (d: PDFDict, key: string) => { const v = d.get(PDFName.of(key)); return v instanceof PDFName ? v.asString() : null; };
/** A dictionary that is itself a script, a launch action or an attached file, so whatever holds it must let it go. */
const isActiveDict = (d: PDFDict) => ACTION_KINDS.has(nameOf(d, "S") ?? "") || nameOf(d, "Type") === "/EmbeddedFile" || nameOf(d, "Subtype") === "/FileAttachment";

/**
 * Looks through every object of a PDF (and the dictionaries and lists written inside them) for scripts, launch actions,
 * attached files and the keys that hold them. With `mutate` it removes what it finds; without, it only reports where the
 * first one is. Returns "" when there is nothing (mutate) or the first location (read only).
 */
function walkPdf(doc: PDFDocument, mutate: boolean): string {
  const ctx = doc.context;
  let first = "";
  const note = (where: string) => { if (!first) first = where; };
  // True when `node` is itself active and the one holding it should let go of it.
  const visit = (node: PDFObject | undefined, where: string, depth: number): boolean => {
    if (!node || depth > 40) return false;
    const dict = node instanceof PDFStream ? node.dict : node instanceof PDFDict ? node : null;
    if (dict) {
      if (isActiveDict(dict)) { note(where); return true; }
      for (const key of ACTIVE_KEYS) {
        if (!dict.has(key)) continue;
        note(`${where}/${key.asString().slice(1)}`);
        if (mutate) dict.delete(key);
      }
      for (const [key, value] of dict.entries()) {
        if (value instanceof PDFRef) continue;
        if (visit(value, `${where}/${key.asString().slice(1)}`, depth + 1)) { note(where); if (mutate) dict.delete(key); }
      }
      return false;
    }
    if (node instanceof PDFArray) {
      for (let i = node.size() - 1; i >= 0; i--) {
        const item = node.get(i);
        if (item instanceof PDFRef) continue;
        if (visit(item, `${where}[${i}]`, depth + 1)) { note(where); if (mutate) node.remove(i); }
      }
    }
    return false;
  };
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (visit(obj, `obj ${ref.objectNumber}`, 0)) { note(`obj ${ref.objectNumber}`); if (mutate) ctx.delete(ref); }
  }
  return first;
}

/**
 * Removes scripts, launch actions, embedded files and XFA forms from a PDF but keeps its pages and fillable boxes (AcroForm
 * fields), so an official form such as the IRS Form 8879 can be used after the active parts are stripped. Returns the
 * original bytes when nothing active is found. The result is checked again by `checkDocumentFile`.
 */
export async function stripPdfActiveContent(bytes: Uint8Array): Promise<{ bytes: Uint8Array; stripped: boolean }> {
  const text = startsWith(bytes, PDF_MAGIC) ? latin1(bytes) : "";
  if (!text || /\/Encrypt\b/.test(text) || (!ACTIVE.test(text) && !PACKED.test(text))) return { bytes, stripped: false };
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    throw new ValidationError("This PDF could not be read. It may be damaged; export it again and upload the new copy.");
  }
  if (walkPdf(doc, true) === "") return { bytes, stripped: false };
  try {
    return { bytes: await doc.save({ useObjectStreams: false }), stripped: true };
  } catch {
    // A file whose page tree is itself a script (a deliberately broken file) can't be saved once the script is gone.
    throw new ValidationError("This PDF could not be cleaned of its scripts. Export it again from the program that made it and upload the new copy.");
  }
}
