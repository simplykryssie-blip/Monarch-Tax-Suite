"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { FormResult } from "./actions";

/**
 * A form that calls a server action WITHOUT resetting itself. If the action returns a problem (for example a mistyped EIN),
 * the message is shown, the offending field is marked, and everything else stays exactly as typed. On success the server
 * action redirects, so there is nothing to reset. With `confirm`, an in-page dialog asks first (no blocking browser prompt).
 */
export function ActionForm({ action, children, className, confirm }: { action: (form: FormData) => Promise<FormResult>; children: React.ReactNode; className?: string; confirm?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [ask, setAsk] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const held = useRef<FormData | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (ask && !d.open) d.showModal();
    if (!ask && d.open) d.close();
  }, [ask]);

  const run = (data: FormData) => {
    const form = ref.current;
    if (!form) return;
    form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
    setError(null);
    start(async () => {
      const result = await action(data);
      if (!result) return;
      setError(result.error);
      const field = result.field ? form.querySelector<HTMLElement>(`[name="${CSS.escape(result.field)}"]`) : null;
      if (field) { field.setAttribute("aria-invalid", "true"); field.focus(); }
      else form.querySelector<HTMLElement>(".efin-form-error")?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  return (
    <form
      ref={ref}
      className={className}
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        if (confirm) { held.current = data; setAsk(true); return; }
        run(data);
      }}
    >
      {error && <div className="monarch-alert is-error is-wide efin-form-error" role="alert" style={{ gridColumn: "1 / -1" }}>{error} <small>Nothing was saved. Everything you typed is still here.</small></div>}
      {children}
      {pending && <span className="efin-pending" role="status">Saving…</span>}
      {confirm && (
        <dialog ref={dialog} className="efin-confirm-dialog" onClose={() => setAsk(false)} aria-label="Please confirm">
          {ask && (
            <div>
              <p>{confirm}</p>
              <div className="efin-actions" style={{ justifyContent: "flex-end" }}>
                <button type="button" className="monarch-secondary efin-small" onClick={() => { held.current = null; setAsk(false); }}>Cancel</button>
                <button type="button" className="monarch-primary efin-small" onClick={() => { const d = held.current; held.current = null; setAsk(false); if (d) run(d); }}>Yes, continue</button>
              </div>
            </div>
          )}
        </dialog>
      )}
    </form>
  );
}
