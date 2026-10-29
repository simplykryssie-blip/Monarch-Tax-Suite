"use client";

import { useRef, useState } from "react";
import { smsSegments, SMS_MAX } from "@/lib/automation/sms.ts";
import { InsertMenu } from "@/components/ui/merge-field";
import { fromFriendlyWith, toFriendlyWith } from "@/lib/ui/merge-words.ts";

/** A plain-text box for a text message: no formatting bar. A placeholder list inserts at the cursor; a counter shows length. */
export function SmsEditor({ name, initial, placeholders }: { name: string; initial: string; placeholders: { name: string; note: string }[] }) {
  const words = placeholders.map((p) => { const label = p.name.replace(/_/g, " "); return { key: p.name, label: label.charAt(0).toUpperCase() + label.slice(1), note: p.note }; });
  const [text, setText] = useState(toFriendlyWith(words, initial));
  const box = useRef<HTMLTextAreaElement>(null);
  const stored = fromFriendlyWith(words, text);
  function insert(label: string) {
    const el = box.current;
    const at = el ? el.selectionStart : text.length;
    const end = el ? el.selectionEnd : text.length;
    const tag = `[${label}]`;
    const next = `${text.slice(0, at)}${tag}${text.slice(end)}`.slice(0, SMS_MAX * 2);
    setText(next);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + tag.length, at + tag.length); });
  }
  return (
    <div className="mfld">
      <div className="mfld-head">
        <span className="mfld-label">Message</span>
        <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span className="monarch-muted">Plain text only</span>
          <InsertMenu words={words} onPick={(w) => insert(w.label)} />
        </span>
      </div>
      <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} rows={6} required aria-label="Message" />
      <input type="hidden" name={name} value={stored} />
      <small className="monarch-muted">{stored.length} / {SMS_MAX} characters · about {smsSegments(stored)} text message{smsSegments(stored) === 1 ? "" : "s"}</small>
    </div>
  );
}
