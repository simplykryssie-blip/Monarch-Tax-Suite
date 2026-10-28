import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { drawable, fontBytes, wrap } from "../forms/pdf.ts";
import { practiceForms, type PracticeForm } from "./documents.ts";
import { compute, fmt, LINES, normalizeReturn, type LineKey } from "./engine.ts";
import { INTAKE } from "./intake.ts";
import type { LabKey, LabScenario } from "./types.ts";

// Printable Tax Lab PDFs: the intake packet (client notes or not, a blank intake sheet, the household roster, the
// practice forms, and for instructors the answer key) and a student's return summary. Letter size, Noto Sans (the
// font the platform's other PDFs use), so every character in a scenario prints.

const PAGE: [number, number] = [612, 792];
const M = 54;
const W = PAGE[0] - M * 2;
const INK = rgb(0.09, 0.09, 0.08);
const MUTED = rgb(0.42, 0.4, 0.35);
const RULE = rgb(0.8, 0.78, 0.72);
const GOLD = rgb(0.83, 0.65, 0.16);

class Writer {
  page: PDFPage;
  y = PAGE[1] - M;
  constructor(public doc: PDFDocument, public regular: PDFFont, public bold: PDFFont) {
    this.page = doc.addPage(PAGE);
  }
  newPage() { this.page = this.doc.addPage(PAGE); this.y = PAGE[1] - M; }
  need(h: number) { if (this.y - h < M) this.newPage(); }
  text(s: string, size = 10, font: PDFFont = this.regular, color = INK, x = M, width = W) {
    for (const line of wrap(font, s, size, width)) {
      this.need(size * 1.45);
      this.page.drawText(line, { x, y: this.y - size, size, font, color });
      this.y -= size * 1.45;
    }
  }
  gap(h = 8) { this.y -= h; }
  h1(s: string) { this.need(40); this.text(s, 18, this.bold); this.gap(2); }
  h2(s: string) {
    this.need(40);
    this.gap(8);
    this.text(s, 12, this.bold);
    this.page.drawLine({ start: { x: M, y: this.y + 3 }, end: { x: M + W, y: this.y + 3 }, thickness: 0.6, color: RULE });
    this.gap(6);
  }
  lines(n: number) {
    for (let i = 0; i < n; i++) {
      this.need(22);
      this.y -= 20;
      this.page.drawLine({ start: { x: M, y: this.y }, end: { x: M + W, y: this.y }, thickness: 0.5, color: RULE });
    }
    this.gap(8);
  }
  right(s: string, xRight: number, size = 10, font: PDFFont = this.regular) {
    const t = drawable(font, s);
    this.page.drawText(t, { x: xRight - font.widthOfTextAtSize(t, size), y: this.y - size, size, font, color: INK });
  }
  fit(s: string, width: number, size: number, font: PDFFont) {
    let t = drawable(font, s);
    while (t.length > 1 && font.widthOfTextAtSize(t, size) > width) t = t.slice(0, -2) + "…";
    return t;
  }
  form(f: PracticeForm) {
    const rows: PracticeForm["boxes"][] = [];
    let row: PracticeForm["boxes"] = [];
    for (const b of f.boxes) {
      if (b.wide) { if (row.length) rows.push(row); row = []; rows.push([b]); }
      else { row.push(b); if (row.length === 2) { rows.push(row); row = []; } }
    }
    if (row.length) rows.push(row);
    const h = 24 + rows.length * 30;
    this.need(h + 12);
    const top = this.y;
    this.page.drawRectangle({ x: M, y: top - h, width: W, height: h, borderColor: INK, borderWidth: 1.1 });
    this.page.drawText(drawable(this.bold, f.title), { x: M + 6, y: top - 16, size: 12, font: this.bold, color: INK });
    this.page.drawText(drawable(this.regular, f.subtitle), { x: M + 110, y: top - 16, size: 8, font: this.regular, color: INK });
    const stamp = "PRACTICE COPY - NOT A TAX DOCUMENT";
    this.page.drawText(stamp, { x: M + W - 6 - this.regular.widthOfTextAtSize(stamp, 7), y: top - 15, size: 7, font: this.regular, color: MUTED });
    this.page.drawLine({ start: { x: M, y: top - 22 }, end: { x: M + W, y: top - 22 }, thickness: 1.1, color: INK });
    let y = top - 22;
    for (const r of rows) {
      const w = r[0].wide ? W : W / 2;
      r.forEach((b, i) => {
        const x = M + i * w;
        this.page.drawRectangle({ x, y: y - 30, width: w, height: 30, borderColor: RULE, borderWidth: 0.5 });
        this.page.drawText(this.fit(b.label, w - 8, 7, this.regular), { x: x + 4, y: y - 9, size: 7, font: this.regular, color: MUTED });
        const v = this.fit(b.value, w - 10, 10, this.bold);
        const vx = b.wide ? x + 4 : x + w - 5 - this.bold.widthOfTextAtSize(v, 10);
        this.page.drawText(v, { x: vx, y: y - 24, size: 10, font: this.bold, color: INK });
      });
      y -= 30;
    }
    this.y = top - h - 14;
  }
}

