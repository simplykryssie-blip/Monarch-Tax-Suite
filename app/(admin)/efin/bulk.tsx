"use client";

import { useEffect, useRef, useState } from "react";
import { ActionForm } from "./action-form";
import { bulkAction } from "./actions";

/** Header checkbox that ticks or clears every row checkbox (name="ids") on the page. */
export function SelectAll() {
  return (
    <input
      type="checkbox"
      aria-label="Select all rows"
      onChange={(e) => document.querySelectorAll<HTMLInputElement>('input[name="ids"]').forEach((c) => { c.checked = e.currentTarget.checked; })}
    />
  );
}

const ACTIONS = [
  { value: "archive", label: "Archive (reversible)" },
  { value: "restore", label: "Restore archived" },
  { value: "status_active", label: "Set status: active" },
  { value: "status_inactive", label: "Set status: inactive" },
  { value: "status_suspended", label: "Set status: suspended" },
  { value: "status_pending_verification", label: "Set status: pending verification" },
  { value: "delete", label: "Delete permanently" },
];

/** Bulk actions for the checked rows. Reason and confirmation are required for anything high-impact; the server enforces it too. */
export function BulkBar() {
  const [count, setCount] = useState(0);
  const [action, setAction] = useState("archive");
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const update = () => setCount(document.querySelectorAll('input[name="ids"]:checked').length);
    document.addEventListener("change", update);
    return () => document.removeEventListener("change", update);
  }, []);
  const needsReason = action !== "restore";
  const needsConfirm = !["restore", "status_active", "status_pending_verification"].includes(action);
  const exportCsv = () => {
    const ids = [...document.querySelectorAll<HTMLInputElement>('input[name="ids"]:checked')].map((c) => c.value);
    if (!ids.length) return;
    const a = document.createElement("a"); // a file download, not a page navigation
    a.href = `/efin/export?ids=${encodeURIComponent(ids.join(","))}`;
    a.download = "";
    a.click();
  };
  return (
    <div ref={wrap} className="efin-bulk">
      <ActionForm
        action={bulkAction}
        className="efin-actions"
        confirm={action === "delete" ? "Permanently delete the selected rows? This cannot be undone." : undefined}
      >
        <strong style={{ fontSize: 13.5 }}>{count} selected</strong>
        {/* the row checkboxes live in the table; mirror them into this form on submit */}
        <BulkIds />
        <select name="bulk_action" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Bulk action">
          {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
        {needsReason && <input type="text" name="reason" placeholder="Reason (recorded)" minLength={5} maxLength={1000} aria-label="Reason" />}
        {needsConfirm && <label className="efin-confirm"><input type="checkbox" name="confirm" /> Confirm</label>}
        <button className={"monarch-secondary efin-small" + (action === "delete" ? " is-danger" : "")} type="submit" disabled={count === 0}>Apply</button>
      </ActionForm>
      <button type="button" className="monarch-secondary efin-small" onClick={exportCsv} disabled={count === 0}>Export CSV</button>
    </div>
  );
}

/** Copies the ticked row ids into hidden inputs just before the form is read. */
function BulkIds() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const sync = () => {
      ref.current!.replaceChildren(...[...document.querySelectorAll<HTMLInputElement>('input[name="ids"]:checked')].map((c) => { const i = document.createElement("input"); i.type = "hidden"; i.name = "ids"; i.value = c.value; return i; }));
    };
    form.addEventListener("submit", sync, true);
    return () => form.removeEventListener("submit", sync, true);
  }, []);
  return <span ref={ref} />;
}
