"use client";

import { useEffect, useState, useTransition } from "react";
import { revealEfinAction } from "./actions";

/** Masked by default. Revealing asks the server, which logs the read; the number hides itself again after 30 seconds. */
export function RevealEfin({ id, last4 }: { id: string; last4: string }) {
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!value) return;
    const t = setTimeout(() => setValue(null), 30_000);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <span className="efin-actions">
      <span className="efin-mask">{value ?? `••${last4}`.padStart(6, "•")}</span>
      <button type="button" className="monarch-secondary efin-small" disabled={pending} onClick={() => (value ? setValue(null) : start(async () => { const r = await revealEfinAction(id); if (r.value) { setValue(r.value); setError(null); } else setError(r.error ?? "Could not reveal."); }))}>
        {value ? "Hide" : pending ? "Revealing…" : "Reveal (logged)"}
      </button>
      {error && <small role="alert" style={{ color: "#a8322b" }}>{error}</small>}
    </span>
  );
}
