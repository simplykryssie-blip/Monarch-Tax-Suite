import { newRow, type LeafBlock, type SectionBlock } from "./blocks.ts";

// Starting sections for the page builder's "Sections" list: a few common building blocks to click in and then reword. They are
// ordinary sections (nothing special once added) and say nothing about a particular firm.

export type SectionTemplate = { key: string; label: string; hint: string; make: (ids: () => string) => SectionBlock };

const heading = (id: string, text: string, level: 1 | 2 | 3 = 2, align: "left" | "center" = "left"): LeafBlock => ({ id, type: "heading", text, level, align });
const text = (id: string, t: string, align: "left" | "center" = "left"): LeafBlock => ({ id, type: "text", text: t, align });
const button = (id: string, label: string, align: "left" | "center" = "left"): LeafBlock => ({ id, type: "button", label, href: "/contact", style: "primary", align });

function section(ids: () => string, layout: Parameters<typeof newRow>[0], columns: (() => LeafBlock[])[], extra: Partial<SectionBlock> = {}): SectionBlock {
  const row = newRow(layout, ids);
  row.columns.forEach((c, i) => { c.children = columns[i]?.() ?? []; });
  return { id: ids(), type: "section", tone: "plain", pad: "large", width: "wide", rows: [row], ...extra };
}

export const SECTION_TEMPLATES: SectionTemplate[] = [
  {
    key: "hero", label: "Hero", hint: "Big headline and a button",
    make: (ids) => section(ids, "1", [() => [heading(ids(), "Your headline goes here", 1, "center"), text(ids(), "Say in a sentence or two what you do and who it is for.", "center"), button(ids(), "Get in touch", "center")]], { tone: "soft", width: "narrow", pad: "large" }),
  },
  {
    key: "text-picture", label: "Text and picture", hint: "Words beside a picture",
    make: (ids) => section(ids, "1-1", [() => [heading(ids(), "About us"), text(ids(), "Tell your story here. Who you are, what you believe in, and how you help."), button(ids(), "Learn more")], () => [{ id: ids(), type: "image", imageId: "", alt: "", size: "full" }]]),
  },
  {
    key: "features", label: "Three highlights", hint: "Three short points side by side",
    make: (ids) => section(ids, "1-1-1", [1, 2, 3].map((n) => () => [heading(ids(), `Highlight ${n}`, 3), text(ids(), "One or two sentences about this.")])),
  },
  {
    key: "cta", label: "Call to action", hint: "A banner with a button",
    make: (ids) => section(ids, "1", [() => [heading(ids(), "Ready to get started?", 2, "center"), button(ids(), "Book a time", "center")]], { tone: "accent", width: "narrow", pad: "medium" }),
  },
  {
    key: "contact", label: "Contact details", hint: "Text beside a booking form",
    make: (ids) => section(ids, "1-2", [() => [heading(ids(), "Contact us", 2), text(ids(), "We reply within one business day.")], () => [{ id: ids(), type: "booking", slug: "", height: 760 }]]),
  },
];
