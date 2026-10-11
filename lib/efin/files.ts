import { EfinRuleError } from "./rules.ts";

// Upload checks for firm documents. Pure so they are tested; the file's own first bytes must match its extension.
export const MAX_DOC_BYTES = 4 * 1024 * 1024;
const SIGNATURES: { ext: string[]; mime: string[]; magic: number[] }[] = [
  { ext: ["pdf"], mime: ["application/pdf"], magic: [0x25, 0x50, 0x44, 0x46] },
  { ext: ["png"], mime: ["image/png"], magic: [0x89, 0x50, 0x4e, 0x47] },
  { ext: ["jpg", "jpeg"], mime: ["image/jpeg"], magic: [0xff, 0xd8, 0xff] },
  { ext: ["docx"], mime: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"], magic: [0x50, 0x4b, 0x03, 0x04] },
];

export const safeFileName = (name: string) => name.replace(/^.*[\\/]/, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "").slice(-80) || "document";

/** Returns the clean name and the content type to store, or throws a message naming the "file" field. */
export function checkUpload(file: { name: string; size: number; type: string }, head: Uint8Array): { name: string; contentType: string } {
  if (file.size === 0) throw new EfinRuleError("Choose a file to upload.", "file");
  if (file.size > MAX_DOC_BYTES) throw new EfinRuleError("That file is larger than 4 MB. Reduce it or split it, then try again.", "file");
  const name = safeFileName(file.name);
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const sig = SIGNATURES.find((x) => x.ext.includes(ext));
  if (!sig) throw new EfinRuleError("Upload a PDF, PNG, JPG or DOCX file.", "file");
  if (file.type && !sig.mime.includes(file.type)) throw new EfinRuleError("The file's type does not match its extension.", "file");
  if (!sig.magic.every((b, i) => head[i] === b)) throw new EfinRuleError(`That file does not look like a real ${ext.toUpperCase()}.`, "file");
  return { name, contentType: sig.mime[0] };
}
