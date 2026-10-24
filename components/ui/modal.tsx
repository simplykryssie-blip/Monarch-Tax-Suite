"use client";

import { useEffect, useId, useRef, useState } from "react";

/** A button that opens a pop-up window. The content is built fresh each time it opens, so a form inside starts empty. */
export function Modal({ label, title, children, className = "monarch-primary" }: { label: string; title: string; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{label}</button>
      <dialog ref={ref} className="md-dialog" aria-labelledby={titleId} onClose={() => setOpen(false)}>
        {open && (
          <div>
            <div className="md-head">
              <h2 id={titleId}>{title}</h2>
              <button type="button" className="md-x" aria-label="Close" onClick={() => setOpen(false)}>&times;</button>
            </div>
            {children}
          </div>
        )}
      </dialog>
    </>
  );
}
