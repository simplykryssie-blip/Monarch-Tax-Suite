"use client";

import { useActionState, useState, useTransition } from "react";
import { MonthPicker } from "@/components/book/month-picker";
import { FormattedInput } from "@/components/forms/formatted-input";
import { bookFormAction, type BookResult } from "@/app/book/actions";

/**
 * The public booking form. Everything typed stays when a try doesn't go through: each detail that needs fixing is marked
 * and says what to do. Text reminders start ticked; they only apply with a mobile number.
 */
export function BookingForm({ slug, slots, officeTz }: { slug: string; slots: string[]; officeTz: string }) {
  const [state, run] = useActionState<BookResult, FormData>(bookFormAction.bind(null, slug), {});
  const [busy, start] = useTransition();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  // Agreeing to texts is the client's own choice, so the box starts unchecked.
  const [texts, setTexts] = useState(false);
  const p = state.problems ?? {};
  // Sent by hand, so the form keeps what was typed instead of clearing itself.
  const submit = (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); const data = new FormData(e.currentTarget); start(() => run(data)); };
  return (
    <form onSubmit={submit} className="monarch-form bk-form" noValidate>
      {state.error && <p className="monarch-alert is-error is-wide" role="alert">{state.error}</p>}
      <h2 className="is-wide">1. Pick a time</h2>
      <div className="is-wide"><MonthPicker slots={slots} officeTz={officeTz} problem={p.starts_at} /></div>
      <h2 className="is-wide">2. Your details</h2>
      <label className={p.name ? "has-problem" : undefined}>Name<input name="name" required maxLength={200} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!p.name} />{p.name && <small className="bk-problem">{p.name}</small>}</label>
      <label className={p.email ? "has-problem" : undefined}>Email<input name="email" type="email" required maxLength={254} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!p.email} />{p.email && <small className="bk-problem">{p.email}</small>}</label>
      <label className={p.phone ? "has-problem" : undefined}>Mobile number (optional)<FormattedInput kind="phone" name="phone" autoComplete="tel" value={phone} onValue={setPhone} aria-invalid={!!p.phone} />{p.phone && <small className="bk-problem">{p.phone}</small>}</label>
      <label className="is-wide na-consent bk-consent"><input type="checkbox" name="sms_consent" checked={texts} onChange={(e) => setTexts(e.target.checked)} /><span>Text me reminders about this appointment. Message and data rates may apply. Reply STOP to opt out.</span></label>
      <label className="is-wide">Anything we should know? (optional)<textarea name="notes" rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", height: 0, overflow: "hidden" }}><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <div className="is-wide"><button type="submit" className="monarch-primary bk-submit" disabled={busy}>{busy ? "Booking…" : "Book appointment"}</button></div>
    </form>
  );
}
