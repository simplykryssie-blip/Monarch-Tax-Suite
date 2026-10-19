import { PDFDocument, PDFTextField, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { SIGNATURE_FIELD } from "./fields.ts";

// Builds the signed copy of a PDF: the signer's name and date in their fields, the signature in the signature box
// (or on the certificate page when the template has none), the form flattened, and a signing certificate page with
// the evidence appended. The signed copy's own fingerprint is computed by the caller after this returns.

export type SignatureMark = { method: "typed"; text: string } | { method: "drawn"; png: Uint8Array };

export type CertificateFacts = {
  documentName: string;
  requestId: string;
  firmName: string;
  signerName: string;
  signerEmail: string;
  consentText: string;
  originalSha256: string;
  timeZone: string;
  timeline: { label: string; at: Date }[];
  ipHash: string | null;
  userAgent: string | null;
};

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
export const MAX_SIGNATURE_PNG_BYTES = 300 * 1024;

export function isSignaturePng(bytes: Uint8Array) {
  return bytes.byteLength > 100 && bytes.byteLength <= MAX_SIGNATURE_PNG_BYTES && PNG_MAGIC.every((b, i) => bytes[i] === b);
}

const safe = (v: string) => v.replace(/[^ -~ -ÿ]/g, "?");

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of safe(text.replace(/\r/g, "")).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        if (line) lines.push(line);
        line = word;
        while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      }
    }
    lines.push(line);
  }
  return lines;
}

export function formatInZone(at: Date, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "long", timeStyle: "long" }).format(at);
  } catch {
    return `${at.toISOString()} (UTC)`;
  }
}

async function drawMark(pdf: PDFDocument, page: PDFPage, mark: SignatureMark, box: { x: number; y: number; width: number; height: number }) {
  if (mark.method === "drawn") {
    const img = await pdf.embedPng(mark.png);
    const scale = Math.min(box.width / img.width, box.height / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    page.drawImage(img, { x: box.x + (box.width - w) / 2, y: box.y + (box.height - h) / 2, width: w, height: h });
    return;
  }
  const font = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const text = safe(mark.text).slice(0, 120);
  let size = Math.min(28, box.height * 0.8);
  while (size > 6 && font.widthOfTextAtSize(text, size) > box.width) size -= 1;
  page.drawText(text, { x: box.x + 2, y: box.y + (box.height - size) / 2 + size * 0.2, size, font, color: rgb(0.05, 0.1, 0.35) });
}

export async function applySignature(input: { pdf: Uint8Array; mark: SignatureMark; signedName: string; signedDate: string; certificate: CertificateFacts }): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(input.pdf, { updateMetadata: false });
  const form = pdf.getForm();
  const pages = pdf.getPages();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const boxes: { page: PDFPage; x: number; y: number; width: number; height: number }[] = [];
  for (const field of form.getFields()) {
    const name = field.getName().trim();
    if (name === SIGNATURE_FIELD) {
      for (const widget of field.acroField.getWidgets()) {
        const ref = widget.P();
        const page = pages.find((p) => ref && p.ref === ref) ?? pages[0];
        boxes.push({ page, ...widget.getRectangle() });
      }
    } else if (field instanceof PDFTextField && (name === "signer_name" || name === "signed_date")) {
      field.setText(safe(name === "signer_name" ? input.signedName : input.signedDate));
    }
  }
  form.updateFieldAppearances(helv);
  form.flatten();
  for (const box of boxes) await drawMark(pdf, box.page, input.mark, box);

  // Signing certificate.
  const c = input.certificate;
  const page = pdf.addPage([612, 792]);
  const margin = 54;
  const width = 612 - margin * 2;
  let y = 792 - margin;
  const line = (text: string, opts: { font?: PDFFont; size?: number; gap?: number } = {}) => {
    const size = opts.size ?? 10;
    for (const l of wrap(text, opts.font ?? helv, size, width)) {
      page.drawText(l, { x: margin, y, size, font: opts.font ?? helv, color: rgb(0.1, 0.1, 0.1) });
      y -= size + 4;
    }
    y -= opts.gap ?? 2;
  };
  line("Signing certificate", { font: bold, size: 18, gap: 8 });
  line(`Document: ${c.documentName}`);
  line(`Sent by: ${c.firmName}`);
  line(`Request reference: ${c.requestId}`, { gap: 8 });
  line("Signer", { font: bold, size: 12 });
  line(`${c.signerName} <${c.signerEmail}>`);
  line(`Signature: ${input.mark.method === "drawn" ? "drawn by the signer" : "typed by the signer"}`, { gap: 8 });
  if (boxes.length === 0) {
    const box = { x: margin, y: y - 50, width: 240, height: 46 };
    page.drawRectangle({ ...box, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.5 });
    await drawMark(pdf, page, input.mark, box);
    y -= 60;
  }
  line("Timeline", { font: bold, size: 12 });
  for (const t of c.timeline) line(`${t.label}: ${formatInZone(t.at, c.timeZone)}  (${t.at.toISOString()})`);
  y -= 6;
  line("Consent the signer agreed to before signing", { font: bold, size: 12 });
  line(c.consentText, { size: 9, gap: 8 });
  line("Fingerprints", { font: bold, size: 12 });
  line(`SHA-256 of the document as sent: ${c.originalSha256}`, { size: 9 });
  line("The SHA-256 of this signed copy is recorded by the sender when it is created.", { size: 9, gap: 8 });
  line("Device", { font: bold, size: 12 });
  line(`Network address (one-way hash): ${c.ipHash ?? "not available"}`, { size: 9 });
  line(`Browser: ${c.userAgent ?? "not available"}`, { size: 9 });
  return pdf.save();
}
