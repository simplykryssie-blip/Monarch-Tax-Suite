"use client";

import { useEffect, useRef, useState } from "react";

type Op = "assign" | "convert" | "set_status" | "tag_add" | "tag_remove";
const MENU: { op: Op; label: string }[] = [
  { op: "assign", label: "Reassign to…" },
  { op: "convert", label: "Convert leads to clients…" },
  { op: "set_status", label: "Set lead status…" },
  { op: "tag_add", label: "Add a tag…" },
  { op: "tag_remove", label: "Remove a tag…" },
];
const TITLE: Record<Op, string> = { assign: "Reassign", convert: "Convert leads to clients", set_status: "Set lead status", tag_add: "Add a tag", tag_remove: "Remove a tag" };
const GO: Record<Op, string> = { assign: "Reassign", convert: "Convert", set_status: "Save status", tag_add: "Add tag", tag_remove: "Remove tag" };

/**
 * One "Actions" menu for the ticked contacts. Choosing an action opens a small window that asks only for what that action
 * needs, then runs it. Lives inside the list's form: the ticked boxes and the window's fields are sent together.
 */
export function BulkMenu({ staff, tags, statuses }: { staff: { id: string; label: string }[]; tags: string[]; statuses: { value: string; label: string }[] }) {
  const [count, setCount] = useState(0);
  const [op, setOp] = useState<Op | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const form = root.current?.closest("form");
    if (!form) return;
    const recount = () => setCount(form.querySelectorAll('input[type="checkbox"][name="key"]:checked').length);
    form.addEventListener("change", recount);
    return () => form.removeEventListener("change", recount);
  }, []);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (op && !d.open) d.showModal();
    if (!op && d.open) d.close();
  }, [op]);

  useEffect(() => {
    if (!menuOpen) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [menuOpen]);

  return (
    <div className="ct-bulk" ref={root}>
      <input type="hidden" name="op" value={op ?? ""} />
      <span className="monarch-muted">{count ? `${count} selected` : "Tick contacts to act on them"}</span>
      <div className="hm" onMouseEnter={() => { if (count) setMenuOpen(true); }} onMouseLeave={() => setMenuOpen(false)}>
        <button type="button" className="monarch-secondary" disabled={count === 0} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>Actions ▾</button>
        {menuOpen && (
          <div className="hm-panel" role="menu">
            <ul className="hm-list">
              {MENU.map((m) => (
                <li key={m.op} role="none"><button type="button" role="menuitem" onClick={() => { setOp(m.op); setMenuOpen(false); }}>{m.label}</button></li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <dialog ref={dialog} className="md-dialog" aria-labelledby="bulk-title" onClose={() => setOp(null)}>
        {op && (
          <div>
            <div className="md-head">
              <h2 id="bulk-title">{TITLE[op]}</h2>
              <button type="button" className="md-x" aria-label="Close" onClick={() => setOp(null)}>&times;</button>
            </div>
            <div className="monarch-form">
              <p className="is-wide monarch-muted">{count} selected.</p>
              {op === "assign" && (
                <label className="is-wide">Assign to
                  <select name="assignee" defaultValue="">
                    <option value="">No one</option>
                    {staff.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </label>
              )}
              {op === "convert" && <p className="is-wide">Makes a client record from each ticked lead. Anyone who is already a client, and store customers, are skipped.</p>}
              {op === "set_status" && (
                <>
                  <label className="is-wide">New status
                    <select name="status" defaultValue="contacted">{statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
                  </label>
                  <p className="is-wide monarch-muted">Applies to ticked leads. Clients are skipped.</p>
                </>
              )}
              {(op === "tag_add" || op === "tag_remove") && (
                <label className="is-wide">Tag
                  <input name="tag" maxLength={40} autoFocus list="ct-bulk-tags" placeholder={op === "tag_add" ? "Type a tag" : "Tag to remove"} required />
                  <datalist id="ct-bulk-tags">{tags.map((t) => <option key={t} value={t} />)}</datalist>
                </label>
              )}
              <div className="is-wide ac-actions">
                <button type="submit" className="monarch-primary" data-no-confirm>{GO[op]}</button>
                <button type="button" className="monarch-secondary" onClick={() => setOp(null)}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
