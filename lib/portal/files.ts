import { ValidationError } from "../commerce/validation.ts";
import { checkDocumentFile } from "../documents/files.ts";

// What a client may upload in the portal: PDF, JPG or PNG (a photo of a W-2 is the common case), at most 15 MB. The
// type is decided by what the file contains, never by its name.

export const MAX_PORTAL_UPLOAD_BYTES = 15 * 1024 * 1024;
export type PortalFileType = "pdf" | "jpg" | "png";
export const PORTAL_CONTENT_TYPES: Record<PortalFileType, string> = { pdf: "application/pdf", jpg: "image/jpeg", png: "image/png" };

/** A safe file name and the type its extension claims. */
export function cleanPortalName(raw: string): { fileName: string; fileType: PortalFileType } {
  const base = (raw.split(/[\\/]/).pop() ?? "").normalize("NFKC").replace(/[^A-Za-z0-9._ -]/g, "_").replace(/\s+/g, " ").trim().slice(-120);
  const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
  const fileType: PortalFileType | null = ext === "pdf" ? "pdf" : ext === "jpg" || ext === "jpeg" ? "jpg" : ext === "png" ? "png" : null;
  if (!fileType) throw new ValidationError("Upload a PDF, JPG or PNG file.");
  if (base.length <= ext.length + 1 || base.startsWith(".")) throw new ValidationError("Give the file a name, for example w2.pdf.");
  return { fileName: base, fileType };
}

const startsWith = (bytes: Uint8Array, sig: number[]) => sig.every((b, i) => bytes[i] === b);
const JPG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Throws a ValidationError with a plain reason when the bytes are not an acceptable file of `type`. */
export async function checkPortalFile(bytes: Uint8Array, type: PortalFileType): Promise<void> {
  if (bytes.byteLength === 0) throw new ValidationError("The file is empty.");
  if (bytes.byteLength > MAX_PORTAL_UPLOAD_BYTES) throw new ValidationError("Files can be at most 15 MB.");
  if (type === "pdf") return checkDocumentFile(bytes, "pdf");
  if (type === "jpg" && startsWith(bytes, JPG_MAGIC)) return;
  if (type === "png" && startsWith(bytes, PNG_MAGIC)) return;
  throw new ValidationError(`That file isn't a real ${type === "jpg" ? "JPG" : "PNG"} image. Check the file and try again.`);
}
