"use client";

import { useEffect, useState, useTransition } from "react";
import { FormattedInput } from "@/components/forms/formatted-input";
import { revealClientSsnAction } from "@/app/(admin)/workspace/actions";

/**
 * A client's Social Security number or ITIN, masked to the last four. Reveal asks for the person's password again, shows the
 * full number for a few seconds, then hides it. Every try, allowed or not, is recorded by the server.
 */
export function RevealSsn({ clientId, last4, onFile }: { clientId: string; last4: string | null; onFile: boolean }) {
  const [asking, setAsking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState("");
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!value) return;
    const t = setTimeout(() => setValue(null), 30_000);
    return () => clearTimeout(t);
  }, [value]);

  const masked = last4 ? `•••-••-${last4}` : "•••-••-••••";
  const submit = () => start(async () => {
    const r = await revealClientSsnAction(clientId, password);
    setPassword("");
    if (r.ssn) { setValue(r.ssn); setError(null); setAsking(false); } else setError(r.error ?? "Could not reveal.");
  });

  return (
    <div className="cl-ssn" aria-live="polite">
      <span className="cl-ssn-value"><b>{value ?? masked}</b></span>
      {onFile && !asking && !value && <button type="button" className="monarch-secondary efin-small" onClick={() => { setAsking(true); setError(null); }}>Reveal</button>}
      {value && <button type="button" className="monarch-secondary efin-small" onClick={() => setValue(null)}>Hide</button>}
      {onFile && <button type="button" className="monarch-secondary efin-small" aria-pressed={editing} onClick={() => setEditing((e) => !e)}>{editing ? "Cancel" : "Edit"}</button>}
      {asking && !value && (
        <span className="cl-ssn-ask">
          <input type="password" autoComplete="current-password" aria-label="Your password" placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (password) submit(); } }} />
          <button type="button" className="monarch-primary efin-small" disabled={pending || !password} onClick={submit}>{pending ? "Checking…" : "Show"}</button>
          <button type="button" className="monarch-link" onClick={() => { setAsking(false); setPassword(""); }}>Cancel</button>
        </span>
      )}
      {error && <small role="alert" style={{ color: "#a8322b" }}>{error}</small>}
      {(editing || !onFile) && (
        <div className="cl-ssn-edit">
          <label>{onFile ? "Correct the number" : "Add the full number"}<FormattedInput kind="ssn" name="ssn" secret autoComplete="off" placeholder="Nine digits" /></label>
        </div>
      )}
    </div>
  );
}
