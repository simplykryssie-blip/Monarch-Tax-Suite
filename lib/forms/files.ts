import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { ValidationError } from "../commerce/validation.ts";
import { MAX_FILE_BYTES, type FileKind } from "./definition.ts";

// Files respondents upload (EFIN and PTIN letters, IDs, banking documents). Checked by what they contain, not by
// their name: PDF, JPEG or PNG only; encrypted PDFs and PDFs with scripts or embedded files are refused.

export const UPLOAD_CONTENT_TYPES: Record<FileKind, string> = { pdf: "application/pdf", jpg: "image/jpeg", png: "image/png" };
export const KIND_LABELS: Record<FileKind, string> = { pdf: "PDF", jpg: "JPG", png: "PNG" };
export const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** A safe file name and the kind its extension claims. */
export function cleanUploadName(raw: string, allowed: FileKind[]): { fileName: string; kind: FileKind } {
  const base = (raw.split(/[\\/]/).pop() ?? "").normalize("NFKC").replace(/[^A-Za-z0-9._ ()-]/g, "_").replace(/\s+/g, " ").trim().slice(-120);
  const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
  const kind: FileKind | null = ext === "pdf" ? "pdf" : ext === "jpg" || ext === "jpeg" ? "jpg" : ext === "png" ? "png" : null;
  const list = allowed.map((k) => KIND_LABELS[k]).join(", ");
  if (!kind || !allowed.includes(kind)) throw new ValidationError(`This question accepts ${list} files only.`);
  return { fileName: base.length > ext.length + 1 ? base : `upload.${ext}`, kind };
}

const starts = (b: Uint8Array, sig: number[]) => sig.every((x, i) => b[i] === x);
const latin1 = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("latin1");

/** Throws a ValidationError naming the problem when `bytes` is not an acceptable file of `kind`. */
export async function checkUpload(bytes: Uint8Array, kind: FileKind): Promise<void> {
  if (!bytes.byteLength) throw new ValidationError("The file is empty.");
  if (bytes.byteLength > MAX_FILE_BYTES) throw new ValidationError("Files can be at most 10 MB.");
  if (kind === "jpg") {
    if (!starts(bytes, [0xff, 0xd8, 0xff])) throw new ValidationError("This file is not a JPG image, even though its name says it is.");
    return;
  }
  if (kind === "png") {
    if (!starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) throw new ValidationError("This file is not a PNG image, even though its name says it is.");
    return;
  }
  if (!starts(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) throw new ValidationError("This file is not a PDF, even though its name ends in .pdf.");
  const raw = latin1(bytes);
  if (/\/Encrypt\b/.test(raw)) throw new ValidationError("This PDF is password-protected. Save an unprotected copy and upload that.");
  if (/\/(JavaScript|JS|Launch|EmbeddedFile)\b/.test(raw)) throw new ValidationError("This PDF contains scripts or embedded files, which are not accepted. Print it to a new PDF and upload that.");
  try {
    await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    throw new ValidationError("This PDF could not be read. It may be damaged; save it again and upload the new copy.");
  }
}

export const kindOfContentType = (t: string): FileKind | null => (t === "application/pdf" ? "pdf" : t === "image/jpeg" ? "jpg" : t === "image/png" ? "png" : null);
