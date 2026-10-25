import { createHash } from "node:crypto";
import PizZip from "pizzip";
import { PDFDocument } from "pdf-lib";
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
    if (/\/(JavaScript|JS|Launch|EmbeddedFile)\b/.test(raw)) throw new ValidationError("This PDF contains scripts or embedded files, which are not accepted. Print it to a new PDF and upload that.");
    try {
      await PDFDocument.load(bytes, { updateMetadata: false });
    } catch {
      throw new ValidationError("This PDF could not be read. It may be damaged; export it again and upload the new copy.");
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
