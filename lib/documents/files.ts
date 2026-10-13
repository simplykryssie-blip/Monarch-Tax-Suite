import { createHash } from "node:crypto";
import PizZip from "pizzip";
import { PDFDocument } from "pdf-lib";
import { ValidationError } from "../commerce/validation.ts";

// Uploaded documents are checked by what they contain, not by their name. PDF or Word (.docx) only; macro-enabled,
// encrypted and active-content files are refused.

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const DOCUMENT_URL_SECONDS = 60;
export type DocumentFileType = "pdf" | "docx";

export const CONTENT_TYPES: Record<DocumentFileType, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** A safe file name ending in .pdf or .docx, and the type it claims. */
export function cleanDocumentName(raw: string): { fileName: string; fileType: DocumentFileType } {
  const base = (raw.split(/[\\/]/).pop() ?? "").normalize("NFKC").replace(/[^A-Za-z0-9._ -]/g, "_").replace(/\s+/g, " ").trim().slice(-120);
  const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
  if (ext === "docm" || ext === "dotm") throw new ValidationError("Macro-enabled Word files (.docm) are not accepted. Save it as a regular .docx and upload that.");
  if (ext !== "pdf" && ext !== "docx") throw new ValidationError("Only PDF (.pdf) and Word (.docx) files can be uploaded.");
  if (base.length <= ext.length + 1 || base.startsWith(".")) throw new ValidationError("Give the file a name, for example engagement-letter.pdf.");
  return { fileName: base, fileType: ext };
}

const startsWith = (bytes: Uint8Array, sig: number[]) => sig.every((b, i) => bytes[i] === b);
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
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
