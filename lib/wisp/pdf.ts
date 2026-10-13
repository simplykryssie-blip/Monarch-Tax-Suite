import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { fontBytes, wrap } from "../forms/pdf.ts";
import { DISCLAIMER, type WispAnswers } from "./content.ts";

// The finished WISP, made on the server. Same content and order as the owner's static build: a cover, then six
// sections with gold headers, then the attorney-ready disclaimer. Noto Sans so names in most languages print.

export type WispPdfInput = { answers: WispAnswers; brandName: string; generatedAt: Date; planId: string };

const PAGE: [number, number] = [612, 792];
const MARGIN = 56;
const WIDTH = PAGE[0] - MARGIN * 2;
const INK = rgb(0, 0, 0);
const MUTED = rgb(0.38, 0.36, 0.32);
const GOLD = rgb(191 / 255, 149 / 255, 63 / 255);

export async function buildWispPdf(input: WispPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const f = await fontBytes();
  // The whole font, not a subset: pdf-lib's subsetting of Noto Sans drops glyph outlines in some viewers.
  const regular = await doc.embedFont(f.regular, { subset: false });
  const bold = await doc.embedFont(f.bold, { subset: false });
  const d = input.answers;
  const date = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "America/New_York" }).format(input.generatedAt);
  doc.setTitle(`Written Information Security Plan — ${d.firm_name ?? "Firm"}`);
  doc.setAuthor(d.firm_name ?? "");
  doc.setCreator(`${input.brandName} WISP Generator`);
  doc.setProducer(input.brandName);
  doc.setCreationDate(input.generatedAt);

  let page: PDFPage = doc.addPage(PAGE);
  let y = PAGE[1] - MARGIN;
  const ensure = (h: number) => {
    if (y - h < MARGIN + 24) {
      page = doc.addPage(PAGE);
      y = PAGE[1] - MARGIN;
    }
  };
  const text = (value: string, opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; gap?: number } = {}) => {
    const size = opts.size ?? 11;
    const font = opts.font ?? regular;
    for (const line of wrap(font, value, size, WIDTH)) {
      ensure(size + 6);
      page.drawText(line, { x: MARGIN, y: y - size, size, font, color: opts.color ?? INK });
      y -= size + (opts.gap ?? 5);
    }
  };
  const field = (label: string, value: string | undefined) => {
    const size = 11;
    const head = `${label}: `;
    const lines = wrap(regular, value || "—", size, WIDTH - bold.widthOfTextAtSize(head, size));
    ensure(size + 6);
    page.drawText(head, { x: MARGIN, y: y - size, size, font: bold, color: INK });
    lines.forEach((line, i) => {
      if (i > 0) { y -= size + 5; ensure(size + 6); }
      page.drawText(line, { x: MARGIN + (i === 0 ? bold.widthOfTextAtSize(head, size) : 0), y: y - size, size, font: regular, color: INK });
    });
    y -= size + 9;
  };
  const section = (title: string) => {
    y -= 10;
    // Keep the header with at least its first line.
    ensure(72);
    page.drawRectangle({ x: MARGIN, y: y - 20, width: WIDTH, height: 22, color: GOLD });
    page.drawText(title.toUpperCase(), { x: MARGIN + 8, y: y - 14, size: 12, font: bold, color: INK });
    y -= 34;
  };

  // Cover
  text("WRITTEN INFORMATION", { size: 24, font: bold, gap: 6 });
  text("SECURITY PLAN", { size: 24, font: bold, gap: 14 });
  page.drawRectangle({ x: MARGIN, y: y, width: 120, height: 3, color: GOLD });
  y -= 18;
  text(`Prepared for: ${d.firm_name ?? "[Firm Name]"}`, { size: 13, font: bold });
  text(`Owner / Principal: ${d.owner_name ?? "[Name]"}`, { size: 12 });
  text(`Date: ${date}`, { size: 12 });
  text(`Review Date: ${d.review_date ?? "[Annual review date]"}`, { size: 12, gap: 14 });
  text("This Written Information Security Plan (\"WISP\") documents the administrative, technical, and physical safeguards in place to protect taxpayer information in compliance with IRS Publication 5708 and the FTC Safeguards Rule.", { size: 10, gap: 4 });
  y -= 6;
  text("Attorney-ready format: this document is professionally structured for attorney review. It is general guidance, not legal advice.", { size: 9, color: MUTED });

  section("1. Firm Information");
  field("Business Name", d.firm_name);
  field("Address", d.address);
  field("Phone", d.phone);
  field("EIN", d.ein);

  section("2. Systems & Data Inventory");
  field("Tax Software", d.tax_software);
  field("Data Locations", d.data_locations);
  field("Backup Method", d.backup_method);

  section("3. Access Controls");
  field("Authorized Users", d.num_users);
  field("MFA Status", d.mfa_status);
  field("Access Policy", d.access_policy);

  section("4. Safeguards");
  field("Encryption", d.encryption);
  field("Physical Security", d.physical_security);
  field("Staff Training", d.training);

  section("5. Incident Response Plan");
  field("Response Contact", d.ir_contact);
  field("Response Steps", d.ir_steps);

  section("6. Plan Maintenance");
  text("This WISP is reviewed annually and updated whenever systems, personnel, or threats change materially.");
  field("Next scheduled review", d.review_date);

  y -= 10;
  text(DISCLAIMER, { size: 9, color: MUTED });
  text(`Generated by ${input.brandName} WISP Generator.`, { size: 9, color: MUTED });

  // Footer on every page: plan reference and page number.
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText(`${d.firm_name ?? ""} · WISP · ref ${input.planId.slice(0, 8)} · page ${i + 1} of ${pages.length}`.slice(0, 120), { x: MARGIN, y: 28, size: 8, font: regular, color: MUTED });
  });
  return doc.save();
}