async function start(title: string): Promise<Writer> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const f = await fontBytes();
  const regular = await doc.embedFont(f.regular, { subset: false });
  const bold = await doc.embedFont(f.bold, { subset: false });
  doc.setTitle(title);
  doc.setCreator("Monarch Tax Lab");
  doc.setProducer("Monarch Tax Suite");
  const w = new Writer(doc, regular, bold);
  w.page.drawRectangle({ x: M, y: w.y - 3, width: 48, height: 3, color: GOLD });
  w.gap(10);
  w.text("MONARCH TAX LAB  ·  PRACTICE SCENARIO  ·  TAX YEAR 2026", 8, bold, MUTED);
  return w;
}

function blankIntake(w: Writer) {
  w.h2("Intake & interview sheet");
  for (const s of INTAKE) {
    w.need(40);
    w.text(s.sec, 10, w.bold);
    if (s.checks) {
      for (let i = 0; i < s.checks.length; i += 2) {
        w.need(16);
        [0, 1].forEach((j) => {
          const c = s.checks![i + j];
          if (!c) return;
          const x = M + j * (W / 2);
          w.page.drawRectangle({ x, y: w.y - 10, width: 8, height: 8, borderColor: INK, borderWidth: 0.7 });
          w.page.drawText(w.fit(c[1], W / 2 - 18, 9, w.regular), { x: x + 13, y: w.y - 9, size: 9, font: w.regular, color: INK });
        });
        w.y -= 15;
      }
      w.gap(2);
    }
    for (const [, label, kind] of s.fields ?? []) {
      w.text(label, 9, w.regular, MUTED);
      w.lines(kind === "line" ? 1 : 3);
    }
  }
}

/** The intake packet. Students get the notes only for "notes provided" scenarios; instructors always do, plus the key. */
export async function buildPacketPdf(s: LabScenario, opts: { instructor: boolean; key: LabKey | null }): Promise<Uint8Array> {
  const w = await start(`${s.title} - intake packet`);
  w.h1(s.title);
  w.text(`${s.level}${opts.instructor ? "  ·  INSTRUCTOR COPY: contains the answer key" : ""}`, 9, w.regular, MUTED);
  w.gap(4);
  if (opts.instructor || s.intake_mode === "notes") {
    w.h2(s.intake_mode === "notes" ? "Client interview notes" : "Client story (your script for playing the client)");
    for (const p of (s.narrative || "No interview notes.").split(/\n\s*\n/)) { w.text(p.trim(), 10); w.gap(4); }
    if (s.facts.length) { w.h2("Key facts"); for (const f of s.facts) w.text(`${f.label}: ${f.value}`, 10); }
  } else {
    w.gap(4);
    w.text("Interview the client to collect the facts you need, and record them on the intake sheet below.", 10);
  }
  blankIntake(w);
  const docs = s.documents ?? {};
  if (docs.household?.length) {
    w.h2("Household roster");
    for (const p of docs.household) w.text(`${p.role}: ${p.name || "—"}${p.info ? `  (${p.info})` : ""}`, 10);
  }
  const forms = practiceForms(docs);
  if (forms.length) { w.h2("Documents the client brought"); for (const f of forms) w.form(f); }
  if (opts.instructor) {
    w.newPage();
    w.h2("Answer key");
    if (!opts.key) w.text("Save the scenario to create its answer key.", 10);
    else {
      const checks = new Set<LineKey>(opts.key.checks);
      for (const [k, ln, label] of LINES) {
        w.need(16);
        const font = checks.has(k) ? w.bold : w.regular;
        w.page.drawText(`Line ${ln}`, { x: M, y: w.y - 10, size: 10, font, color: INK });
        w.page.drawText(w.fit(label, W - 160, 10, font), { x: M + 64, y: w.y - 10, size: 10, font, color: INK });
        w.right(fmt(opts.key.line_values[k] ?? 0), M + W, 10, font);
        w.y -= 15;
      }
      w.gap(6);
      w.text("Bold lines are checked automatically for students.", 8, w.regular, MUTED);
    }
  }
  return w.doc.save();
}

/** A student's return summary (Summary / Print in the practice software). */
export async function buildReturnPdf(title: string, retInput: unknown): Promise<Uint8Array> {
  const ret = normalizeReturn(retInput);
  const c = compute(ret);
  const name = `${ret.tp.first} ${ret.tp.last}`.trim();
  const w = await start(`${title} - return summary`);
  w.h1(`Form 1040 summary${name ? `: ${name}` : ""}`);
  w.text(title, 9, w.regular, MUTED);
  w.gap(8);
  for (const [k, ln, label] of LINES) {
    w.need(16);
    w.page.drawText(`Line ${ln}`, { x: M, y: w.y - 10, size: 10, font: w.regular, color: INK });
    w.page.drawText(w.fit(label, W - 160, 10, w.regular), { x: M + 64, y: w.y - 10, size: 10, font: w.regular, color: INK });
    w.right(fmt(c.lines[k]), M + W, 10);
    w.y -= 15;
  }
  if (c.notes.length) { w.h2("Notes"); for (const nte of c.notes) w.text(`• ${nte}`, 9); }
  return w.doc.save();
}
