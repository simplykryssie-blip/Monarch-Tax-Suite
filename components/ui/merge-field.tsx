"use client";

import { useEffect, useRef, useState } from "react";

export type MergeWord = { key: string; label: string; note?: string };

/** A small "+ Insert" menu that sits in the corner of a field. Picking an item calls `onPick`; it closes after a pick, on Escape and on a click elsewhere. */
export function InsertMenu({ words, onPick, label = "Insert" }: { words: MergeWord[]; onPick: (w: MergeWord) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", esc);
    document.addEventListener("mousedown", away);
    return () => { document.removeEventListener("keydown", esc); document.removeEventListener("mousedown", away); };
  }, [open]);
  return (
    <span className="mfld-menu" ref={wrap}>
      <button type="button" className="mfld-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>＋ {label}</button>
      {open && (
        <ul className="mfld-list" role="menu">
          {words.map((w) => (
            <li key={w.key} role="none">
              <button type="button" role="menuitem" title={w.note} onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(w); setOpen(false); }}>{w.label}</button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

/**
 * A text field with its own Insert menu in the label row. A pick goes into THIS field at the cursor (or replaces the selection),
 * shown as [Label]. The field is controlled: the parent keeps the text.
 */
export function MergeField({ label, name, words, value, onChange, multiline = false, rows = 6, maxLength, hint, insertLabel = "Insert" }: {
  label: string; name: string; words: MergeWord[]; value: string; onChange: (v: string) => void; multiline?: boolean; rows?: number; maxLength?: number; hint?: string; insertLabel?: string;
}) {
  const box = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const caret = useRef<[number, number]>([value.length, value.length]);
  const remember = (e: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => { caret.current = [e.currentTarget.selectionStart ?? value.length, e.currentTarget.selectionEnd ?? value.length]; };
  const pick = (w: MergeWord) => {
    const [from, to] = caret.current;
    const tag = `[${w.label}]`;
    const next = (value.slice(0, from) + tag + value.slice(to)).slice(0, maxLength ?? Infinity);
    onChange(next);
    const at = Math.min(from + tag.length, next.length);
    caret.current = [at, at];
    requestAnimationFrame(() => { const el = box.current; if (el) { el.focus(); el.setSelectionRange(at, at); } });
  };
  const common = { name, ref: box, value, maxLength, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { onChange(e.target.value); remember(e); }, onSelect: remember, onKeyUp: remember, onClick: remember, onBlur: remember };
  return (
    <div className="mfld is-wide">
      <div className="mfld-head"><span className="mfld-label">{label}</span><InsertMenu words={words} onPick={pick} label={insertLabel} /></div>
      {multiline ? <textarea rows={rows} {...common} /> : <input {...common} />}
      {hint && <small className="monarch-muted">{hint}</small>}
    </div>
  );
}
