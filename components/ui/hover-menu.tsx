"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A button that opens a small menu. It opens when the mouse is over it (or on click or Enter), and closes when the mouse
 * moves away, when Escape is pressed, or after a choice is made.
 */
export function HoverMenu({ label, children, disabled = false, align = "left" }: { label: string; children: React.ReactNode; disabled?: boolean; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  // A pop-up question (such as the "Are you sure?" for Archive) opened from a choice in this menu must find that choice still
  // on the page when the person answers Yes, so the menu stays put while any dialog is open and closes when it is dismissed.
  const dialogOpen = () => document.querySelector("dialog[open]") !== null;
  const leave = () => { cancel(); timer.current = setTimeout(() => { if (!dialogOpen()) setOpen(false); }, 180); };

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node) && !dialogOpen()) setOpen(false); };
    const dialogClosed = () => setOpen(false);
    document.addEventListener("keydown", esc);
    document.addEventListener("mousedown", away);
    document.addEventListener("close", dialogClosed, true);
    return () => { document.removeEventListener("keydown", esc); document.removeEventListener("mousedown", away); document.removeEventListener("close", dialogClosed, true); };
  }, [open]);
  useEffect(() => cancel, []);

  return (
    <div className="hm" ref={wrap} onMouseEnter={() => { if (!disabled) { cancel(); setOpen(true); } }} onMouseLeave={leave}>
      <button type="button" className="monarch-secondary" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{label} ▾</button>
      {open && <div className={align === "right" ? "hm-panel is-right" : "hm-panel"} role="menu" onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setOpen(false); }}>{children}</div>}
    </div>
  );
}
