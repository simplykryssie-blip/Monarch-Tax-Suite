"use client";

import { useState } from "react";
import { BLOCK_LABEL, LEAF_TYPES, newBlock, SECTION_TONES, type Block, type LeafBlock } from "@/lib/sites/blocks.ts";

// The page editor: a title, a short description, and a list of blocks. Each block has plain fields; blocks move up and down
// with buttons (no dragging, so it works the same on a phone and a keyboard). The whole list is sent to the server as one
// field and checked there again; nothing here is trusted.

export type PickImage = { id: string; label: string; url: string };
export type PickBooking = { slug: string; name: string };
export type PickForm = { id: string; name: string };
type Action = (form: FormData) => void | Promise<void>;

const uid = () => `b${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-3)}`;
const move = <T,>(list: T[], i: number, d: -1 | 1): T[] => {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const next = list.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

function Controls({ i, count, onMove, onRemove, label }: { i: number; count: number; onMove: (d: -1 | 1) => void; onRemove: () => void; label: string }) {
  return (
    <span className="se-controls">
      <button type="button" className="monarch-secondary se-icon" onClick={() => onMove(-1)} disabled={i === 0} aria-label={`Move ${label} up`}>↑</button>
      <button type="button" className="monarch-secondary se-icon" onClick={() => onMove(1)} disabled={i === count - 1} aria-label={`Move ${label} down`}>↓</button>
      <button type="button" className="monarch-secondary se-icon" onClick={onRemove} aria-label={`Remove ${label}`}>✕</button>
    </span>
  );
}

function LeafFields({ block, onChange, images, bookings, forms }: { block: LeafBlock; onChange: (b: LeafBlock) => void; images: PickImage[]; bookings: PickBooking[]; forms: PickForm[] }) {
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

function AddMenu({ onAdd, allowSection }: { onAdd: (type: Block["type"]) => void; allowSection: boolean }) {
  const [type, setType] = useState<Block["type"]>(allowSection ? "section" : "text");
  const types: Block["type"][] = allowSection ? ["section", ...LEAF_TYPES] : [...LEAF_TYPES];
  return (
    <div className="se-add">
      <label className="se-sr" htmlFor={`add-${allowSection ? "top" : "in"}`}>Block to add</label>
      <select id={`add-${allowSection ? "top" : "in"}`} value={type} onChange={(e) => setType(e.target.value as Block["type"])}>{types.map((t) => <option key={t} value={t}>{BLOCK_LABEL[t]}</option>)}</select>
      <button type="button" className="monarch-secondary" onClick={() => onAdd(type)}>Add {BLOCK_LABEL[type].toLowerCase()}</button>
    </div>
  );
}

export function PageForm({ action, area, pageId, title, description, showInNav, isHome, initial, images, bookings, forms }: {
  action: Action; area: string; pageId: string; title: string; description: string; showInNav: boolean; isHome: boolean;
  initial: Block[]; images: PickImage[]; bookings: PickBooking[]; forms: PickForm[];
}) {
  const [blocks, setBlocks] = useState<Block[]>(initial);
  const replace = (i: number, b: Block) => setBlocks((list) => list.map((x, k) => (k === i ? b : x)));
  const remove = (i: number) => setBlocks((list) => list.filter((_, k) => k !== i));
  return (
    <form action={action} className="monarch-form se-form">
      <input type="hidden" name="area" value={area} />
      <input type="hidden" name="page_id" value={pageId} />
      <input type="hidden" name="blocks" value={JSON.stringify(blocks)} />
      <label>Page title *<input name="title" required maxLength={120} defaultValue={title} /></label>
      {!isHome && <label className="se-check"><input type="checkbox" name="show_in_nav" defaultChecked={showInNav} /> Show in the menu</label>}
      <label className="is-wide">Short description (shown in search results)<input name="description" maxLength={300} defaultValue={description} /></label>

      <div className="is-wide se-blocks">
        {blocks.length === 0 && <p className="monarch-muted">This page is blank. Add a section or a block to start.</p>}
        {blocks.map((b, i) => (
          <fieldset key={b.id} className="se-block">
            <legend>{BLOCK_LABEL[b.type]}</legend>
            <Controls i={i} count={blocks.length} label={BLOCK_LABEL[b.type].toLowerCase()} onMove={(d) => setBlocks((l) => move(l, i, d))} onRemove={() => remove(i)} />
            {b.type === "section" ? (
              <>
                <label>Background<select value={b.tone} onChange={(e) => replace(i, { ...b, tone: e.target.value as (typeof SECTION_TONES)[number] })}><option value="plain">White</option><option value="soft">Soft grey</option><option value="accent">Brand colour</option><option value="dark">Dark</option></select></label>
                <div className="se-children">
                  {b.children.map((c, k) => (
                    <fieldset key={c.id} className="se-block se-child">
                      <legend>{BLOCK_LABEL[c.type]}</legend>
                      <Controls i={k} count={b.children.length} label={BLOCK_LABEL[c.type].toLowerCase()} onMove={(d) => replace(i, { ...b, children: move(b.children, k, d) })} onRemove={() => replace(i, { ...b, children: b.children.filter((_, n) => n !== k) })} />
                      <LeafFields block={c} images={images} bookings={bookings} forms={forms} onChange={(nb) => replace(i, { ...b, children: b.children.map((x, n) => (n === k ? nb : x)) })} />
                    </fieldset>
                  ))}
                  {b.children.length < 12 && <AddMenu allowSection={false} onAdd={(t) => replace(i, { ...b, children: [...b.children, newBlock(t, uid()) as LeafBlock] })} />}
                </div>
              </>
            ) : (
              <LeafFields block={b} images={images} bookings={bookings} forms={forms} onChange={(nb) => replace(i, nb)} />
            )}
          </fieldset>
        ))}
        {blocks.length < 60 && <AddMenu allowSection onAdd={(t) => setBlocks((l) => [...l, newBlock(t, uid())])} />}
      </div>
      <div className="is-wide"><button className="monarch-primary">Save draft</button></div>
    </form>
  );
}
