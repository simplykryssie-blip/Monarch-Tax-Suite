"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { addLeadFromCalendarAction, bookAction, searchPeopleAction, type PersonHit } from "@/app/(admin)/calendar/actions";
import { FormattedInput } from "@/components/forms/formatted-input";
import { SubmitOnce } from "@/components/admin/submit-once";

type Type = { id: string; label: string };

/** Staff book an appointment: the name searches your clients and leads as you type, and someone new can be added as a lead right here. */
export function NewAppointmentForm({ types, tz }: { types: Type[]; tz: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [clientId, setClientId] = useState("");
  const [hits, setHits] = useState<PersonHit[] | null>(null);
  const [picked, setPicked] = useState<PersonHit | null>(null);
  const [adding, setAdding] = useState(false);
  const [leadEmail, setLeadEmail] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [, start] = useTransition();
  const seq = useRef(0);

  useEffect(() => {
    if (picked || name.trim().length < 2) return;
    const mine = ++seq.current;
    const t = setTimeout(() => { searchPeopleAction(name).then((r) => { if (mine === seq.current) setHits(r); }, () => { if (mine === seq.current) setHits([]); }); }, 200);
    return () => clearTimeout(t);
  }, [name, picked]);

  const choose = (p: PersonHit) => { setPicked(p); setName(p.name); setEmail(p.email ?? ""); setPhone(p.phone ?? ""); setClientId(p.kind === "client" ? p.id : ""); setHits(null); setAdding(false); setProblem(null); };
  const addLead = () => {
    setProblem(null);
    start(async () => {
      const r = await addLeadFromCalendarAction({ name, email: leadEmail, phone: leadPhone });
      if (r.ok) { choose(r.person); setLeadEmail(""); setLeadPhone(""); } else setProblem(r.error);
    });
  };
  const notFound = !picked && hits !== null && hits.length === 0 && name.trim().length >= 2;

  return (
    <form action={bookAction} className="monarch-panel monarch-form" style={{ padding: 20 }}>
      <input type="hidden" name="client_id" value={clientId} />
      <label>Appointment type
        <select name="type_id" required>{types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
      </label>
      <label>Date and time ({tz.replace(/_/g, " ")})<input type="datetime-local" name="starts_at" required /></label>
      <div className="is-wide na-name">
        <label>Name<input name="name" required maxLength={200} value={name} onChange={(e) => { setName(e.target.value); setPicked(null); setClientId(""); if (e.target.value.trim().length < 2) setHits(null); }} autoComplete="off" placeholder="Start typing a name" /></label>
        {hits && hits.length > 0 && !picked && (
          <ul className="na-hits" role="listbox" aria-label="Matching contacts">
            {hits.map((h) => <li key={`${h.kind}${h.id}`}><button type="button" role="option" aria-selected="false" onClick={() => choose(h)}><b>{h.name}</b><small>{[h.kind === "client" ? "Client" : "Lead", h.email, h.phone].filter(Boolean).join(" · ")}</small></button></li>)}
          </ul>
        )}
        {notFound && !adding && (
          <p className="na-none">No contact found. <button type="button" className="monarch-link" onClick={() => setAdding(true)}>Add “{name.trim()}” as a lead</button></p>
        )}
        {notFound && adding && (
          <div className="na-add">
            <label>Email *<input type="email" value={leadEmail} onChange={(e) => setLeadEmail(e.target.value)} maxLength={254} autoComplete="off" /></label>
            <label>Mobile number<FormattedInput kind="phone" name="lead_phone_unused" value={leadPhone} onValue={setLeadPhone} autoComplete="off" /></label>
            <div><button type="button" className="monarch-secondary" onClick={addLead} disabled={!leadEmail}>Add lead</button> <button type="button" className="monarch-link" onClick={() => setAdding(false)}>Cancel</button></div>
          </div>
        )}
        {picked && <p className="na-none monarch-muted">{picked.kind === "client" ? "An existing client." : "A lead."} Their details are filled in below.</p>}
        {problem && <p className="monarch-alert is-error" role="alert">{problem}</p>}
      </div>
      <label>Email<input name="email" type="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></label>
      <label>Mobile number (optional)<FormattedInput kind="phone" name="phone" value={phone} onValue={setPhone} autoComplete="off" /></label>
      <label className="is-wide monarch-check na-consent"><input type="checkbox" name="sms_consent" /> <span>This person agreed to receive text reminders</span></label>
      <label className="is-wide">Notes<textarea name="notes" rows={3} maxLength={1000} /></label>
      <div className="is-wide"><SubmitOnce className="monarch-primary" busy="Booking…">Book appointment</SubmitOnce></div>
    </form>
  );
}
