"use client";

import type { LeafBlock } from "@/lib/sites/blocks.ts";

// The fields of one element (heading, text, picture, button, ...) in the page editor's settings panel. What is entered is
// sent to the server with the rest of the page and checked there again; nothing here is trusted.

export type PickImage = { id: string; label: string; url: string };
export type PickBooking = { slug: string; name: string };
export type PickForm = { id: string; name: string };

export function LeafFields({ block, onChange, images, bookings, forms }: { block: LeafBlock; onChange: (b: LeafBlock) => void; images: PickImage[]; bookings: PickBooking[]; forms: PickForm[] }) {
  const set = (patch: Partial<LeafBlock>) => onChange({ ...block, ...patch } as LeafBlock);
  switch (block.type) {
    case "heading":
      return (
        <div className="se-fields">
          <label className="se-wide">Heading<input value={block.text} maxLength={200} onChange={(e) => set({ text: e.target.value })} /></label>
          <label>Size<select value={block.level} onChange={(e) => set({ level: Number(e.target.value) as 1 | 2 | 3 })}><option value={1}>Large</option><option value={2}>Medium</option><option value={3}>Small</option></select></label>
          <label>Align<select value={block.align} onChange={(e) => set({ align: e.target.value as "left" | "center" })}><option value="left">Left</option><option value="center">Centered</option></select></label>
        </div>
      );
    case "text":
      return (
        <div className="se-fields">
          <label className="se-wide">Text (a blank line starts a new paragraph)<textarea value={block.text} rows={6} maxLength={5000} onChange={(e) => set({ text: e.target.value })} /></label>
          <label>Align<select value={block.align} onChange={(e) => set({ align: e.target.value as "left" | "center" })}><option value="left">Left</option><option value="center">Centered</option></select></label>
        </div>
      );
    case "image": {
      const picked = images.find((x) => x.id === block.imageId);
      return (
        <div className="se-fields">
          <label className="se-wide">Picture
            <select value={block.imageId} onChange={(e) => set({ imageId: e.target.value })}>
              <option value="">Choose a picture…</option>
              {images.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </label>
          {images.length === 0 && <p className="monarch-muted se-wide">No pictures yet. Upload one below, then choose it here.</p>}
          {picked && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={picked.url} alt="" className="se-thumb" />
          )}
          <label className="se-wide">Describe the picture (for people who can&apos;t see it)<input value={block.alt} maxLength={200} onChange={(e) => set({ alt: e.target.value })} /></label>
          <label>Size<select value={block.size} onChange={(e) => set({ size: e.target.value as "full" | "half" })}><option value="full">Full width</option><option value="half">Half width</option></select></label>
        </div>
      );
    }
    case "button":
      return (
        <div className="se-fields">
          <label>Button text<input value={block.label} maxLength={60} onChange={(e) => set({ label: e.target.value })} /></label>
          <label>Goes to<input value={block.href} maxLength={500} onChange={(e) => set({ href: e.target.value })} placeholder="/about, https://…, tel:+1…, mailto:…" /></label>
          <label>Look<select value={block.style} onChange={(e) => set({ style: e.target.value as "primary" | "secondary" })}><option value="primary">Filled</option><option value="secondary">Outline</option></select></label>
          <label>Align<select value={block.align} onChange={(e) => set({ align: e.target.value as "left" | "center" })}><option value="left">Left</option><option value="center">Centered</option></select></label>
        </div>
      );
    case "booking":
      return (
        <div className="se-fields">
          <label className="se-wide">Booking page
            <select value={block.slug} onChange={(e) => set({ slug: e.target.value })}>
              <option value="">Choose a booking page…</option>
              {bookings.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
            </select>
          </label>
          {bookings.length === 0 && <p className="monarch-muted se-wide">No active booking pages yet. Create an appointment type in Calendar first.</p>}
          <label>Height (pixels)<input type="number" min={400} max={1200} step={20} value={block.height} onChange={(e) => set({ height: Number(e.target.value) })} /></label>
        </div>
      );
    case "form":
      return (
        <div className="se-fields">
          <label className="se-wide">Form
            <select value={block.formId} onChange={(e) => set({ formId: e.target.value })}>
              <option value="">Choose a form…</option>
              {forms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
          {forms.length === 0 && <p className="monarch-muted se-wide">No published forms yet. Publish a form in Forms first.</p>}
          <label>Height (pixels)<input type="number" min={400} max={1600} step={20} value={block.height} onChange={(e) => set({ height: Number(e.target.value) })} /></label>
        </div>
      );
    case "html":
      return (
        <div className="se-fields">
          <label className="se-wide">HTML, CSS and script (paste your code)<textarea value={block.code} rows={12} maxLength={60000} spellCheck={false} style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 13 }} onChange={(e) => set({ code: e.target.value })} /></label>
          <label>Starting height (pixels)<input type="number" min={100} max={2000} step={20} value={block.height} onChange={(e) => set({ height: Number(e.target.value) })} /></label>
          <p className="monarch-muted se-wide">Your code runs in its own box on the page, so it can&apos;t reach your account or this system. It grows to fit what you paste. Search engines may not read text inside it, so keep key wording in Heading and Text blocks. Links open in a new tab.</p>
        </div>
      );
    case "spacer":
      return <div className="se-fields"><label>Space<select value={block.size} onChange={(e) => set({ size: e.target.value as "small" | "medium" | "large" })}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label></div>;
    case "divider":
      return <p className="monarch-muted">A thin line across the page.</p>;
  }
}
