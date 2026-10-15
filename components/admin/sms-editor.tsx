"use client";

import { useRef, useState } from "react";
import { smsSegments, SMS_MAX } from "@/lib/automation/sms.ts";

/** A plain-text box for a text message: no formatting bar. A placeholder list inserts at the cursor; a counter shows length. */
export function SmsEditor({ name, initial, placeholders }: { name: string; initial: string; placeholders: { name: string; note: string }[] }) {
  const [text, setText] = useState(initial);
  const box = useRef<HTMLTextAreaElement>(null);
  function insert(token: string) {
    if (!token) return;
    const el = box.current;
    const at = el ? el.selectionStart : text.length;
    const end = el ? el.selectionEnd : text.length;
    const next = `${text.slice(0, at)}{{${token}}}${text.slice(end)}`.slice(0, SMS_MAX);
    setText(next);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + token.length + 4, at + token.length + 4); });
  }
  return (
    <div className="re">
      <span className="field-label">Message</span>
      <div className="re-bar">
        <select aria-label="Insert placeholder" value="" onChange={(e) => insert(e.target.value)}>
          <option value="">Insert placeholder…</option>
          {placeholders.map((p) => <option key={p.name} value={p.name} title={p.note}>{p.name.replace(/_/g, " ")}</option>)}
        </select>
        <span className="monarch-muted" style={{ marginLeft: "auto" }}>Plain text only</span>
      </div>
      <textarea ref={box} name={name} value={text} onChange={(e) => setText(e.target.value)} rows={6} maxLength={SMS_MAX} required aria-label="Message" />
      <small className="monarch-muted">{text.length} / {SMS_MAX} characters · about {smsSegments(text)} text message{smsSegments(text) === 1 ? "" : "s"}</small>
    </div>
  );
}
