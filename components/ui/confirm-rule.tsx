"use client";

import { useEffect, useRef, useState } from "react";
import { confirmKind, confirmText, type ConfirmKind } from "@/lib/ui/confirm.ts";

type Ask = { button: HTMLButtonElement; label: string; kind: ConfirmKind; text: string; detail: string | null };

const GATES = 'input[type="checkbox"][name="confirm"]';
const labelOf = (b: HTMLButtonElement) => (b.getAttribute("aria-label") || b.textContent || "").trim();
const isDestructive = (b: HTMLButtonElement) => !b.hasAttribute("data-no-confirm") && confirmKind(labelOf(b), b.classList.contains("is-danger")) !== null;
const submitButtons = (form: HTMLFormElement) => [...form.querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.type === "submit");
/** A tick-box's wording is worth showing in the dialog when it says something specific, not just "Sure" or "I understand". */
const gateDetail = (form: HTMLFormElement): string | null => {
  for (const box of form.querySelectorAll<HTMLInputElement>(GATES)) {
    const text = (box.closest("label")?.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text.length > 25 && !/^(i |sure|confirm)/i.test(text)) return text;
  }
  return null;
};

/**
 * The app-wide "ask before you destroy" rule. Mounted once in the root layout: any submit button whose label says Delete,
 * Remove, Archive, Restore, Void, Discard, Revoke, Disconnect, Withdraw, Take offline and so on (or that is styled as dangerous)
 * opens one shared dialog first. Nothing is submitted until the person says yes. Forms that already ask with their own dialog
 * (data-has-confirm) or a typed word are left alone. An old "tick this box" gate does not count as asking: the dialog replaces
 * it, the box is hidden, and Yes ticks it for the person so the server's own check still passes.
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
      // A form that needs a typed word before it can be sent has asked.
      if (button.form.querySelector('input[name="confirm_text"], input[name="confirm"]:not([type="checkbox"]):not([type="hidden"])')) return;
      const label = labelOf(button);
      const kind = confirmKind(label, button.classList.contains("is-danger"));
      if (!kind) return;
      e.preventDefault();
      e.stopPropagation();
      const custom = button.getAttribute("data-confirm") || button.form.getAttribute("data-confirm");
      setAsk({ button, label, kind, text: custom ?? confirmText(label, kind), detail: custom ? null : gateDetail(button.form) });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Hide the old tick-box gates on forms whose every button now asks through the dialog.
  useEffect(() => {
    const sweep = () => {
      for (const box of document.querySelectorAll<HTMLInputElement>(GATES)) {
        const form = box.form;
        if (!form || box.dataset.autoGate) continue;
        const buttons = submitButtons(form);
        if (buttons.length === 0 || !buttons.every(isDestructive)) continue;
        box.dataset.autoGate = "1";
        box.closest("label")?.setAttribute("hidden", "");
      }
    };
    sweep();
    const watch = new MutationObserver(sweep);
    watch.observe(document.body, { childList: true, subtree: true });
    return () => watch.disconnect();
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
    for (const box of a.button.form.querySelectorAll<HTMLInputElement>(GATES)) box.checked = true;
    // requestSubmit sends the form as if the button had been pressed, without a click, so this rule is not asked again.
    a.button.form.requestSubmit(a.button);
  };

  return (
    <dialog ref={dialog} className="cf-dialog" aria-labelledby="cf-title" onClose={() => setAsk(null)}>
      {ask && (
        <div>
          <h2 id="cf-title">Please confirm</h2>
          <p>{ask.text}</p>
          {ask.detail && <p className="cf-detail">{ask.detail}</p>}
          <div className="cf-actions">
            <button type="button" className="monarch-secondary" autoFocus onClick={() => setAsk(null)}>Cancel</button>
            <button type="button" className={ask.kind === "permanent" ? "monarch-primary is-danger-solid" : "monarch-primary"} onClick={yes}>Yes, {ask.label.replace(/[.…]+$/, "").toLowerCase()}</button>
          </div>
        </div>
      )}
    </dialog>
  );
}
