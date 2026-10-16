import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { formatInZone } from "../documents/signing.ts";

// The submission PDF: one complete document per submission. The answers by section, the uploaded files themselves
// (images placed on pages, PDFs appended), the signature with its consent text, and timestamps on every page.
// Text uses Noto Sans (SIL Open Font License, lib/forms/fonts/OFL.txt) so names in most languages print correctly.

export type PdfRow = { label: string; value: string };
export type PdfSection = { title: string; rows: PdfRow[] };
export type PdfAttachment = { fieldLabel: string; fileName: string; sizeBytes: number; sha256: string; kind: "pdf" | "jpg" | "png"; bytes: Uint8Array };
export type PdfSignature = {
  method: "typed" | "drawn";
  typed?: string;
  png?: Uint8Array;
  signedName: string;
  consentText: string;
  consentedAt: Date;
  ipHash: string | null;
  userAgent: string | null;
};
export type SubmissionPdfInput = {
  firmName: string;
  formName: string;
  formVersion: number;
  number: number;
  submissionId: string;
  isTest: boolean;
  timeZone: string;
  startedAt: Date;
  submittedAt: Date;
  generatedAt: Date;
  respondent: string | null;
  sections: PdfSection[];
  attachments: PdfAttachment[];
  signature: PdfSignature | null;
};

let fonts: Promise<{ regular: Uint8Array; bold: Uint8Array }> | null = null;
export function fontBytes() {
  fonts ??= Promise.all([
    readFile(join(process.cwd(), "lib/forms/fonts/NotoSans-Regular.ttf")),
    readFile(join(process.cwd(), "lib/forms/fonts/NotoSans-Bold.ttf")),
  ]).then(([regular, bold]) => ({ regular: new Uint8Array(regular), bold: new Uint8Array(bold) }));
  return fonts;
}

const PAGE: [number, number] = [612, 792];
const MARGIN = 54;
const WIDTH = PAGE[0] - MARGIN * 2;
const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.42, 0.4, 0.35);

/** Replaces characters the font cannot draw (and control characters) so drawing never fails. */
export function drawable(font: PDFFont, text: string): string {
  const set = new Set(font.getCharacterSet());
  return Array.from(text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ")).map((ch) => (ch === "\n" || set.has(ch.codePointAt(0)!) ? ch : "?")).join("");
}

export function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of drawable(font, text).replace(/\r/g, "").split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      line = word;
      while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line);
  }
  return lines;
}

