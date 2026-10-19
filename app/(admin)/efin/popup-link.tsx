"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * A link that opens its page in a pop-up over the current one. The page you were on stays exactly as it was (a half-filled
 * form keeps what you typed); closing the pop-up refreshes the page behind it so new data (a new software item, a new
 * location) shows up. Cmd/Ctrl-click or middle-click still opens a normal tab. If the pop-up navigates somewhere that
 * would leave the current context (for example the firm list after a delete), the pop-up closes and the page follows.
 */
export function PopupLink({ href, title, children, className }: { href: string; title: string; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const close = () => { setOpen(false); setLoaded(false); router.refresh(); };

  return (
    <>
      <a
        href={href}
        className={className}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          if (window.self !== window.top) return; // already inside a pop-up: just navigate within it
          e.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </a>
      <dialog ref={dialog} className="efin-pop" onClose={() => open && close()} onClick={(e) => { if (e.target === dialog.current) close(); }} aria-label={title}>
        {open && (
          <div className="efin-pop-card">
            <div className="efin-pop-bar">
              <b>{title}</b>
              <span>
                <a href={href} className="efin-card-link" target="_blank" rel="noreferrer">Open in a new tab</a>
                <button type="button" className="efin-pop-close" onClick={close} aria-label="Close">×</button>
              </span>
            </div>
            {!loaded && <p className="efin-pop-loading">Loading…</p>}
            <iframe
              title={title}
              src={href}
              onLoad={(e) => {
                setLoaded(true);
                try {
                  const path = e.currentTarget.contentWindow?.location.pathname ?? "";
                  if (path === "/efin/list" || path === "/efin/new" || path === "/efin") { setOpen(false); setLoaded(false); router.push(path + (e.currentTarget.contentWindow?.location.search ?? "")); }
                } catch { /* cross-origin: leave it */ }
              }}
            />
          </div>
        )}
      </dialog>
    </>
  );
}
