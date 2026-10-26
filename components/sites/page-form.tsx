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
    case "list":
      return (
        <div className="se-fields">
          <label className="se-wide">Lines (one per line)<textarea rows={6} value={block.items.join("\n")} maxLength={6000} onChange={(e) => set({ items: e.target.value.split("\n").slice(0, 30) })} /></label>
          <label>Marker<select value={block.icon} onChange={(e) => set({ icon: e.target.value as "check" | "arrow" | "dot" })}><option value="check">Tick</option><option value="arrow">Arrow</option><option value="dot">Dot</option></select></label>
        </div>
      );
    case "faq":
      return (
        <div className="se-fields">
          {block.items.map((it, i) => (
            <div key={i} className="se-wide fq-item">
              <label>Question<input value={it.q} maxLength={200} onChange={(e) => set({ items: block.items.map((x, k) => (k === i ? { ...x, q: e.target.value } : x)) })} /></label>
              <label>Answer<textarea rows={3} value={it.a} maxLength={2000} onChange={(e) => set({ items: block.items.map((x, k) => (k === i ? { ...x, a: e.target.value } : x)) })} /></label>
              <button type="button" className="monarch-secondary" onClick={() => set({ items: block.items.filter((_, k) => k !== i) })} disabled={block.items.length < 2}>Remove this question</button>
            </div>
          ))}
          {block.items.length < 20 && <button type="button" className="monarch-secondary se-wide" onClick={() => set({ items: [...block.items, { q: "New question?", a: "Answer." }] })}>+ Add a question</button>}
        </div>
      );
    case "testimonial":
      return (
        <div className="se-fields">
          <label className="se-wide">What they said<textarea rows={4} value={block.quote} maxLength={1000} onChange={(e) => set({ quote: e.target.value })} /></label>
          <label>Name<input value={block.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} /></label>
          <label>Role or business<input value={block.role} maxLength={120} onChange={(e) => set({ role: e.target.value })} /></label>
          <label className="se-wide">Picture (optional)
            <select value={block.imageId} onChange={(e) => set({ imageId: e.target.value })}><option value="">None</option>{images.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
          </label>
        </div>
      );
    case "video":
      return (
        <div className="se-fields">
          <label className="se-wide">YouTube or Vimeo link<input value={block.url} maxLength={300} placeholder="https://www.youtube.com/watch?v=…" onChange={(e) => set({ url: e.target.value })} /></label>
          <p className="monarch-muted se-wide">Paste the link from the video&apos;s address bar. It plays right on your page.</p>
        </div>
      );
    case "gallery":
      return (
        <div className="se-fields">
          <p className="se-wide monarch-muted">Tick the pictures to show (up to 12). Upload more from the Add tab.</p>
          <div className="se-wide fq-picks">
            {images.map((x) => {
              const on = block.imageIds.includes(x.id);
              return (
                <label key={x.id} className="se-check">
                  <input type="checkbox" checked={on} onChange={(e) => set({ imageIds: e.target.checked ? [...block.imageIds, x.id].slice(0, 12) : block.imageIds.filter((i) => i !== x.id) })} />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={x.url} alt="" className="se-thumb" /> {x.label}
                </label>
              );
            })}
            {images.length === 0 && <p className="monarch-muted">No pictures yet.</p>}
          </div>
          <label>Columns<select value={block.columns} onChange={(e) => set({ columns: Number(e.target.value) as 2 | 3 | 4 })}><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option></select></label>
        </div>
      );
    case "map":
      return (
        <div className="se-fields">
          <label className="se-wide">Address<input value={block.address} maxLength={200} placeholder="123 Main St, Baton Rouge, LA" onChange={(e) => set({ address: e.target.value })} /></label>
          <label>Height (pixels)<input type="number" min={200} max={800} step={20} value={block.height} onChange={(e) => set({ height: Number(e.target.value) })} /></label>
        </div>
      );
    case "spacer":
      return <div className="se-fields"><label>Space<select value={block.size} onChange={(e) => set({ size: e.target.value as "small" | "medium" | "large" })}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label></div>;
    case "divider":
      return <p className="monarch-muted">A thin line across the page.</p>;
  }
}
