"use client";

import { useRef, useState } from "react";
import { toFriendly, TAG_WORDS, DEFAULT_CANCEL_BODY, DEFAULT_CANCEL_SUBJECT, DEFAULT_CONFIRM_BODY, DEFAULT_CONFIRM_SMS, DEFAULT_CONFIRM_SUBJECT, DEFAULT_REMINDER_BODY, DEFAULT_REMINDER_SMS, DEFAULT_REMINDER_SUBJECT } from "@/lib/appointments/messages.ts";
import { SubmitOnce } from "@/components/admin/submit-once";
import { sendTestMessageAction } from "@/app/(admin)/calendar/actions";

const TAGS: [string, string][] = [
  ["Client name", "name"], ["First name", "first_name"], ["Appointment type", "type"], ["Firm name", "office"],
  ["Date and time", "date_time"], ["Location", "location_line"], ["Cancel or change link", "manage_link"],
];
void TAG_WORDS;
type Field = "subject" | "body" | "sms";
export type MessageGroup = "confirm" | "reminder" | "cancel";
const DEFAULTS: Record<MessageGroup, { subject: string; body: string; sms: string | null }> = {
  confirm: { subject: DEFAULT_CONFIRM_SUBJECT, body: DEFAULT_CONFIRM_BODY, sms: DEFAULT_CONFIRM_SMS },
  reminder: { subject: DEFAULT_REMINDER_SUBJECT, body: DEFAULT_REMINDER_BODY, sms: DEFAULT_REMINDER_SMS },
  cancel: { subject: DEFAULT_CANCEL_SUBJECT, body: DEFAULT_CANCEL_BODY, sms: null },
};

/** The confirmation email subject and body, and the text. Pick what to add from the list and it drops into the box you were typing in, shown in [brackets]. */
export function MessageFields({ group = "confirm", subject, body, sms }: { group?: MessageGroup; subject: string | null; body: string | null; sms: string | null }) {
  const d = DEFAULTS[group];
  const [vals, setVals] = useState<Record<Field, string>>({ subject: toFriendly(subject ?? d.subject), body: toFriendly(body ?? d.body), sms: toFriendly(sms ?? d.sms ?? "") });
  const [active, setActive] = useState<Field>("body");
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const smsRef = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<Record<Field, number>>({ subject: vals.subject.length, body: vals.body.length, sms: vals.sms.length });

  const remember = (f: Field) => (e: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => { caret.current[f] = e.currentTarget.selectionStart ?? e.currentTarget.value.length; };
  const insert = (key: string) => {
    const tag = `[${TAG_WORDS[key] ?? key}]`;
    const at = caret.current[active];
    setVals((v) => ({ ...v, [active]: v[active].slice(0, at) + tag + v[active].slice(at) }));
    caret.current[active] = at + tag.length;
    requestAnimationFrame(() => { const el = { subject: subjectRef, body: bodyRef, sms: smsRef }[active].current; if (el) { el.focus(); el.setSelectionRange(caret.current[active], caret.current[active]); } });
  };
  const common = (f: Field) => ({ value: vals[f], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setVals((v) => ({ ...v, [f]: e.target.value })); remember(f)(e); }, onFocus: () => setActive(f), onSelect: remember(f), onKeyUp: remember(f), onClick: remember(f) });

  return (
    <>
      <input type="hidden" name="group" value={group} />
      <div className="is-wide">
        <label>Add information
          <select value="" onChange={(e) => { if (e.target.value) insert(e.target.value); }}>
            <option value="">Choose what to add…</option>
            {TAGS.map(([label, key]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
      </div>
      <label className="is-wide">Email subject<input name={`${group}_subject`} maxLength={200} ref={subjectRef} {...common("subject")} /></label>
      <label className="is-wide">Email<textarea name={`${group}_body`} rows={9} maxLength={4000} ref={bodyRef} {...common("body")} /></label>
      {d.sms !== null && <label className="is-wide">Text message (sent only to people who agreed to texts)<textarea name={`${group}_sms`} rows={3} maxLength={320} ref={smsRef} {...common("sms")} /></label>}
      <div className="is-wide msg-actions">
        <SubmitOnce className="monarch-primary">Save messages</SubmitOnce>
        <span className="msg-gap" aria-hidden="true" />
        <button name="reset" value="yes" className="monarch-secondary">Use the standard wording</button>
        <button formAction={sendTestMessageAction} data-no-confirm className="monarch-secondary" title="Emails this message, as it is on screen, to you. Nothing is booked.">Send me a test</button>
      </div>
    </>
  );
}
