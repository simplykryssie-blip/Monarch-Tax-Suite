"use client";

import { useActionState, useState } from "react";
import { importAction, type ImportState } from "@/app/import-actions";
import type { Destination } from "@/lib/imports/contacts.ts";

// Import from a spreadsheet (made for GoHighLevel's exports). Choose where it goes and what kind of file it is, preview,
// then confirm. The same file is sent again with the confirm button, so nothing is held on the server in between.

type Info = { label: string; tags: boolean; notes: boolean; messages: boolean };
// Mirrors lib/imports/contacts.ts SUPPORTS (kept here so the client doesn't import server code).
const INFO: Record<Destination, Info> = {
  clients: { label: "Clients (My Clients)", tags: true, notes: true, messages: true },
  leads: { label: "Leads", tags: true, notes: true, messages: false },
  customers: { label: "Store customers", tags: false, notes: false, messages: false },
  firms: { label: "Firms (EROs & EFINs)", tags: false, notes: true, messages: false },
};
const KIND_LABEL = { contacts: "People (a contact list)", notes: "Notes for people already added", messages: "Messages for people already added" } as const;
const HELP = {
  contacts: "In GoHighLevel: Contacts, choose the contacts, then Export as CSV. Any CSV with a name column and an email (or phone) column works. Tags and a Notes column come along where the destination keeps them.",
  notes: "A CSV with one note per row: who it belongs to (Email, Phone or Name), the Note, and optionally the Date. Each note is added to the matching person.",
  messages: "A CSV with one message per row: who it belongs to (Email or Phone), the Message, and optionally Direction (inbound or outbound), Type (email, sms, call), Subject and Date. They are saved as history only; nothing is sent.",
};

export function ImportPanel({ scope, destinations }: { scope: string; destinations: Destination[] }) {
  const [state, action, pending] = useActionState<ImportState, FormData>(importAction, undefined);
  const [destination, setDestination] = useState<Destination>(destinations[0]);
  const [kind, setKind] = useState<keyof typeof KIND_LABEL>("contacts");
  const info = INFO[destination];
  const kinds = (Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).filter((k) => k === "contacts" || info[k]);
  const ok = state && !("error" in state) ? state : null;
  const unit = ok ? (ok.kind === "contacts" ? (ok.willAdd === 1 ? "person" : "people") : ok.kind === "notes" ? (ok.willAdd === 1 ? "note" : "notes") : (ok.willAdd === 1 ? "message" : "messages")) : "";
  return (
    <section className="monarch-panel" id="import" style={{ padding: 20 }}>
      <h2 style={{ marginTop: 0 }}>Import from a spreadsheet or GoHighLevel</h2>
      <form action={action} className="monarch-form">
        <input type="hidden" name="scope" value={scope} />
        {destinations.length > 1 ? (
          <label>Import into
            <select name="destination" value={destination} onChange={(e) => { const d = e.target.value as Destination; setDestination(d); if (kind !== "contacts" && !INFO[d][kind]) setKind("contacts"); }}>
              {destinations.map((d) => <option key={d} value={d}>{INFO[d].label}</option>)}
            </select>
          </label>
        ) : <input type="hidden" name="destination" value={destinations[0]} />}
        <label>What is in the file
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as keyof typeof KIND_LABEL)}>
            {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <p className="monarch-muted is-wide">{HELP[kind]}{kind === "contacts" && ` ${info.label} keep: name, email, phone${destination === "firms" ? " (in the notes)" : ""}${info.tags ? ", tags" : ""}${info.notes ? ", notes" : ""}.`} Social Security numbers, birth dates and bank details are never imported.</p>
        <label className="is-wide">CSV file *<input type="file" name="file" accept=".csv,text/csv" required /></label>
        {kind === "contacts" && info.tags && <label>Also tag everyone imported<input name="tag" maxLength={40} placeholder="for example: imported from GoHighLevel" autoComplete="off" /></label>}
        <div className="is-wide" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="monarch-secondary" disabled={pending}>{pending ? "Reading…" : "Preview"}</button>
          {ok && !ok.done && ok.willAdd > 0 && <button className="monarch-primary" name="confirm" value="1" disabled={pending}>Import {ok.willAdd} {unit}</button>}
        </div>
      </form>
      {state && "error" in state && <p className="monarch-alert is-error" role="alert">{state.error}</p>}
      {ok && (
        <div role="status">
          <h3>{ok.done ? `Imported ${ok.added} ${ok.added === 1 ? unit : unit}` : `Ready to add ${ok.willAdd} of ${ok.total} rows`}</h3>
          {ok.done && ok.failed > 0 && <p className="monarch-alert is-error">{ok.failed} could not be saved. Run the import again to retry them; people already added are skipped.</p>}
          {ok.kind === "contacts" && ok.newTags.length > 0 && <p><b>{ok.done ? "New tags created" : "New tags that will be created"}:</b> {ok.newTags.join(", ")}.{ok.existingTags.length > 0 && <> Already in use: {ok.existingTags.join(", ")}.</>}</p>}
          {ok.kind === "contacts" && ok.newTags.length === 0 && ok.existingTags.length > 0 && <p className="monarch-muted">Tags used: {ok.existingTags.join(", ")} (all already in use).</p>}
          {ok.done && ok.kind === "contacts" && <p className="monarch-muted">Imported people are not marked as having agreed to marketing email or text. Record consent in Campaigns before sending them a campaign.</p>}
          {ok.done && ok.kind === "messages" && <p className="monarch-muted">Messages were saved as history only. Nothing was sent.</p>}
          {ok.columns.sensitive.length > 0 && <p className="monarch-muted">Left out on purpose: {ok.columns.sensitive.join(", ")}.</p>}
          {ok.columns.unsupported.length > 0 && <p className="monarch-muted">{INFO[ok.destination].label} don&apos;t keep these, so they were not imported: {ok.columns.unsupported.join(", ")}.</p>}
          {ok.columns.unknown.length > 0 && <p className="monarch-muted">Not used (no matching field): {ok.columns.unknown.join(", ")}.</p>}
          {!ok.done && ok.sample.length > 0 && (
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>{ok.kind === "contacts" ? "NAME" : "PERSON"}</th><th>{ok.kind === "contacts" ? "CONTACT" : "WHAT"}</th>{ok.kind === "contacts" && <th>TAGS</th>}</tr></thead>
              <tbody>{ok.sample.map((s, i) => <tr key={i}><td><b>{s.name}</b>{s.notes.map((n) => <small key={n} className="monarch-subcell">{n}</small>)}</td><td>{s.detail || "—"}</td>{ok.kind === "contacts" && <td>{s.tags.join(", ") || "—"}</td>}</tr>)}</tbody>
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
