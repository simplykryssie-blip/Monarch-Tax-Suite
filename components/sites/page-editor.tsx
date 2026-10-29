"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BLOCK_LABEL, GRADIENT_KEYS, LAYOUT_KEYS, LAYOUT_LABEL, LAYOUTS, LEAF_TYPES, newElement, newRow, newSection, ROW_GAPS, SECTION_PADS, SECTION_TONES, SECTION_WIDTHS, widthOf, type Block, type ColumnBlock, type LayoutKey, type LeafBlock, type RowBlock, type SectionBlock } from "@/lib/sites/blocks.ts";
import { LeafFields, type PickBooking, type PickForm, type PickImage } from "./page-form";
import { Leaf, SiteFrame, sectionClass, sectionStyle, type SiteView } from "./render";
import { StyleFields } from "./style-fields";
import { lookClasses, lookCss, type Look } from "@/lib/sites/look.ts";
import { SECTION_TEMPLATES } from "@/lib/sites/templates.ts";
import type { SiteImageResult } from "@/app/sites-image-actions";

// The page builder: a palette on the left, the page itself in the middle (click anything to edit it, drag elements to move
// them), and the settings of whatever is selected on the right. A page is sections > rows > columns > elements. Every change
// can be undone. The whole page is sent to the server as one field when saved and checked there again; nothing here is trusted.

type Doc = Block[];
type Sel = { kind: "section" | "row" | "column" | "element"; id: string } | null;
type Hist = { doc: Doc; past: Doc[]; future: Doc[]; key: string | null; at: number };
type Loc = { kind: "section" | "row" | "column" | "element"; si: number; ri?: number; ci?: number; ei?: number };
type Device = "desktop" | "tablet" | "mobile";
type Drop = { colId: string; index: number } | null;
type Action = (form: FormData) => void | Promise<void>;

const NEW = "application/x-ws-new";
const MOVE = "application/x-ws-el";
const clock = () => Date.now();
const uid = () => `b${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-3)}`;
const DEVICE_LABEL: Record<Device, string> = { desktop: "Desktop", tablet: "Tablet", mobile: "Mobile" };
const TONE_LABEL: Record<(typeof SECTION_TONES)[number], string> = { plain: "White", soft: "Soft grey", accent: "Brand color", dark: "Dark" };
const PAD_LABEL = { none: "None", small: "Small", medium: "Medium", large: "Large" } as const;
const WIDTH_LABEL = { narrow: "Narrow (text)", wide: "Wide", full: "Edge to edge" } as const;
const HINT: Record<LeafBlock["type"], string> = {
  heading: "A title", text: "Paragraphs", image: "A picture", button: "A link button", booking: "Your booking page", form: "One of your forms", html: "Your own code", spacer: "Empty space", divider: "A thin line",
  list: "Ticked points", faq: "Questions and answers", testimonial: "A client quote", video: "YouTube or Vimeo", gallery: "A grid of pictures", map: "An address on a map",
};

function locate(doc: Doc, id: string): Loc | null {
  for (let si = 0; si < doc.length; si++) {
    const s = doc[si];
    if (s.id === id) return { kind: "section", si };
    for (let ri = 0; ri < s.rows.length; ri++) {
      const r = s.rows[ri];
      if (r.id === id) return { kind: "row", si, ri };
      for (let ci = 0; ci < r.columns.length; ci++) {
        const c = r.columns[ci];
        if (c.id === id) return { kind: "column", si, ri, ci };
        for (let ei = 0; ei < c.children.length; ei++) if (c.children[ei].id === id) return { kind: "element", si, ri, ci, ei };
      }
    }
  }
  return null;
}

const reidRow = (r: RowBlock): RowBlock => ({ ...r, id: uid(), columns: r.columns.map((c) => ({ id: uid(), children: c.children.map((e) => ({ ...e, id: uid() })) })) });
const reidSection = (s: SectionBlock): SectionBlock => ({ ...s, id: uid(), rows: s.rows.map(reidRow) });
const swap = <T,>(list: T[], i: number, d: -1 | 1) => {
  const j = i + d;
  if (j < 0 || j >= list.length) return false;
  [list[i], list[j]] = [list[j], list[i]];
  return true;
};

