import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { drawable, fontBytes } from "../forms/pdf.ts";
import { dollars, periodLabel, STATUS_LABEL, type Statement } from "./engine.ts";
import type { Bank } from "./types.ts";

// An office's statement as a PDF: the totals, the fees by line item, every return with what it owes and what's been
// collected, and the payments received. Landscape so the return table fits.

const PAGE: [number, number] = [792, 612];
const M = 40;
const W = PAGE[0] - M * 2;
const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.4, 0.38, 0.34);
const RULE = rgb(0.82, 0.79, 0.72);
const GOLD = rgb(191 / 255, 149 / 255, 63 / 255);
const SHADE = rgb(0.97, 0.95, 0.9);

export async function buildStatementPdf(input: { bureauName: string; officeName: string; statement: Statement; banks: Bank[]; generatedAt: Date }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const f = await fontBytes();
  // The whole font, not a subset: pdf-lib's subsetting of Noto Sans drops glyph outlines in some viewers.
  const regular = await doc.embedFont(f.regular, { subset: false });
  const bold = await doc.embedFont(f.bold, { subset: false });
  const s = input.statement;
  const date = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "America/Chicago" }).format(input.generatedAt);
  doc.setTitle(`Statement — ${input.officeName} — ${periodLabel(s.period)}`);
  doc.setCreator(`${input.bureauName} Fees & Statements`);
  doc.setProducer(input.bureauName);
  doc.setCreationDate(input.generatedAt);

  let page: PDFPage = doc.addPage(PAGE);
  let y = PAGE[1] - M;
  const text = (v: string, x: number, size = 9, font: PDFFont = regular, color = INK) => page.drawText(drawable(font, v), { x, y: y - size, size, font, color });
  const fit = (v: string, width: number, size: number, font: PDFFont = regular) => {
    let out = drawable(font, v);
    while (out.length > 1 && font.widthOfTextAtSize(out, size) > width) out = out.slice(0, -2) + "…";
    return out;
  };
  const right = (v: string, xRight: number, size = 9, font: PDFFont = regular) => page.drawText(v, { x: xRight - font.widthOfTextAtSize(v, size), y: y - size, size, font, color: INK });
  const newPage = () => { page = doc.addPage(PAGE); y = PAGE[1] - M; };
  const ensure = (h: number, header?: () => void) => { if (y - h < M + 24) { newPage(); header?.(); } };

  // Header
  page.drawRectangle({ x: M, y: y - 3, width: 48, height: 3, color: GOLD });
  y -= 12;
  text("STATEMENT", M, 18, bold);
  right(input.bureauName, M + W, 11, bold);
  y -= 24;
  text(input.officeName, M, 12, bold);
  right(`Generated ${date}`, M + W, 9);
  y -= 16;
  text(periodLabel(s.period), M, 10, regular, MUTED);
  y -= 26;

  // Summary
  const boxes: [string, string][] = [
    ["Returns", String(s.totals.returns)],
    ["Fees owed", dollars(s.totals.owed)],
    ["Collected", dollars(s.totals.collected)],
    ["Balance", dollars(s.totals.balance)],
    ["Owed by ERO", dollars(s.totals.owedByEro)],
  ];
  const bw = (W - 4 * 10) / 5;
  boxes.forEach(([k, v], i) => {
    const x = M + i * (bw + 10);
    page.drawRectangle({ x, y: y - 46, width: bw, height: 46, color: SHADE, borderColor: RULE, borderWidth: 0.6 });
    page.drawText(fit(k.toUpperCase(), bw - 16, 7, bold), { x: x + 8, y: y - 14, size: 7, font: bold, color: MUTED });
    page.drawText(v, { x: x + 8, y: y - 36, size: 14, font: bold, color: INK });
  });
  y -= 64;

  // Fees by line item
  text("FEES BY LINE ITEM", M, 9, bold, MUTED);
  y -= 16;
  if (!s.byFee.length) { text("No fees in this period.", M, 9, regular, MUTED); y -= 14; }
  for (const fee of s.byFee) {
    ensure(14);
    text(fit(fee.label, 260, 9), M, 9);
    right(`${fee.count} × `, M + 360, 9);
    right(dollars(fee.amount), M + 460, 9, bold);
    y -= 14;
  }
  y -= 12;

  // Returns
  const cols = [
    { h: "Return", x: M, w: 86 }, { h: "Taxpayer", x: M + 90, w: 150 }, { h: "Filed", x: M + 244, w: 60 }, { h: "Bank product", x: M + 308, w: 100 },
    { h: "Fees", x: M + 412, w: 60, r: true }, { h: "Collected", x: M + 476, w: 60, r: true }, { h: "Balance", x: M + 540, w: 60, r: true }, { h: "Status", x: M + 610, w: W - 610 },
  ];
  const head = () => {
    page.drawRectangle({ x: M, y: y - 16, width: W, height: 16, color: SHADE });
    for (const c of cols) {
      const x = c.r ? c.x + c.w - bold.widthOfTextAtSize(c.h, 8) : c.x + 2;
      page.drawText(c.h, { x, y: y - 11, size: 8, font: bold, color: INK });
    }
    y -= 20;
  };
  ensure(60);
  text("RETURNS", M, 9, bold, MUTED);
  y -= 16;
  head();
  const bankName = (id: string | null) => (id ? input.banks.find((b) => b.id === id)?.name ?? "Bank product" : "None");
  if (!s.lines.length) { text("No returns in this period.", M, 9, regular, MUTED); y -= 14; }
  for (const l of s.lines) {
    ensure(14, head);
    const cells = [l.ret.return_ref, l.ret.taxpayer_name, l.ret.filed_on ?? "—", bankName(l.ret.bank_option_id), dollars(l.owed), dollars(l.collected), dollars(l.balance), STATUS_LABEL[l.status]];
    cols.forEach((c, i) => {
      if (c.r) right(cells[i], c.x + c.w, 8.5);
      else page.drawText(fit(cells[i], c.w - 4, 8.5), { x: c.x + 2, y: y - 8.5, size: 8.5, font: regular, color: INK });
    });
    y -= 13;
    page.drawLine({ start: { x: M, y: y + 2 }, end: { x: M + W, y: y + 2 }, thickness: 0.3, color: RULE });
  }
  ensure(16, head);
  y -= 4;
  page.drawText("Total", { x: M + 2, y: y - 9, size: 9, font: bold, color: INK });
  right(dollars(s.totals.owed), cols[4].x + cols[4].w, 9, bold);
  right(dollars(s.totals.collected), cols[5].x + cols[5].w, 9, bold);
  right(dollars(s.totals.balance), cols[6].x + cols[6].w, 9, bold);
  y -= 28;

  // Payments
  ensure(40);
  text("PAYMENTS RECEIVED", M, 9, bold, MUTED);
  y -= 16;
  if (!s.payments.length) { text("No payments recorded in this period.", M, 9, regular, MUTED); y -= 14; }
  for (const p of s.payments) {
    ensure(14);
    text(p.date ?? "—", M, 9);
    text(p.kind === "bank" ? "Bank product" : "Paid by ERO", M + 90, 9);
    text(fit(`Return ${p.ref}${p.reference ? ` · ${p.reference}` : ""}`, 300, 9), M + 200, 9);
    right(dollars(p.amount), M + 600, 9, bold);
    y -= 14;
  }

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 30 }, end: { x: M + W, y: 30 }, thickness: 0.5, color: RULE });
    p.drawText(drawable(regular, `${input.officeName} · ${periodLabel(s.period)}`).slice(0, 120), { x: M, y: 18, size: 7.5, font: regular, color: MUTED });
    const n = `Page ${i + 1} of ${pages.length}`;
    p.drawText(n, { x: M + W - regular.widthOfTextAtSize(n, 7.5), y: 18, size: 7.5, font: regular, color: MUTED });
  });
  return doc.save();
}