const sizeText = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export async function buildSubmissionPdf(input: SubmissionPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const bytes = await fontBytes();
  // The whole font, not a subset: pdf-lib's subsetting of Noto Sans drops glyph outlines in some viewers (text was
  // present but blank when rendered).
  const regular = await pdf.embedFont(bytes.regular, { subset: false });
  const bold = await pdf.embedFont(bytes.bold, { subset: false });
  const title = `${input.formName}, submission #${input.number}`;
  pdf.setTitle(drawable(regular, title));
  pdf.setAuthor(drawable(regular, input.firmName));
  pdf.setCreationDate(input.generatedAt);
  pdf.setModificationDate(input.generatedAt);
  pdf.setProducer("Verexa HQ");

  let page: PDFPage = pdf.addPage(PAGE);
  let y = PAGE[1] - MARGIN;
  const bottom = MARGIN + 30;
  const newPage = () => {
    page = pdf.addPage(PAGE);
    y = PAGE[1] - MARGIN;
  };
  const text = (value: string, opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; gap?: number; indent?: number } = {}) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 10;
    const indent = opts.indent ?? 0;
    for (const line of wrap(font, value, size, WIDTH - indent)) {
      if (y - size < bottom) newPage();
      page.drawText(line, { x: MARGIN + indent, y: y - size, size, font, color: opts.color ?? INK });
      y -= size + 4;
    }
    y -= opts.gap ?? 2;
  };
  const rule = () => {
    if (y - 8 < bottom) newPage();
    page.drawLine({ start: { x: MARGIN, y: y - 4 }, end: { x: PAGE[0] - MARGIN, y: y - 4 }, thickness: 0.5, color: rgb(0.8, 0.78, 0.72) });
    y -= 12;
  };
  const tz = input.timeZone;
  const stamp = (d: Date) => `${formatInZone(d, tz)} (${d.toISOString()})`;

  // Header.
  text(input.firmName.toUpperCase(), { size: 9, color: MUTED, gap: 4 });
  text(input.formName, { font: bold, size: 18, gap: 4 });
  text(`Submission #${input.number}${input.isTest ? "  ·  TEST SUBMISSION (not a real record)" : ""}`, { font: bold, size: 11, gap: 6 });
  if (input.respondent) text(`Respondent: ${input.respondent}`);
  text(`Form version: ${input.formVersion}`);
  text(`Started: ${stamp(input.startedAt)}`);
  text(`Submitted: ${stamp(input.submittedAt)}`);
  text(`Reference: ${input.submissionId}`, { size: 8, color: MUTED, gap: 8 });
  rule();

  // Answers.
  for (const section of input.sections) {
    if (!section.rows.length) continue;
    if (section.title) text(section.title, { font: bold, size: 13, gap: 6 });
    for (const row of section.rows) {
      if (y - 30 < bottom) newPage();
      text(row.label, { font: bold, size: 9, color: MUTED, gap: 0 });
      text(row.value || "(no answer)", { size: 10, gap: 6, color: row.value ? INK : MUTED });
    }
    y -= 4;
  }

  // Signature.
  const sig = input.signature;
  if (sig) {
    rule();
    text("Signature", { font: bold, size: 13, gap: 6 });
    if (y - 70 < bottom) newPage();
    const box = { x: MARGIN, y: y - 56, width: 260, height: 52 };
    page.drawRectangle({ ...box, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.5 });
    if (sig.method === "drawn" && sig.png) {
      const img = await pdf.embedPng(sig.png);
      const scale = Math.min((box.width - 8) / img.width, (box.height - 8) / img.height);
      page.drawImage(img, { x: box.x + (box.width - img.width * scale) / 2, y: box.y + (box.height - img.height * scale) / 2, width: img.width * scale, height: img.height * scale });
    } else {
      const italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
      const typed = (sig.typed ?? sig.signedName).replace(/[^ -~ -ÿ]/g, "?").slice(0, 120);
      let size = 26;
      while (size > 8 && italic.widthOfTextAtSize(typed, size) > box.width - 10) size -= 1;
      page.drawText(typed, { x: box.x + 5, y: box.y + (box.height - size) / 2 + size * 0.2, size, font: italic, color: rgb(0.05, 0.1, 0.35) });
    }
    y -= 64;
    text(`Signed by: ${sig.signedName} (${sig.method === "drawn" ? "drawn" : "typed"} by the signer)`);
    text(`Consented and signed: ${stamp(sig.consentedAt)}`, { gap: 6 });
    text("Consent the signer agreed to before signing", { font: bold, size: 10, gap: 2 });
    text(sig.consentText, { size: 9, gap: 6 });
    text(`Network address (one-way hash): ${sig.ipHash ?? "not available"}`, { size: 8, color: MUTED });
    text(`Browser: ${sig.userAgent ?? "not available"}`, { size: 8, color: MUTED, gap: 6 });
  }

  // Attachments list, then the files themselves.
  if (input.attachments.length) {
    rule();
    text("Uploaded files (included on the following pages)", { font: bold, size: 13, gap: 6 });
    input.attachments.forEach((a, i) => text(`${i + 1}. ${a.fieldLabel}: ${a.fileName} (${sizeText(a.sizeBytes)}), SHA-256 ${a.sha256}`, { size: 9, gap: 3 }));
  }
  for (const [i, a] of input.attachments.entries()) {
    const caption = `Attachment ${i + 1}: ${a.fieldLabel} · ${a.fileName} · SHA-256 ${a.sha256}`;
    if (a.kind === "pdf") {
      try {
        const src = await PDFDocument.load(a.bytes, { updateMetadata: false });
        newPage();
        text(`Attachment ${i + 1} of ${input.attachments.length}`, { font: bold, size: 14, gap: 6 });
        text(`${a.fieldLabel}`, { gap: 2 });
        text(`${a.fileName} (${sizeText(a.sizeBytes)}, ${src.getPageCount()} page${src.getPageCount() === 1 ? "" : "s"})`, { gap: 2 });
        text(`SHA-256 ${a.sha256}`, { size: 8, color: MUTED });
        for (const p of await pdf.copyPages(src, src.getPageIndices())) pdf.addPage(p);
      } catch {
        newPage();
        text(caption, { font: bold, size: 11, gap: 6 });
        text("This PDF could not be copied into this document. The original file is kept with the submission.", { color: MUTED });
      }
      continue;
    }
    newPage();
    text(caption, { font: bold, size: 9, gap: 6 });
    try {
      const img = a.kind === "jpg" ? await pdf.embedJpg(a.bytes) : await pdf.embedPng(a.bytes);
      const room = { w: WIDTH, h: y - bottom };
      const scale = Math.min(room.w / img.width, room.h / img.height, 1);
      page.drawImage(img, { x: MARGIN + (room.w - img.width * scale) / 2, y: y - img.height * scale, width: img.width * scale, height: img.height * scale });
    } catch {
      text("This image could not be placed in this document. The original file is kept with the submission.", { color: MUTED });
    }
  }

  // Footer on every page, including appended ones.
  const pages = pdf.getPages();
  const footer = `${input.formName} · Submission #${input.number} · Generated ${formatInZone(input.generatedAt, tz)}`;
  pages.forEach((p, i) => {
    const { width } = p.getSize();
    const line = drawable(regular, `${footer} · Page ${i + 1} of ${pages.length}`);
    let size = 7.5;
    while (size > 5 && regular.widthOfTextAtSize(line, size) > width - 40) size -= 0.5;
    p.drawText(line, { x: 20, y: 16, size, font: regular, color: MUTED });
  });
  return pdf.save();
}