/** Where a new element goes: the selected column (or the column of the selected element), else the end of the page. May add a section or row. */
function pickColumn(d: Doc, sel: Sel): ColumnBlock {
  const l = sel ? locate(d, sel.id) : null;
  if (l && (l.kind === "element" || l.kind === "column")) return d[l.si].rows[l.ri!].columns[l.ci!];
  let si = l ? l.si : d.length - 1;
  let ri = l?.kind === "row" ? l.ri! : si >= 0 ? d[si].rows.length - 1 : -1;
  if (si < 0) { d.push(newSection(uid)); si = 0; ri = 0; }
  if (ri < 0) { d[si].rows.push(newRow("1", uid)); ri = d[si].rows.length - 1; }
  return d[si].rows[ri].columns[0];
}

export function PageEditor({ action, area, siteId, pageId, seo, title, description, showInNav, isHome, initial, images: initialImages, bookings, forms, view, backHref, siteName, uploadImage }: {
  action: Action; area: string; siteId: string; pageId: string; seo: { title: string; shareImageId: string | null; noindex: boolean };
  title: string; description: string; showInNav: boolean; isHome: boolean; initial: Block[]; images: PickImage[]; bookings: PickBooking[]; forms: PickForm[]; view: SiteView;
  backHref: string; siteName: string; uploadImage: (form: FormData) => Promise<SiteImageResult>;
}) {
  const [images, setImages] = useState<PickImage[]>(initialImages);
  const [betweenAt, setBetweenAt] = useState<number | null>(null);
  const [drag, setDrag] = useState<"new" | "move" | null>(null);
  const [upload, setUpload] = useState<{ busy: boolean; message: string }>({ busy: false, message: "" });
  const [h, setH] = useState<Hist>({ doc: initial, past: [], future: [], key: null, at: 0 });
  const [sel, setSel] = useState<Sel>(null);
  const [itemTab, setItemTab] = useState<"content" | "style">("content");
  /** Something is selected but the person is choosing what to add: the rail shows the add list instead of its settings. */
  const [adding, setAdding] = useState(false);
  const [device, setDevice] = useState<Device>("desktop");
  const [drop, setDrop] = useState<Drop>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [menuCol, setMenuCol] = useState<string | null>(null);
  const [initialJson] = useState(() => JSON.stringify(initial));
  const saving = useRef(false);
  const doc = h.doc;
  const dirty = JSON.stringify(doc) !== initialJson;
  const loc = sel ? locate(doc, sel.id) : null;
  const shown = loc ? sel : null;

  const commit = (fn: (d: Doc) => void, key?: string) => {
    const now = clock();
    setH((cur) => {
      const next = structuredClone(cur.doc);
      fn(next);
      const merge = Boolean(key) && cur.key === key && now - cur.at < 1200;
      return { doc: next, past: merge ? cur.past : [...cur.past.slice(-79), cur.doc], future: [], key: key ?? null, at: now };
    });
  };
  const undo = () => setH((c) => (c.past.length ? { doc: c.past[c.past.length - 1], past: c.past.slice(0, -1), future: [c.doc, ...c.future], key: null, at: 0 } : c));
  const redo = () => setH((c) => (c.future.length ? { doc: c.future[0], past: [...c.past, c.doc], future: c.future.slice(1), key: null, at: 0 } : c));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (k === "y") { e.preventDefault(); redo(); }
    };
    const onLeave = (e: BeforeUnloadEvent) => {
      if (dirty && !saving.current) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onLeave);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("beforeunload", onLeave); };
  });

  const choose = (s: Sel, stay = false) => { setSel(s); setAdding(stay && s !== null); setMenuCol(null); };

  // ---- changes
  const addElement = (type: LeafBlock["type"], colId?: string, index?: number) => {
    const el = newElement(type, uid());
    commit((d) => {
      let col: ColumnBlock | null = null;
      if (colId) { const l = locate(d, colId); if (l?.kind === "column") col = d[l.si].rows[l.ri!].columns[l.ci!]; }
      col = col ?? pickColumn(d, shown);
      col.children.splice(index ?? col.children.length, 0, el);
    });
    // From the Add list you can keep adding; from a column or a drop, the new element opens for editing.
    choose({ kind: "element", id: el.id }, colId === undefined);
  };
  const moveElementTo = (elId: string, colId: string, index: number) => commit((d) => {
    const from = locate(d, elId);
    if (!from || from.kind !== "element") return;
    const src = d[from.si].rows[from.ri!].columns[from.ci!];
    const [el] = src.children.splice(from.ei!, 1);
    const to = locate(d, colId);
    if (!to || to.kind !== "column") return;
    const dest = d[to.si].rows[to.ri!].columns[to.ci!];
    let at = index;
    if (dest === src && from.ei! < index) at -= 1;
    dest.children.splice(Math.min(at, dest.children.length), 0, el);
  });
  const addSection = (layout: LayoutKey) => {
    const s = newSection(uid, layout);
    commit((d) => {
      const l = shown ? locate(d, shown.id) : null;
      d.splice(l ? l.si + 1 : d.length, 0, s);
    });
    choose({ kind: "section", id: s.id });
  };
  const addSectionAt = (index: number, make: SectionBlock) => {
    commit((d) => { d.splice(index, 0, make); });
    setBetweenAt(null);
    choose({ kind: "section", id: make.id });
  };
  const addRow = (sectionId: string, layout: LayoutKey) => {
    const r = newRow(layout, uid);
    commit((d) => { const l = locate(d, sectionId); if (l) d[l.si].rows.push(r); });
    choose({ kind: "row", id: r.id });
  };
  const removeSel = () => {
    if (!shown) return;
    const id = shown.id;
    commit((d) => {
      const l = locate(d, id);
      if (!l) return;
      if (l.kind === "section") d.splice(l.si, 1);
      else if (l.kind === "row") d[l.si].rows.splice(l.ri!, 1);
      else if (l.kind === "element") d[l.si].rows[l.ri!].columns[l.ci!].children.splice(l.ei!, 1);
    });
    choose(null);
  };
  const duplicateSel = () => {
    if (!shown) return;
    const id = shown.id;
    let fresh = "";
    commit((d) => {
      const l = locate(d, id);
      if (!l) return;
      if (l.kind === "section") { const c = reidSection(d[l.si]); fresh = c.id; d.splice(l.si + 1, 0, c); }
      else if (l.kind === "row") { const c = reidRow(d[l.si].rows[l.ri!]); fresh = c.id; d[l.si].rows.splice(l.ri! + 1, 0, c); }
      else if (l.kind === "element") { const col = d[l.si].rows[l.ri!].columns[l.ci!]; const c = { ...col.children[l.ei!], id: uid() }; fresh = c.id; col.children.splice(l.ei! + 1, 0, c); }
    });
    if (fresh) choose({ kind: shown.kind, id: fresh });
  };
  const moveSel = (dir: -1 | 1) => {
    if (!shown) return;
    const id = shown.id;
    commit((d) => {
      const l = locate(d, id);
      if (!l) return;
      if (l.kind === "section") swap(d, l.si, dir);
      else if (l.kind === "row") swap(d[l.si].rows, l.ri!, dir);
      else if (l.kind === "element") swap(d[l.si].rows[l.ri!].columns[l.ci!].children, l.ei!, dir);
    });
  };
  const patchSection = (id: string, patch: Partial<SectionBlock>) => commit((d) => { const l = locate(d, id); if (l) Object.assign(d[l.si], patch); }, `sec:${id}`);
  const patchRow = (id: string, patch: Partial<RowBlock>) => commit((d) => {
    const l = locate(d, id);
    if (!l) return;
    const row = d[l.si].rows[l.ri!];
    const { layout, ...rest } = patch;
    Object.assign(row, rest);
    if (layout && layout !== row.layout) {
      const want = LAYOUTS[layout].length;
      while (row.columns.length > want) { const last = row.columns.pop()!; row.columns[row.columns.length - 1].children.push(...last.children); }
      while (row.columns.length < want) row.columns.push({ id: uid(), children: [] });
      row.layout = layout;
    }
  }, `row:${id}`);
  const lookTarget = (d: Doc, id: string) => {
    const l = locate(d, id);
    if (!l) return null;
    if (l.kind === "section") return d[l.si];
    if (l.kind === "row") return d[l.si].rows[l.ri!];
    if (l.kind === "column") return d[l.si].rows[l.ri!].columns[l.ci!];
    return d[l.si].rows[l.ri!].columns[l.ci!].children[l.ei!];
  };
  const patchLook = (id: string, patch: Partial<Look>) => commit((d) => {
    const t = lookTarget(d, id);
    if (!t) return;
    const next: Record<string, unknown> = { ...(t.look ?? {}), ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    if (Object.keys(next).length) t.look = next as Look; else delete t.look;
  }, `look:${id}`);
  const resetLook = (id: string) => commit((d) => { const t = lookTarget(d, id); if (t) delete t.look; });
  const patchElement = (el: LeafBlock) => commit((d) => { const l = locate(d, el.id); if (l?.kind === "element") d[l.si].rows[l.ri!].columns[l.ci!].children[l.ei!] = el; }, `el:${el.id}`);

  // ---- dragging
  // Some browsers hide what is being dragged until it is dropped, so what we started dragging is remembered here too.
  const dragKind = (e: React.DragEvent) => (drag ? (drag === "new" ? NEW : MOVE) : e.dataTransfer.types.includes(NEW) ? NEW : e.dataTransfer.types.includes(MOVE) ? MOVE : null);
  /** The column nearest to the pointer inside `root`, so a drop anywhere on a section or the page lands somewhere sensible. */
  const nearestColumn = (root: HTMLElement, x: number, y: number): string | null => {
    let best: string | null = null;
    let bestD = Infinity;
    root.querySelectorAll<HTMLElement>("[data-col]").forEach((el) => {
      const r = el.getBoundingClientRect();
      const dx = Math.max(r.left - x, 0, x - r.right);
      const dy = Math.max(r.top - y, 0, y - r.bottom);
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = el.dataset.col ?? null; }
    });
    return best;
  };
  const overArea = (e: React.DragEvent) => {
    if (!dragKind(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const id = nearestColumn(e.currentTarget as HTMLElement, e.clientX, e.clientY);
    if (!id) { setDrop(null); return; }
    const l = locate(doc, id);
    const count = l?.kind === "column" ? doc[l.si].rows[l.ri!].columns[l.ci!].children.length : 0;
    setDrop({ colId: id, index: count });
  };
  const finishDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const target = drop;
    setDrop(null);
    setDrag(null);
    const type = e.dataTransfer.getData(NEW) as LeafBlock["type"];
    const elId = e.dataTransfer.getData(MOVE);
    const known = type && (LEAF_TYPES as readonly string[]).includes(type);
    if (!target) { if (known) addElement(type); return; }
    if (known) addElement(type, target.colId, target.index);
    else if (elId) moveElementTo(elId, target.colId, target.index);
  };

  // ---- canvas
  const merged: SiteView = { ...view, preview: true, images: { ...Object.fromEntries(images.map((i) => [i.id, { url: i.url, width: null, height: null }])), ...view.images } };
  const isSel = (id: string) => shown?.id === id;
  const label = (kind: string, id: string, extra?: string) => (
    <div className="ed-bar" role="toolbar" aria-label={`${kind} tools`}>
      <b>{kind}</b>{extra && <span>{extra}</span>}
      <button type="button" onClick={(e) => { e.stopPropagation(); moveSel(-1); }} aria-label={`Move ${kind.toLowerCase()} up`}>↑</button>
      <button type="button" onClick={(e) => { e.stopPropagation(); moveSel(1); }} aria-label={`Move ${kind.toLowerCase()} down`}>↓</button>
      <button type="button" onClick={(e) => { e.stopPropagation(); duplicateSel(); }} aria-label={`Duplicate ${kind.toLowerCase()}`}>⧉</button>
      <button type="button" onClick={(e) => { e.stopPropagation(); removeSel(); }} aria-label={`Delete ${kind.toLowerCase()}`} data-id={id}>✕</button>
    </div>
  );
  const inline = (el: LeafBlock) => {
    const stop = () => setEditing(null);
    if (el.type === "heading") return <input className="ed-inline" autoFocus value={el.text} maxLength={200} onChange={(e) => patchElement({ ...el, text: e.target.value })} onBlur={stop} onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") stop(); }} aria-label="Heading text" />;
    if (el.type === "text") return <textarea className="ed-inline" autoFocus rows={4} value={el.text} maxLength={5000} onChange={(e) => patchElement({ ...el, text: e.target.value })} onBlur={stop} onKeyDown={(e) => { if (e.key === "Escape") stop(); }} aria-label="Text" />;
    if (el.type === "button") return <input className="ed-inline" autoFocus value={el.label} maxLength={60} onChange={(e) => patchElement({ ...el, label: e.target.value })} onBlur={stop} onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") stop(); }} aria-label="Button text" />;
    return null;
  };

  /** The "+" between sections: opens a small list of starting sections and layouts to put there. */
  const between = (after: number) => (
    <div className={`ed-between${betweenAt === after ? " is-open" : ""}`} key={`b${after}`}>
      <button type="button" className="ed-between-btn" onClick={(e) => { e.stopPropagation(); setBetweenAt(betweenAt === after ? null : after); }} aria-expanded={betweenAt === after}>+ Add section</button>
      {betweenAt === after && (
        <div className="ed-menu ed-menu-wide" role="menu" onClick={(e) => e.stopPropagation()}>
          <b>Start from</b>
          {SECTION_TEMPLATES.map((t) => <button key={t.key} type="button" role="menuitem" onClick={() => addSectionAt(after + 1, t.make(uid))}>{t.label}<small>{t.hint}</small></button>)}
          <b>Or an empty layout</b>
          {LAYOUT_KEYS.map((k) => <button key={k} type="button" role="menuitem" onClick={() => addSectionAt(after + 1, newSection(uid, k))}>{LAYOUT_LABEL[k]}</button>)}
        </div>
      )}
    </div>
  );
  const column = (c: ColumnBlock) => (
    <div
      key={c.id}
      data-col={c.id}
      className={`ws-col ed-col${isSel(c.id) ? " is-sel" : ""}${drop?.colId === c.id ? " is-over" : ""} ${lookClasses(c.look)}`} style={lookCss(c.look) as React.CSSProperties}
      onClick={(e) => { e.stopPropagation(); choose({ kind: "column", id: c.id }); }}
      onDragOver={(e) => { if (dragKind(e)) { e.preventDefault(); e.stopPropagation(); setDrop({ colId: c.id, index: c.children.length }); } }}
      onDrop={finishDrop}
    >
      {c.children.map((el, ei) => (
        <div key={el.id}>
          {drop?.colId === c.id && drop.index === ei && <div className="ed-drop" />}
          <div
            className={`ed-el${isSel(el.id) ? " is-sel" : ""}`}
            draggable={editing !== el.id}
            onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData(MOVE, el.id); e.dataTransfer.effectAllowed = "move"; setDrag("move"); choose({ kind: "element", id: el.id }); }}
            onDragEnd={() => { setDrop(null); setDrag(null); }}
            onDragOver={(e) => {
              if (!dragKind(e)) return;
              e.preventDefault();
              e.stopPropagation();
              const box = e.currentTarget.getBoundingClientRect();
              setDrop({ colId: c.id, index: ei + (e.clientY > box.top + box.height / 2 ? 1 : 0) });
            }}
            onDrop={finishDrop}
            onClick={(e) => { e.stopPropagation(); choose({ kind: "element", id: el.id }); }}
            onDoubleClick={(e) => { e.stopPropagation(); if (el.type === "heading" || el.type === "text" || el.type === "button") setEditing(el.id); }}
          >
            {isSel(el.id) && label(BLOCK_LABEL[el.type], el.id)}
            {editing === el.id ? inline(el) : <div className="ed-content"><Leaf block={el} view={merged} /></div>}
          </div>
        </div>
      ))}
      {drop?.colId === c.id && drop.index >= c.children.length && c.children.length > 0 && <div className="ed-drop" />}
      {c.children.length === 0 && <div className="ed-empty">{drop?.colId === c.id ? "Drop here" : "Empty column"}</div>}
      <div className="ed-addwrap">
        <button type="button" className="ed-add" onClick={(e) => { e.stopPropagation(); setMenuCol(menuCol === c.id ? null : c.id); }} aria-expanded={menuCol === c.id} aria-label="Add an element to this column">+ Add element</button>
        {menuCol === c.id && (
          <div className="ed-menu" role="menu" onClick={(e) => e.stopPropagation()}>
            {LEAF_TYPES.map((t) => <button key={t} type="button" role="menuitem" onClick={() => { addElement(t, c.id); setMenuCol(null); }}>{BLOCK_LABEL[t]}</button>)}
          </div>
        )}
      </div>
    </div>
  );

  // ---- settings panel
  const field = (labelText: string, node: React.ReactNode) => <label>{labelText}{node}</label>;
  const sectionOf = shown && loc ? doc[loc.si] : null;
  const rowOf = shown?.kind === "row" && loc ? doc[loc.si].rows[loc.ri!] : null;
  const colOf = shown?.kind === "column" && loc ? doc[loc.si].rows[loc.ri!].columns[loc.ci!] : null;
  const elementOf = shown?.kind === "element" && loc ? doc[loc.si].rows[loc.ri!].columns[loc.ci!].children[loc.ei!] : null;
  const crumbs: { label: string; sel: Sel }[] = [];
  if (loc && sectionOf) {
    crumbs.push({ label: "Section", sel: { kind: "section", id: sectionOf.id } });
    if (loc.ri !== undefined) crumbs.push({ label: "Row", sel: { kind: "row", id: sectionOf.rows[loc.ri].id } });
    if (loc.ci !== undefined) crumbs.push({ label: "Column", sel: { kind: "column", id: sectionOf.rows[loc.ri!].columns[loc.ci].id } });
    if (elementOf) crumbs.push({ label: BLOCK_LABEL[elementOf.type], sel: shown });
  }
  const tools = shown && shown.kind !== "column" && (
    <div className="ed-tools">
      <button type="button" className="monarch-secondary" onClick={() => moveSel(-1)}>Move up</button>
      <button type="button" className="monarch-secondary" onClick={() => moveSel(1)}>Move down</button>
      <button type="button" className="monarch-secondary" onClick={duplicateSel}>Duplicate</button>
      <button type="button" className="monarch-secondary" onClick={removeSel}>Delete</button>
    </div>
  );

  return (
    <form
      action={action}
      className="ed"
      onSubmit={() => { saving.current = true; }}
      onKeyDown={(e) => { const t = e.target as HTMLElement; if (e.key === "Enter" && t.tagName === "INPUT" && (t as HTMLInputElement).type !== "submit") e.preventDefault(); }}
    >
      <input type="hidden" name="area" value={area} />
      <input type="hidden" name="site_id" value={siteId} />
      <input type="hidden" name="page_id" value={pageId} />
      <input type="hidden" name="blocks" value={JSON.stringify(doc)} />

      <div className="ed-top">
        <div className="ed-top-group ed-title">
          <Link className="monarch-back" href={backHref}>← {siteName}</Link>
          <b>{title}</b>
        </div>
        <div className="ed-top-group">
          <button type="button" className="monarch-secondary" onClick={undo} disabled={!h.past.length} aria-label="Undo">↶ Undo</button>
          <button type="button" className="monarch-secondary" onClick={redo} disabled={!h.future.length} aria-label="Redo">↷ Redo</button>
        </div>
        <div className="ed-top-group">
          <div className="ed-top-group" role="group" aria-label="Page width">{(Object.keys(DEVICE_LABEL) as Device[]).map((d) => <button key={d} type="button" className={`monarch-secondary${device === d ? " is-on" : ""}`} aria-pressed={device === d} onClick={() => setDevice(d)}>{DEVICE_LABEL[d]}</button>)}</div>
        </div>
        <div className="ed-top-group">
          <span className="monarch-muted" role="status">{dirty ? "Unsaved changes" : "All changes saved"}</span>
          <button className="monarch-primary">Save draft</button>
        </div>
      </div>

      <div className="ed-body">
        <aside className="ed-palette" aria-label="Build your page">
          {shown && (adding
            ? <button type="button" className="monarch-secondary ed-rail-switch" onClick={() => setAdding(false)}>← Back to settings</button>
            : <button type="button" className="monarch-secondary ed-rail-switch" onClick={() => setAdding(true)}>+ Add something</button>)}
          <div hidden={!!shown && !adding} className="ed-add-pane">
            <>
              <p className="monarch-muted">Drag onto the page, or click to add.</p>
              <ul className="ed-tiles">
                {LEAF_TYPES.map((t) => (
                  <li key={t}>
                    <button type="button" draggable title={HINT[t]} onDragStart={(e) => { e.dataTransfer.setData(NEW, t); e.dataTransfer.effectAllowed = "copy"; setDrag("new"); }} onDragEnd={() => { setDrop(null); setDrag(null); }} onClick={() => addElement(t)}>{BLOCK_LABEL[t]}</button>
                  </li>
                ))}
              </ul>
              <div className="ed-upload">
                <label className="monarch-secondary">
                  {upload.busy ? "Uploading…" : "Upload a picture"}
                  <input
                    type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={upload.busy}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      setUpload({ busy: true, message: "" });
                      const fd = new FormData();
                      fd.set("area", area); fd.set("site_id", siteId); fd.set("file", file);
                      const r = await uploadImage(fd).catch(() => ({ ok: false as const, error: "The picture could not be uploaded. Please try again." }));
                      if (r.ok) {
                        setImages((list) => [r.image, ...list]);
                        const cur = shown?.kind === "element" && loc ? doc[loc.si].rows[loc.ri!].columns[loc.ci!].children[loc.ei!] : null;
                        if (cur?.type === "image" && !cur.imageId) patchElement({ ...cur, imageId: r.image.id });
                        setUpload({ busy: false, message: "Picture added. Choose it in an Image element." });
                      } else setUpload({ busy: false, message: r.error });
                    }}
                  />
                </label>
                <p className="monarch-muted" role="status">{upload.message || "PNG, JPG or WebP, up to 4 MB."}</p>
              </div>
            </>
            <>
              <h3 className="ed-h">Sections</h3>
              <p className="monarch-muted">Start from a ready-made section, then reword it.</p>
              <ul className="ed-layouts">
                {SECTION_TEMPLATES.map((t) => <li key={t.key}><button type="button" onClick={() => addSectionAt(shown ? (loc ? loc.si + 1 : doc.length) : doc.length, t.make(uid))}><b>{t.label}</b><small>{t.hint}</small></button></li>)}
              </ul>
              <p className="monarch-muted">Or an empty layout:</p>
              <ul className="ed-layouts">
                {LAYOUT_KEYS.map((k) => <li key={k}><button type="button" onClick={() => addSection(k)}><span className="ed-mini" style={{ gridTemplateColumns: LAYOUTS[k].map((n) => `${n}fr`).join(" ") }}>{LAYOUTS[k].map((_, i) => <i key={i} />)}</span>{LAYOUT_LABEL[k]}</button></li>)}
              </ul>
            </>
          </div>
          <details className="ed-pagebox"><summary>Page settings</summary><div className="ed-fields">
            {field("Page title *", <input name="title" maxLength={120} defaultValue={title} />)}
            {!isHome && <label className="se-check"><input type="checkbox" name="show_in_nav" defaultChecked={showInNav} /> Show in the menu</label>}
            {field("Short description (shown in search results)", <input name="description" maxLength={160} defaultValue={description} />)}
            <details className="se-seo">
              <summary>Search engine settings for this page</summary>
              <div className="ed-fields">
                {field("Search title (blank = the page title)", <input name="seo_title" maxLength={70} defaultValue={seo.title} />)}
                {field("Picture shown when shared", <select name="seo_image" defaultValue={seo.shareImageId ?? ""}><option value="">Use the website&apos;s picture</option>{images.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>)}
                <label className="se-check"><input type="checkbox" name="seo_noindex" defaultChecked={seo.noindex} /> Hide this page from search engines</label>
              </div>
            </details>
          </div></details>

          <div hidden={!shown || adding} className="ed-fields">
            {shown ? (
              <>
                <nav className="ed-crumbs" aria-label="Where you are">
                  {crumbs.map((c, i) => <button key={i} type="button" className={c.sel?.id === shown.id ? "is-on" : undefined} onClick={() => choose(c.sel)}>{c.label}</button>)}
                </nav>
                <div className="ed-subtabs" role="tablist">
                  <button type="button" role="tab" aria-selected={itemTab === "content"} className={itemTab === "content" ? "is-on" : undefined} onClick={() => setItemTab("content")}>Content</button>
                  <button type="button" role="tab" aria-selected={itemTab === "style"} className={itemTab === "style" ? "is-on" : undefined} onClick={() => setItemTab("style")}>Style</button>
                </div>
                {itemTab === "style" && (
                  <>
                    {shown.kind === "section" && sectionOf && (
                      <div className="sf-bg">
                        {field("Background style", <select value={sectionOf.gradient ?? ""} onChange={(e) => patchSection(sectionOf.id, { gradient: (e.target.value || undefined) as SectionBlock["gradient"] })}><option value="">Plain color</option>{GRADIENT_KEYS.map((g) => <option key={g} value={g}>{g[0].toUpperCase() + g.slice(1)} gradient</option>)}</select>)}
                        {field("Background picture", <select value={sectionOf.bgImage ?? ""} onChange={(e) => patchSection(sectionOf.id, { bgImage: e.target.value || undefined, bgOverlay: e.target.value ? (sectionOf.bgOverlay ?? 35) : undefined })}><option value="">None</option>{images.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>)}
                        {sectionOf.bgImage && field(`Darken the picture: ${sectionOf.bgOverlay ?? 35}%`, <input type="range" min={0} max={80} value={sectionOf.bgOverlay ?? 35} onChange={(e) => patchSection(sectionOf.id, { bgOverlay: Number(e.target.value) })} />)}
                      </div>
                    )}
                    <StyleFields
                      look={(shown.kind === "section" ? sectionOf?.look : shown.kind === "row" ? rowOf?.look : shown.kind === "column" ? colOf?.look : elementOf?.look) ?? {}}
                      showText={shown.kind === "element" ? ["heading", "text", "button", "list", "faq", "testimonial"].includes(elementOf?.type ?? "") : true}
                      onChange={(p) => patchLook(shown.id, p)}
                      onReset={() => resetLook(shown.id)}
                    />
                  </>
                )}
                {itemTab === "content" && shown.kind === "section" && sectionOf && (
                  <>
                    {field("Background", <select value={sectionOf.tone} onChange={(e) => patchSection(sectionOf.id, { tone: e.target.value as SectionBlock["tone"] })}>{SECTION_TONES.map((t) => <option key={t} value={t}>{TONE_LABEL[t]}</option>)}</select>)}
                    {field("Space above and below", <select value={sectionOf.pad} onChange={(e) => patchSection(sectionOf.id, { pad: e.target.value as SectionBlock["pad"] })}>{SECTION_PADS.map((t) => <option key={t} value={t}>{PAD_LABEL[t]}</option>)}</select>)}
                    {field("Content width", <select value={sectionOf.width} onChange={(e) => patchSection(sectionOf.id, { width: e.target.value as SectionBlock["width"] })}>{SECTION_WIDTHS.map((t) => <option key={t} value={t}>{WIDTH_LABEL[t]}</option>)}</select>)}
                    <div>
                      <p className="monarch-muted">Add a row to this section:</p>
                      <div className="ed-layouts-row">{LAYOUT_KEYS.map((k) => <button key={k} type="button" className="monarch-secondary" onClick={() => addRow(sectionOf.id, k)}>{LAYOUT_LABEL[k]}</button>)}</div>
                    </div>
                  </>
                )}
                {itemTab === "content" && rowOf && (
                  <>
                    {field("Columns", <select value={rowOf.layout} onChange={(e) => patchRow(rowOf.id, { layout: e.target.value as LayoutKey })}>{LAYOUT_KEYS.map((k) => <option key={k} value={k}>{LAYOUT_LABEL[k]}</option>)}</select>)}
                    {field("Space between columns", <select value={rowOf.gap} onChange={(e) => patchRow(rowOf.id, { gap: e.target.value as RowBlock["gap"] })}>{ROW_GAPS.map((g) => <option key={g} value={g}>{g[0].toUpperCase() + g.slice(1)}</option>)}</select>)}
                    {field("Line up", <select value={rowOf.valign} onChange={(e) => patchRow(rowOf.id, { valign: e.target.value as "top" | "center" })}><option value="top">At the top</option><option value="center">In the middle</option></select>)}
                    <p className="monarch-muted">On a phone the columns stack one under the other.</p>
                  </>
                )}
                {itemTab === "content" && shown.kind === "column" && <p className="monarch-muted">Click an element to edit it. Use “+ Add element” in the column, or drag one in from the left.</p>}
                {itemTab === "content" && elementOf && <LeafFields block={elementOf} onChange={patchElement} images={images} bookings={bookings} forms={forms} />}
                {tools}
              </>
            ) : <p className="monarch-muted">Click anything on the page to edit it.</p>}
          </div>
        </aside>

        <div className="ed-stage" onClick={() => choose(null)} onDragOver={overArea} onDrop={finishDrop} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null); }}>
          <div className={`ed-frame ed-${device}`}>
            <SiteFrame className={`ed-canvas ws-dev-${device}`} view={merged} currentPath="/">
              {doc.length === 0 && <div className="ed-blank"><p><b>This page is blank.</b></p><p>Choose a section on the left to start, or use the + below.</p></div>}
              {between(-1)}
              {doc.map((s, si) => (
                <div key={s.id}>
                  <section className={`${sectionClass(s, merged)} ed-section${isSel(s.id) ? " is-sel" : ""}`} style={sectionStyle(s, merged)} onClick={(e) => { e.stopPropagation(); choose({ kind: "section", id: s.id }); }} onDragOver={overArea} onDrop={finishDrop}>
                    {isSel(s.id) && label("Section", s.id)}
                    <div className={`ws-wrap ws-w-${widthOf(s)}`}>
                      {s.rows.map((r) => (
                        <div key={r.id} className={`ed-row${isSel(r.id) ? " is-sel" : ""}`} onClick={(e) => { e.stopPropagation(); choose({ kind: "row", id: r.id }); }}>
                          {isSel(r.id) && label("Row", r.id)}
                          <div className={`ws-row ws-gap-${r.gap} ws-va-${r.valign} ws-cols-${r.columns.length} ${lookClasses(r.look)}`} style={{ gridTemplateColumns: LAYOUTS[r.layout].map((n) => `${n}fr`).join(" "), ...(lookCss(r.look) as React.CSSProperties) }}>
                            {r.columns.map(column)}
                          </div>
                        </div>
                      ))}
                      {s.rows.length === 0 && <div className="ed-empty">No rows yet. Select this section and add a row.</div>}
                    </div>
                  </section>
                  {between(si)}
                </div>
              ))}
            </SiteFrame>
          </div>
          <p className="monarch-muted ed-hint">Click anything to edit it. Double-click a heading, text or button to type on the page. Undo with Ctrl+Z.</p>
        </div>

      </div>
    </form>
  );
}
