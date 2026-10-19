import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { fontBytes, wrap } from "../forms/pdf.ts";
import { DISCLAIMER, type WispAnswers } from "./content.ts";
import { buildPlan, type PlanBlock, type PlanVoice } from "./plan.ts";

// The finished WISP, made on the server: a cover, a contents page, then the plan from ./plan.ts with each section on
// its own page under a gold header, and the attorney-ready disclaimer. Noto Sans so names in most languages print.

export type WispPdfInput = { answers: WispAnswers; brandName: string; generatedAt: Date; planId: string; /** "sole" for a single practitioner; the default is a firm with staff. */ voice?: PlanVoice };

const PAGE: [number, number] = [612, 792];
const MARGIN = 64;
const WIDTH = PAGE[0] - MARGIN * 2;
const BOTTOM = MARGIN + 30;
const INK = rgb(0.08, 0.08, 0.08);
const MUTED = rgb(0.38, 0.36, 0.32);
const RULE = rgb(0.78, 0.74, 0.66);
const GOLD = rgb(191 / 255, 149 / 255, 63 / 255);
const BODY = 10.5;
const LEAD = 15;

export async function buildWispPdf(input: WispPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const f = await fontBytes();
  // The whole font, not a subset: pdf-lib's subsetting of Noto Sans drops glyph outlines in some viewers.
  const regular = await doc.embedFont(f.regular, { subset: false });
  const bold = await doc.embedFont(f.bold, { subset: false });
  const d = input.answers;
  const firm = d.firm_name?.trim() || "Firm";
  const date = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "America/New_York" }).format(input.generatedAt);
  doc.setTitle(`Written Information Security Plan — ${firm}`);
  doc.setAuthor(d.firm_name ?? "");
  doc.setCreator(`${input.brandName} WISP Generator`);
  doc.setProducer(input.brandName);
  doc.setCreationDate(input.generatedAt);

  let page: PDFPage = doc.addPage(PAGE);
  let y = PAGE[1] - MARGIN;
  const newPage = () => { page = doc.addPage(PAGE); y = PAGE[1] - MARGIN; };
  const ensure = (h: number) => { if (y - h < BOTTOM) newPage(); };
  const lines = (value: string, opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; x?: number; width?: number; lead?: number } = {}) => {
    const size = opts.size ?? BODY;
    const font = opts.font ?? regular;
    const x = opts.x ?? MARGIN;
    const lead = opts.lead ?? LEAD;
    for (const line of wrap(font, value, size, opts.width ?? WIDTH - (x - MARGIN))) {
      ensure(lead);
      page.drawText(line, { x, y: y - size, size, font, color: opts.color ?? INK });
      y -= lead;
    }
  };

  // ---- Cover
  y -= 120;
  page.drawRectangle({ x: MARGIN, y: y + 18, width: 64, height: 4, color: GOLD });
  lines("WRITTEN INFORMATION", { size: 28, font: bold, lead: 36 });
  lines("SECURITY PLAN", { size: 28, font: bold, lead: 44 });
  lines(firm, { size: 16, font: bold, lead: 24 });
  if (d.address?.trim()) lines(d.address.trim(), { size: 11, color: MUTED });
  if (d.phone?.trim()) lines(d.phone.trim(), { size: 11, color: MUTED });
  y -= 24;
  const coverRow = (k: string, v: string) => {
    page.drawText(k, { x: MARGIN, y: y - 11, size: 10, font: bold, color: MUTED });
    lines(v, { size: 11, x: MARGIN + 150, lead: 18 });
  };
  coverRow("Prepared for", firm);
  coverRow("Owner / Principal", d.owner_name?.trim() || "—");
  coverRow("Plan date", date);
  coverRow("Next review", d.review_date?.trim() || "—");
  coverRow("Plan reference", input.planId.slice(0, 8));
  y -= 30;
  lines("Prepared in line with IRS Publication 5708, IRS Publication 4557 and the FTC Safeguards Rule (16 CFR Part 314).", { size: 9.5, color: MUTED, lead: 13 });
  y -= 6;
  lines(`Attorney-ready format: ${DISCLAIMER}`, { size: 9.5, color: MUTED, lead: 13 });
  page.drawText("CONFIDENTIAL — FOR INTERNAL USE BY THE FIRM", { x: MARGIN, y: BOTTOM, size: 8.5, font: bold, color: GOLD });

  // ---- Contents (filled in once the section pages are known)
  newPage();
  const contentsPage = page;
  const sections = buildPlan(d, input.voice);
  const starts: number[] = [];

  // ---- The plan
  const block = (b: PlanBlock) => {
    switch (b.kind) {
      case "p":
        lines(b.text);
        y -= 7;
        break;
      case "note":
        lines(b.text, { size: 9.5, color: MUTED, lead: 13 });
        y -= 6;
        break;
      case "h":
        y -= 4;
        ensure(LEAD * 3); // keep a heading with the start of what follows
        page.drawText(b.text, { x: MARGIN, y: y - 11.5, size: 11.5, font: bold, color: INK });
        y -= 20;
        break;
      case "list":
        b.items.forEach((item, i) => {
          const mark = b.ordered ? `${i + 1}.` : "•";
          ensure(LEAD);
          page.drawText(mark, { x: MARGIN + 6, y: y - BODY, size: BODY, font: b.ordered ? bold : regular, color: b.ordered ? INK : GOLD });
          lines(item, { x: MARGIN + 24 });
          y -= 4;
        });
        y -= 5;
        break;
      case "table": {
        const cols = b.head.length;
        const widths = cols === 2 ? [WIDTH * 0.38, WIDTH * 0.62] : [WIDTH * 0.4, WIDTH * 0.35, WIDTH * 0.25];
        const row = (cells: string[], head: boolean) => {
          const wrapped = cells.map((c, i) => wrap(head ? bold : regular, c, head ? 9.5 : 10, widths[i] - 12));
          const h = Math.max(head ? 22 : 26, ...wrapped.map((w) => w.length * 13 + 10));
          ensure(h);
          let x = MARGIN;
          wrapped.forEach((w, i) => {
            if (head) page.drawRectangle({ x, y: y - h, width: widths[i], height: h, color: rgb(0.96, 0.93, 0.85) });
            page.drawRectangle({ x, y: y - h, width: widths[i], height: h, borderColor: RULE, borderWidth: 0.6 });
            w.forEach((line, j) => page.drawText(line, { x: x + 6, y: y - 15 - j * 13, size: head ? 9.5 : 10, font: head || (cols === 2 && i === 0) ? bold : regular, color: INK }));
            x += widths[i];
          });
          y -= h;
        };
        row(b.head, true);
        b.rows.forEach((r) => row(r, false));
        y -= 14;
        break;
      }
      case "sign":
        y -= 18;
        for (const label of b.lines) {
          ensure(46);
          y -= 26;
          page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + WIDTH * 0.7, y }, thickness: 0.7, color: INK });
          page.drawText(label, { x: MARGIN, y: y - 12, size: 9, font: regular, color: MUTED });
          y -= 24;
        }
        y -= 8;
        break;
    }
  };
  sections.forEach((s, i) => {
    newPage();
    starts.push(doc.getPageCount());
    page.drawRectangle({ x: MARGIN, y: y - 26, width: WIDTH, height: 28, color: GOLD });
    page.drawText(`${i + 1}. ${s.title}`.toUpperCase(), { x: MARGIN + 10, y: y - 18, size: 12.5, font: bold, color: rgb(0, 0, 0) });
    y -= 46;
    s.blocks.forEach(block);
  });
  y -= 10;
  ensure(60);
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + WIDTH, y }, thickness: 0.6, color: RULE });
  y -= 12;
  lines(DISCLAIMER, { size: 9, color: MUTED, lead: 12 });
  lines(`Generated by ${input.brandName} WISP Generator on ${date}.`, { size: 9, color: MUTED, lead: 12 });

  // ---- Contents
  page = contentsPage;
  y = PAGE[1] - MARGIN;
  page.drawText("CONTENTS", { x: MARGIN, y: y - 18, size: 18, font: bold, color: INK });
  page.drawRectangle({ x: MARGIN, y: y - 30, width: 48, height: 3, color: GOLD });
  y -= 60;
  sections.forEach((s, i) => {
    const label = `${i + 1}.  ${s.title}`;
    const num = String(starts[i]);
    const nw = regular.widthOfTextAtSize(num, 11);
    page.drawText(label, { x: MARGIN, y: y - 11, size: 11, font: regular, color: INK });
    const from = MARGIN + regular.widthOfTextAtSize(label, 11) + 8;
    const to = MARGIN + WIDTH - nw - 8;
    if (to > from) page.drawLine({ start: { x: from, y: y - 10 }, end: { x: to, y: y - 10 }, thickness: 0.5, color: RULE, dashArray: [1, 3] });
    page.drawText(num, { x: MARGIN + WIDTH - nw, y: y - 11, size: 11, font: regular, color: INK });
    y -= 24;
  });

  // Footer on every page but the cover: firm, plan reference and page number.
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    if (i === 0) return;
    p.drawLine({ start: { x: MARGIN, y: 44 }, end: { x: PAGE[0] - MARGIN, y: 44 }, thickness: 0.5, color: RULE });
    const left = `${firm} · Written Information Security Plan · ref ${input.planId.slice(0, 8)}`.slice(0, 110);
    p.drawText(left, { x: MARGIN, y: 30, size: 8, font: regular, color: MUTED });
    const right = `Page ${i + 1} of ${pages.length}`;
    p.drawText(right, { x: PAGE[0] - MARGIN - regular.widthOfTextAtSize(right, 8), y: 30, size: 8, font: regular, color: MUTED });
  });
  return doc.save();
}
