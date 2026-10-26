"use client";

import { useEffect, useRef, useState } from "react";
import { searchClientsAction } from "@/app/(admin)/documents/actions";

type Hit = { id: string; name: string; email: string | null };

/** Type a name or email, pick the client. Submits the chosen client's id as `client_id`. */
export function ClientPicker() {
  const [text, setText] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [chosen, setChosen] = useState<Hit | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (chosen || text.trim().length < 2) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const found = await searchClientsAction(text).catch(() => []);
      if (mine === seq.current) setHits(found);
    }, 200);
    return () => clearTimeout(t);
  }, [text, chosen]);

  return (
    <div className="na-name">
      <input type="hidden" name="client_id" value={chosen?.id ?? ""} required />
      <input
        value={chosen ? chosen.name : text}
        onChange={(e) => { setChosen(null); setHits([]); setText(e.target.value); }}
        placeholder="Start typing a client's name or email"
        autoComplete="off"
        aria-label="Client"
      />
      {!chosen && hits.length > 0 && (
        <ul className="na-hits" role="listbox">
          {hits.map((h) => (
            <li key={h.id}><button type="button" role="option" aria-selected={false} onClick={() => { setChosen(h); setHits([]); }}>{h.name}{h.email && <small className="monarch-subcell">{h.email}</small>}</button></li>
          ))}
        </ul>
      )}
      {chosen?.email == null && chosen && <small className="monarch-muted">This client has no email address yet.</small>}
    </div>
  );
}
