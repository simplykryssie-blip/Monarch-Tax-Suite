"use client";

import { useState } from "react";
import { toFriendly, TAG_WORDS, DEFAULT_CANCEL_BODY, DEFAULT_CANCEL_SUBJECT, DEFAULT_CONFIRM_BODY, DEFAULT_CONFIRM_SMS, DEFAULT_CONFIRM_SUBJECT, DEFAULT_REMINDER_BODY, DEFAULT_REMINDER_SMS, DEFAULT_REMINDER_SUBJECT } from "@/lib/appointments/messages.ts";
import { SubmitOnce } from "@/components/admin/submit-once";
import { MergeField, type MergeWord } from "@/components/ui/merge-field";
import { sendTestMessageAction } from "@/app/(admin)/calendar/actions";

const WORDS: MergeWord[] = [
  { key: "name", label: "Client name" }, { key: "first_name", label: "First name" }, { key: "type", label: "Appointment type" }, { key: "office", label: "Firm name" },
  { key: "date_time", label: "Date and time" }, { key: "location_line", label: "Location" }, { key: "manage_link", label: "Cancel or change link" },
];
void TAG_WORDS;
type Field = "subject" | "body" | "sms";
export type MessageGroup = "confirm" | "reminder" | "cancel";
const DEFAULTS: Record<MessageGroup, { subject: string; body: string; sms: string | null }> = {
  confirm: { subject: DEFAULT_CONFIRM_SUBJECT, body: DEFAULT_CONFIRM_BODY, sms: DEFAULT_CONFIRM_SMS },
  reminder: { subject: DEFAULT_REMINDER_SUBJECT, body: DEFAULT_REMINDER_BODY, sms: DEFAULT_REMINDER_SMS },
  cancel: { subject: DEFAULT_CANCEL_SUBJECT, body: DEFAULT_CANCEL_BODY, sms: null },
};

/** One message: its subject, the email, and (where there is one) the text. Each field has its own Insert menu that puts the choice at the cursor in that field. */
export function MessageFields({ group = "confirm", subject, body, sms }: { group?: MessageGroup; subject: string | null; body: string | null; sms: string | null }) {
  const d = DEFAULTS[group];
  const [vals, setVals] = useState<Record<Field, string>>({ subject: toFriendly(subject ?? d.subject), body: toFriendly(body ?? d.body), sms: toFriendly(sms ?? d.sms ?? "") });
  const set = (f: Field) => (v: string) => setVals((x) => ({ ...x, [f]: v }));
  return (
    <>
      <input type="hidden" name="group" value={group} />
      <MergeField label="Email subject" name={`${group}_subject`} words={WORDS} value={vals.subject} onChange={set("subject")} maxLength={200} />
      <MergeField label="Email" name={`${group}_body`} words={WORDS} value={vals.body} onChange={set("body")} maxLength={4000} multiline rows={9} />
      {d.sms !== null && <MergeField label="Text message" name={`${group}_sms`} words={WORDS} value={vals.sms} onChange={set("sms")} maxLength={320} multiline rows={3} hint="Sent only to people who agreed to texts." />}
      <div className="is-wide msg-actions">
        <SubmitOnce className="monarch-primary">Save messages</SubmitOnce>
        <span className="msg-gap" aria-hidden="true" />
        <button name="reset" value="yes" className="monarch-secondary">Use the standard wording</button>
        <button formAction={sendTestMessageAction} data-no-confirm className="monarch-secondary" title="Emails this message, as it is on screen, to you. Nothing is booked.">Send me a test</button>
      </div>
    </>
  );
}
