"use client";

import { useActionState, useRef } from "react";
import { importClientsAction, type ImportClientsState } from "@/app/prep-actions";

// Import clients from a CSV (made for GoHighLevel's contact export). Shows a preview first; nothing is saved until the
// person confirms. The same file is sent again with the confirm button, so nothing is held on the server in between.

export function ImportClients({ area }: { area: string }) {
  const [state, action, pending] = useActionState<ImportClientsState, FormData>(importClientsAction, undefined);
  const form = useRef<HTMLFormElement>(null);
  const ok = state && !("error" in state) ? state : null;
  return (
    <section className="monarch-panel" id="import" style={{ padding: 20 }}>
      <h2 style={{ marginTop: 0 }}>Import clients</h2>
      <p className="monarch-muted">Bring your people in from GoHighLevel or a spreadsheet. In GoHighLevel: Contacts, choose the contacts, then Export as CSV. Any CSV with a name column and an email or phone column works. Social Security numbers, birth dates and bank details are never imported.</p>
      <form ref={form} action={action} className="monarch-form">
        <input type="hidden" name="area" value={area} />
        <label className="is-wide">CSV file *<input type="file" name="file" accept=".csv,text/csv" required /></label>
        <label>Tag everyone imported<input name="tag" maxLength={40} placeholder="for example: imported from GoHighLevel" autoComplete="off" /></label>
        <div className="is-wide" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="monarch-secondary" disabled={pending}>{pending ? "Reading…" : "Preview"}</button>
          {ok && !ok.done && ok.willAdd > 0 && <button className="monarch-primary" name="confirm" value="1" disabled={pending}>Import {ok.willAdd} {ok.willAdd === 1 ? "client" : "clients"}</button>}
        </div>
      </form>
      {state && "error" in state && <p className="monarch-alert is-error" role="alert">{state.error}</p>}
      {ok && (
        <div role="status">
          <h3>{ok.done ? `Imported ${ok.added} ${ok.added === 1 ? "client" : "clients"}` : `Ready to add ${ok.willAdd} of ${ok.total} rows`}</h3>
          {ok.done && ok.failed > 0 && <p className="monarch-alert is-error">{ok.failed} could not be saved. Run the import again to retry them; people already added are skipped.</p>}
          {ok.done && <p className="monarch-muted">Imported people are not marked as having agreed to marketing email or text. Record consent in Campaigns before sending them a campaign.</p>}
          {ok.columns.sensitive.length > 0 && <p className="monarch-muted">Left out on purpose: {ok.columns.sensitive.join(", ")}.</p>}
          {ok.columns.unknown.length > 0 && <p className="monarch-muted">Not used (no matching field): {ok.columns.unknown.join(", ")}.</p>}
          {!ok.done && ok.sample.length > 0 && (
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>NAME</th><th>CONTACT</th><th>TAGS</th></tr></thead>
              <tbody>{ok.sample.map((s, i) => <tr key={i}><td><b>{s.name}</b>{s.notes.map((n) => <small key={n} className="monarch-subcell">{n}</small>)}</td><td>{s.contact || "—"}</td><td>{s.tags.join(", ") || "—"}</td></tr>)}</tbody>
            </table></div>
          )}
          {!ok.done && ok.willAdd > ok.sample.length && <p className="monarch-muted">Showing the first {ok.sample.length}.</p>}
          {ok.skipped.length > 0 && (
            <details><summary>{ok.skipped.length} {ok.skipped.length === 1 ? "row" : "rows"} left out</summary>
              <ul>{ok.skipped.map((s) => <li key={s.row}>Row {s.row}: {s.reason}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
