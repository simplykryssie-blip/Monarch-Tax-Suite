"use client";

import { useRef, useState } from "react";
import { DEFAULT_CONFIRM_BODY, DEFAULT_CONFIRM_SMS, DEFAULT_CONFIRM_SUBJECT } from "@/lib/appointments/messages.ts";
import { SubmitOnce } from "@/components/admin/submit-once";

const TAGS: [string, string][] = [
  ["Client name", "name"], ["First name", "first_name"], ["Appointment type", "type"], ["Firm name", "office"],
  ["Date and time", "date_time"], ["Location", "location_line"], ["Cancel or change link", "manage_link"],
];
type Field = "subject" | "body" | "sms";

/** The confirmation email subject and body, and the text. Click a tag to drop it into whichever box you were typing in. */
export function MessageFields({ subject, body, sms }: { subject: string | null; body: string | null; sms: string | null }) {
  const [vals, setVals] = useState<Record<Field, string>>({ subject: subject ?? DEFAULT_CONFIRM_SUBJECT, body: body ?? DEFAULT_CONFIRM_BODY, sms: sms ?? DEFAULT_CONFIRM_SMS });
  const [active, setActive] = useState<Field>("body");
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const smsRef = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<Record<Field, number>>({ subject: vals.subject.length, body: vals.body.length, sms: vals.sms.length });

  const remember = (f: Field) => (e: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => { caret.current[f] = e.currentTarget.selectionStart ?? e.currentTarget.value.length; };
  const insert = (key: string) => {
    const tag = `{{${key}}}`;
    const at = caret.current[active];
    setVals((v) => ({ ...v, [active]: v[active].slice(0, at) + tag + v[active].slice(at) }));
    caret.current[active] = at + tag.length;
    requestAnimationFrame(() => { const el = { subject: subjectRef, body: bodyRef, sms: smsRef }[active].current; if (el) { el.focus(); el.setSelectionRange(caret.current[active], caret.current[active]); } });
  };
  const common = (f: Field) => ({ value: vals[f], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setVals((v) => ({ ...v, [f]: e.target.value })); remember(f)(e); }, onFocus: () => setActive(f), onSelect: remember(f), onKeyUp: remember(f), onClick: remember(f) });

  return (
    <>
      <div className="is-wide">
        <b>Add information</b>
        <p className="monarch-muted" style={{ margin: "4px 0 8px" }}>Click where you want it in the subject, the email or the text, then click a tag.</p>
        <div className="msg-tags">{TAGS.map(([label, key]) => <button key={key} type="button" className="msg-tag" onClick={() => insert(key)}>{label}</button>)}</div>
      </div>
      <label className="is-wide">Email subject<input name="confirm_subject" maxLength={200} ref={subjectRef} {...common("subject")} /></label>
      <label className="is-wide">Email<textarea name="confirm_body" rows={9} maxLength={4000} ref={bodyRef} {...common("body")} /></label>
      <label className="is-wide">Text message (sent only to people who agreed to texts)<textarea name="confirm_sms" rows={3} maxLength={320} ref={smsRef} {...common("sms")} /></label>
      <div className="is-wide msg-actions">
        <SubmitOnce className="monarch-primary">Save messages</SubmitOnce>
        <span className="msg-gap" aria-hidden="true" />
        <button name="reset" value="yes" className="monarch-secondary">Use the standard wording</button>
      </div>
    </>
  );
}
