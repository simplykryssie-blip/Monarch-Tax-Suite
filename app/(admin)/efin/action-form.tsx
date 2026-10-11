"use client";

import { useRef, useState, useTransition } from "react";
import type { FormResult } from "./actions";

/**
 * A form that calls a server action WITHOUT resetting itself. If the action returns a problem (for example a mistyped EIN),
 * the message is shown, the offending field is marked, and everything else stays exactly as typed. On success the server
 * action redirects, so there is nothing to reset.
 */
export function ActionForm({ action, children, className, confirm }: { action: (form: FormData) => Promise<FormResult>; children: React.ReactNode; className?: string; confirm?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      className={className}
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        if (confirm && !window.confirm(confirm)) return;
        form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
        setError(null);
        const data = new FormData(form);
        start(async () => {
          const result = await action(data);
          if (!result) return;
          setError(result.error);
          const field = result.field ? form.querySelector<HTMLElement>(`[name="${CSS.escape(result.field)}"]`) : null;
          if (field) { field.setAttribute("aria-invalid", "true"); field.focus(); }
          else form.querySelector<HTMLElement>(".efin-form-error")?.scrollIntoView({ block: "center", behavior: "smooth" });
        });
      }}
    >
      {error && <div className="monarch-alert is-error is-wide efin-form-error" role="alert" style={{ gridColumn: "1 / -1" }}>{error} <small>Nothing was saved. Everything you typed is still here.</small></div>}
      {children}
      {pending && <span className="efin-pending" role="status">Saving…</span>}
    </form>
  );
}
