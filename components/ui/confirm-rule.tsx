"use client";

import { useEffect, useRef, useState } from "react";
import { confirmKind, confirmText, type ConfirmKind } from "@/lib/ui/confirm.ts";

type Ask = { button: HTMLButtonElement; label: string; kind: ConfirmKind; text: string };

/**
 * The app-wide "ask before you destroy" rule. Mounted once in the root layout: any submit button whose label says Delete,
 * Remove, Archive, Restore, Void, Discard, Revoke, Disconnect, Withdraw, Take offline and so on (or that is styled as dangerous)
 * opens one shared dialog first. Nothing is submitted until the person says yes. Forms that already ask (they carry
 * data-has-confirm, or need a ticked box or typed word) are left alone so nobody is asked twice.
 */
export function ConfirmRule() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const button = target?.closest("button");
      if (!button || button.type !== "submit" || button.disabled || !button.form) return;
      if (button.hasAttribute("data-no-confirm") || button.form.hasAttribute("data-has-confirm") || button.form.hasAttribute("data-no-confirm")) return;
      // A form that already needs a ticked box or a typed word before it can be sent has asked.
      if (button.form.querySelector('[name="confirm"], [name="confirm_text"]')) return;
      const label = (button.getAttribute("aria-label") || button.textContent || "").trim();
      const kind = confirmKind(label, button.classList.contains("is-danger"));
      if (!kind) return;
      e.preventDefault();
      e.stopPropagation();
      const custom = button.getAttribute("data-confirm") || button.form.getAttribute("data-confirm");
      setAsk({ button, label, kind, text: custom ?? confirmText(label, kind) });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (ask && !d.open) d.showModal();
    if (!ask && d.open) d.close();
  }, [ask]);

  const yes = () => {
    const a = ask;
    setAsk(null);
    if (!a || !a.button.form || !a.button.isConnected) return;
    // requestSubmit sends the form as if the button had been pressed, without a click, so this rule is not asked again.
    a.button.form.requestSubmit(a.button);
  };

  return (
    <dialog ref={dialog} className="cf-dialog" aria-labelledby="cf-title" onClose={() => setAsk(null)}>
      {ask && (
        <div>
          <h2 id="cf-title">Please confirm</h2>
          <p>{ask.text}</p>
          <div className="cf-actions">
            <button type="button" className="monarch-secondary" autoFocus onClick={() => setAsk(null)}>Cancel</button>
            <button type="button" className={ask.kind === "permanent" ? "monarch-primary is-danger-solid" : "monarch-primary"} onClick={yes}>Yes, {ask.label.replace(/[.…]+$/, "").toLowerCase()}</button>
          </div>
        </div>
      )}
    </dialog>
  );
}
