"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { addLeadFromCalendarAction, searchPeopleAction, type PersonHit } from "@/app/(admin)/calendar/actions";
import { FormattedInput } from "@/components/forms/formatted-input";

/** Find a client or lead by typing a name, or add someone new as a lead on the spot. Sends the chosen person as other_kind and other_id. */
export function PersonPicker({ excludeId }: { excludeId?: string }) {
  const [name, setName] = useState("");
  const [hits, setHits] = useState<PersonHit[] | null>(null);
  const [picked, setPicked] = useState<PersonHit | null>(null);
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [, start] = useTransition();
  const seq = useRef(0);

  useEffect(() => {
    if (picked || name.trim().length < 2) return;
    const mine = ++seq.current;
    const t = setTimeout(() => { searchPeopleAction(name).then((r) => { if (mine === seq.current) setHits(r.filter((h) => h.id !== excludeId)); }, () => { if (mine === seq.current) setHits([]); }); }, 200);
    return () => clearTimeout(t);
  }, [name, picked, excludeId]);

  const choose = (p: PersonHit) => { setPicked(p); setName(p.name); setHits(null); setAdding(false); setProblem(null); };
  const addLead = () => {
    setProblem(null);
    start(async () => {
      const r = await addLeadFromCalendarAction({ name, email, phone });
      if (r.ok) { choose(r.person); setEmail(""); setPhone(""); } else setProblem(r.error);
    });
  };
  const notFound = !picked && hits !== null && hits.length === 0 && name.trim().length >= 2;

  return (
    <div className="is-wide na-name">
      <input type="hidden" name="other_kind" value={picked?.kind ?? ""} />
      <input type="hidden" name="other_id" value={picked?.id ?? ""} />
      <label>The other person
        <input value={name} onChange={(e) => { setName(e.target.value); setPicked(null); if (e.target.value.trim().length < 2) setHits(null); }} autoComplete="off" placeholder="Start typing a name" aria-required="true" />
      </label>
      {hits && hits.length > 0 && !picked && (
        <ul className="na-hits" role="listbox" aria-label="Matching people">
          {hits.map((h) => <li key={`${h.kind}${h.id}`}><button type="button" role="option" aria-selected="false" onClick={() => choose(h)}><b>{h.name}</b><small>{[h.kind === "client" ? "Client" : "Lead", h.email, h.phone].filter(Boolean).join(" · ")}</small></button></li>)}
        </ul>
      )}
      {notFound && !adding && <p className="na-none">No one found. <button type="button" className="monarch-link" onClick={() => setAdding(true)}>Add “{name.trim()}” as a lead</button></p>}
      {notFound && adding && (
        <div className="na-add">
          <label>Email *<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoComplete="off" /></label>
          <label>Phone<FormattedInput kind="phone" name="picker_phone_unused" value={phone} onValue={setPhone} autoComplete="off" /></label>
          <div><button type="button" className="monarch-secondary" onClick={addLead} disabled={!email}>Add lead</button> <button type="button" className="monarch-link" onClick={() => setAdding(false)}>Cancel</button></div>
        </div>
      )}
      {picked && <p className="na-none monarch-muted">{picked.kind === "client" ? "An existing client." : "A lead."}</p>}
      {problem && <p className="monarch-alert is-error" role="alert">{problem}</p>}
    </div>
  );
}
