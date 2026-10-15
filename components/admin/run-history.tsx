"use client";

import { useEffect, useRef, useState } from "react";

/** A button that opens the run history in a pop-up. The history itself is rendered on the server and passed in. */
export function RunHistoryButton({ children, failed }: { children: React.ReactNode; failed: number }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <>
      <button type="button" className="monarch-secondary" onClick={() => setOpen(true)}>
        Run history{failed > 0 && <span className="mt-pill is-hot" style={{ marginLeft: 8 }}>{failed} failed</span>}
      </button>
      <dialog ref={dialog} className="run-history" onClose={() => setOpen(false)} aria-label="Run history" onClick={(e) => { if (e.target === dialog.current) setOpen(false); }}>
        {open && (
          <div className="run-history-body">
            <div className="run-history-head"><h2>Run history</h2><button type="button" className="monarch-secondary efin-small" onClick={() => setOpen(false)}>Close</button></div>
            {children}
          </div>
        )}
      </dialog>
    </>
  );
}
