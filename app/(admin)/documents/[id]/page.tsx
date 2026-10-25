import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { documentDeps } from "@/lib/documents/server";
import { MERGE_FIELDS } from "@/lib/documents/fields.ts";
import Link from "next/link";
import { Badge, Flash, label, PageTitle, when } from "@/components/admin/ui";
import { ArchivePanel } from "@/components/admin/archive";
import { DocumentUploader } from "@/components/admin/document-uploader";
import { ClientPicker } from "@/components/documents/client-picker";
import { VIEWABLE_TYPES } from "@/lib/documents/files.ts";
import { folderPaths } from "@/lib/documents/folders.ts";
import { SubmitOnce } from "@/components/admin/submit-once";
import { ASK_FIELD, askLabel } from "@/lib/documents/fields.ts";
import { moveDocumentAction, revokeDeliveryAction, saveConsentAction, saveDocumentDetailsAction, sendToClientAction } from "../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

export default async function DocumentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; notice?: string; error?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const { notice, error, tab: askedTab } = await searchParams;
  if (!UUID.test(id)) notFound();
  const deps = documentDeps();
  const doc = await deps.repo.getDocument(id);
  if (!doc) notFound();
  const [versions, deliveries, signatures, events, folders] = await Promise.all([
    deps.repo.listVersions(id), deps.repo.listDeliveries(id, 100), deps.repo.listSignatures(id, 100), deps.repo.listEvents(id, 50), deps.repo.listFolders().catch(() => []),
  ]);
  const current = versions.find((v) => v.id === doc.current_version_id) ?? null;
  const sigByDelivery = new Map(signatures.map((s) => [s.delivery_id, s]));
  const canSign = doc.file_type === "pdf";
  const tabs = [["file", "File"], ["send", "Send"], ["sent", `Sent copies${deliveries.length ? ` (${deliveries.length})` : ""}`], ["settings", "Settings"]] as const;
  const tab = tabs.some(([k]) => k === askedTab) ? askedTab! : "file";
  const asks = (current?.merge_fields ?? []).filter((f) => ASK_FIELD.test(f));
  const paths = folderPaths(folders);

  return (
    <>
      <PageTitle title={doc.name} back={{ href: doc.folder_id ? `/documents?internal=1&folder=${doc.folder_id}` : "/documents?internal=1", label: "Internal docs" }}>
        {doc.file_type.toUpperCase()}{doc.status === "archived" ? " · Archived" : ""}{doc.description ? ` · ${doc.description}` : ""}
      </PageTitle>
      <Flash notice={notice} error={error} />
      <nav className="mf-tabs" aria-label="Document">
        {tabs.map(([k, label]) => <Link key={k} href={`/documents/${doc.id}?tab=${k}`} className={tab === k ? "is-active" : undefined} aria-current={tab === k ? "page" : undefined}>{label}</Link>)}
      </nav>

      {tab === "send" && (
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2>Send to a client</h2>
          {doc.status !== "active" || !current ? <p className="monarch-muted">{doc.status !== "active" ? "This document is archived. Restore it to send it." : "Add the file first (File tab)."}</p> : (
            <form action={sendToClientAction} className="monarch-form">
              <input type="hidden" name="id" value={doc.id} />
              <label className="is-wide">Client<ClientPicker /></label>
              <label className="is-wide">Send it
                <select name="kind" defaultValue="send">
                  <option value="send">To read and download</option>
                  {canSign && <option value="signature" disabled={!doc.signature_consent}>To sign{doc.signature_consent ? "" : " (add a consent statement in Settings first)"}</option>}
                </select>
              </label>
              {asks.map((f) => <label key={f} className="is-wide">{askLabel(f)} *<input name={f} required maxLength={300} /></label>)}
              <label className="is-wide">Message (optional)<textarea name="message" rows={3} maxLength={1000} /></label>
              <div className="is-wide"><SubmitOnce className="monarch-primary" busy="Sending…">Send</SubmitOnce></div>
            </form>
          )}
        </section>
      )}

      {tab === "sent" && (
        <>
          <section className="monarch-panel">
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>SENT</th><th>TO</th><th>HOW</th><th>STATUS</th><th>COPY</th><th></th></tr></thead>
              <tbody>
                {deliveries.length === 0 ? <tr><td colSpan={6} className="monarch-empty">Not sent yet.</td></tr> : deliveries.map((d) => {
                  const sig = sigByDelivery.get(d.id);
                  const status = d.revoked_at ? "revoked" : sig ? sig.status : d.download_count ? `downloaded ${d.download_count}×` : d.first_opened_at ? "opened" : "sent";
                  return (
                    <tr key={d.id}>
                      <td>{when(d.created_at)}{d.is_test ? " (test)" : ""}</td>
                      <td>{d.recipient_name ?? d.recipient_email}<small className="monarch-subcell">{d.recipient_email}</small></td>
                      <td>{d.kind === "signature" ? "To sign" : "To read"}</td>
                      <td>{label(status)}{sig?.signed_at && <small className="monarch-subcell">signed {when(sig.signed_at)} as {sig.signed_name}</small>}{sig?.decline_reason && <small className="monarch-subcell">reason: {sig.decline_reason}</small>}</td>
                      <td>
                        <a href={`/documents/file?type=delivery&id=${d.id}`}>As sent</a>
                        {sig?.signed_storage_path && <> · <a href={`/documents/file?type=signed&id=${sig.id}`}>Signed copy</a></>}
                      </td>
                      <td>{!d.revoked_at && (!sig || sig.status === "sent" || sig.status === "viewed") && (
                        <form action={revokeDeliveryAction}><input type="hidden" name="document_id" value={doc.id} /><input type="hidden" name="delivery_id" value={d.id} /><button className="monarch-secondary is-danger">{sig ? "Void" : "Revoke link"}</button></form>
                      )}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          </section>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>History</h2></div></div>
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>WHEN</th><th>WHAT</th></tr></thead>
              <tbody>{events.length === 0 ? <tr><td colSpan={2} className="monarch-empty">Nothing yet.</td></tr> : events.map((e) => <tr key={e.id}><td>{when(e.created_at)}</td><td>{label(e.type)}</td></tr>)}</tbody>
            </table></div>
          </section>
        </>
      )}

      {tab === "file" && (
        <>
          <section className="monarch-panel" style={{ padding: 20 }}>
            <h2>Current version</h2>
            {current ? (
              <>
                <p>
                  <b>{current.file_name}</b> · {kb(current.size_bytes)} · version {current.version} · uploaded {when(current.ready_at)}
                </p>
                <p style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {VIEWABLE_TYPES.includes(doc.file_type) && <a className="monarch-primary" href={`/documents/file?type=version&id=${current.id}&view=1`} target="_blank" rel="noreferrer">Open</a>}
                  <a className="monarch-secondary" href={`/documents/file?type=version&id=${current.id}`}>Download</a>
                  {current.merge_fields.length > 0 && <a className="monarch-secondary" href={`/documents/${doc.id}/preview`} target="_blank" rel="noreferrer">Preview with sample data</a>}
                </p>
                {(doc.file_type === "pdf" || doc.file_type === "docx") && <h3>Merge fields</h3>}
                {doc.file_type !== "pdf" && doc.file_type !== "docx" ? null : current.merge_fields.length ? (
                  <ul>{current.merge_fields.map((f) => <li key={f}><code>{f}</code> {MERGE_FIELDS[f]?.label ?? (f.startsWith("form.") ? "The answer to this form question (workflows that start on a form submission)" : "")}</li>)}</ul>
                ) : <p className="monarch-muted">None: this document is sent exactly as uploaded.</p>}
                {canSign && <p className="monarch-muted">{current.has_signature_field ? "The signature goes in the form field named “signature”." : "No form field named “signature”: the signature is placed on the signing certificate page."}</p>}
              </>
            ) : <p className="monarch-muted">No file has been accepted yet. Upload one below.</p>}
            {doc.status === "active" && <><h3>Upload a new version</h3><DocumentUploader documentId={doc.id} accept={`.${doc.file_type}${doc.file_type === "jpg" ? ",.jpeg" : ""}`} /><p className="monarch-muted">Copies already sent keep the version they used.</p></>}
          </section>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>Versions</h2></div></div>
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>VERSION</th><th>FILE</th><th>STATUS</th><th>UPLOADED</th></tr></thead>
              <tbody>{versions.map((v) => (
                <tr key={v.id}>
                  <td>v{v.version}{v.id === doc.current_version_id ? " (current)" : ""}</td>
                  <td>{v.status === "ready" ? <a href={`/documents/file?type=version&id=${v.id}`}>{v.file_name}</a> : v.file_name}</td>
                  <td><Badge value={v.status} /></td>
                  <td>{when(v.created_at)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </section>
        </>
      )}

      {tab === "settings" && (
        <>
          <section className="monarch-panel" style={{ padding: 20 }}>
            <h2>Details</h2>
            <form action={saveDocumentDetailsAction} className="monarch-form">
              <input type="hidden" name="id" value={doc.id} />
              <label>Name<input name="name" required maxLength={120} defaultValue={doc.name} /></label>
              <label className="is-wide">Description (optional)<input name="description" maxLength={1000} defaultValue={doc.description ?? ""} /></label>
              <div className="is-wide"><button className="monarch-primary">Save</button></div>
            </form>
            {paths.length > 0 && (
              <form action={moveDocumentAction} className="monarch-form" style={{ marginTop: 14 }}>
                <input type="hidden" name="id" value={doc.id} /><input type="hidden" name="back" value={`/documents/${doc.id}?tab=settings`} />
                <label>Folder
                  <select name="to" defaultValue={doc.folder_id ?? ""}>
                    <option value="">No folder</option>
                    {paths.map((p) => <option key={p.id} value={p.id}>{p.path}</option>)}
                  </select>
                </label>
                <div className="is-wide"><button className="monarch-secondary">Move</button></div>
              </form>
            )}
          </section>
          {canSign && (
            <section className="monarch-panel" style={{ padding: 20 }}>
              <h2>Signing consent</h2>
              <p className="monarch-muted">What the signer agrees to, with a checkbox, before signing. Write it in your own words.</p>
              <form action={saveConsentAction} className="monarch-form">
                <input type="hidden" name="id" value={doc.id} />
                <label className="is-wide">Consent statement<textarea name="consent" rows={6} maxLength={5000} defaultValue={doc.signature_consent ?? ""} placeholder="Required before this document can be sent to sign." /></label>
                <div className="is-wide"><button className="monarch-primary">Save consent statement</button></div>
              </form>
            </section>
          )}
          <ArchivePanel entity="document" id={doc.id} />
        </>
      )}
    </>
  );
}
