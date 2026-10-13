"use client";

import { useState } from "react";
import { revealAnswerAction } from "@/app/(admin)/forms/actions";

/** Shows one encrypted answer on request. Each reveal is recorded in the submission's history. */
export function RevealAnswer({ submissionId, fieldKey, masked }: { submissionId: string; fieldKey: string; masked: string }) {
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (value !== null) return <span><code>{value}</code> <button type="button" className="monarch-link" onClick={() => setValue(null)}>Hide</button></span>;
  return (
    <span>
      {masked}{" "}
      <button type="button" className="monarch-link" disabled={busy} onClick={async () => { setBusy(true); const r = await revealAnswerAction(submissionId, fieldKey); setBusy(false); if (r.ok) setValue(r.value); else setError(r.error); }}>Show</button>
      {error && <small className="mf-error"> {error}</small>}
    </span>
  );
}
