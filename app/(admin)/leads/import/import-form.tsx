"use client";

import Link from "next/link";
import { useActionState } from "react";
import { LEAD_SOURCES, SOURCE_KEYS } from "@/lib/leads/types.ts";
import { importLeadsAction, type ImportState } from "../actions";

export function ImportForm() {
  const [state, action, pending] = useActionState<ImportState, FormData>(importLeadsAction, undefined);
  return (
    <>
      <form action={action} className="monarch-panel monarch-form" style={{ padding: 20 }}>
        <label>CSV file *<input name="file" type="file" accept=".csv,text/csv" required /></label>
        <label>Source for rows without one *
          <select name="source" required defaultValue="other">
            {SOURCE_KEYS.map((s) => <option key={s} value={s}>{LEAD_SOURCES[s]}</option>)}
          </select>
        </label>
        <div className="is-wide"><button className="monarch-primary" disabled={pending}>{pending ? "Importing…" : "Import leads"}</button></div>
      </form>
      {state && !state.ok && <p className="monarch-notice" role="alert">{state.error}</p>}
      {state?.ok && (
        <section className="monarch-panel" style={{ padding: 20 }} role="status">
          <h2>{state.result.added} {state.result.added === 1 ? "lead" : "leads"} added</h2>
          {state.result.skipped.length > 0 ? (
            <>
              <p className="monarch-muted">{state.result.skipped.length} {state.result.skipped.length === 1 ? "row was" : "rows were"} skipped:</p>
              <ul>{state.result.skipped.slice(0, 200).map((s) => <li key={s.row}>Row {s.row}: {s.reason}</li>)}</ul>
              {state.result.skipped.length > 200 && <p className="monarch-muted">…and {state.result.skipped.length - 200} more.</p>}
            </>
          ) : <p className="monarch-muted">Every row was imported.</p>}
          <p><Link href="/leads">Back to Leads</Link></p>
        </section>
      )}
    </>
  );
}
