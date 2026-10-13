import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { automationDeps } from "@/lib/automation/server";
import { senderAddress } from "@/lib/automation/senders.ts";
import { documentDeps } from "@/lib/documents/server";
import { MERGE_FIELDS } from "@/lib/documents/fields.ts";
import { Badge, Flash, label, PageTitle, when } from "@/components/admin/ui";
import { DocumentUploader } from "@/components/admin/document-uploader";
import { removeDocumentAction, restoreDocumentAction, revokeDeliveryAction, saveConsentAction, saveDocumentDetailsAction, sendManualAction } from "../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

export default async function DocumentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const { notice, error } = await searchParams;
  if (!UUID.test(id)) notFound();
  const deps = documentDeps();
  const doc = await deps.repo.getDocument(id);
  if (!doc) notFound();
  const auto = automationDeps();
  const [versions, deliveries, signatures, events, customers, orders, senders, domains] = await Promise.all([
    deps.repo.listVersions(id), deps.repo.listDeliveries(id, 100), deps.repo.listSignatures(id, 100), deps.repo.listEvents(id, 50),
    auto.commerce.listCustomers(), auto.commerce.listOrders(), auto.senders?.listSenders().catch(() => []) ?? [], auto.senders?.listDomains().catch(() => []) ?? [],
  ]);
  const current = versions.find((v) => v.id === doc.current_version_id) ?? null;
  const sigByDelivery = new Map(signatures.map((s) => [s.delivery_id, s]));
  const verifiedDomains = new Map(domains.filter((d) => d.status === "verified").map((d) => [d.id, d]));
  const usableSenders = senders.filter((s) => !s.archived_at && verifiedDomains.has(s.domain_id));
  const canSign = doc.file_type === "pdf";

  return (
    <>
      <PageTitle title={doc.name} back={{ href: "/documents", label: "Documents" }}>
        {doc.file_type.toUpperCase()} · <Badge value={doc.status} /> · {current ? `version ${current.version}` : "no file yet"}
      </PageTitle>
      <Flash notice={notice} error={error} />

      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2>Current version</h2>
        {current ? (
          <>
            <p>
              <b>{current.file_name}</b> · {kb(current.size_bytes)} · uploaded {when(current.ready_at)}
              <small className="monarch-subcell">SHA-256 {current.sha256}</small>
            </p>
            <p style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <a className="monarch-secondary" href={`/documents/file?type=version&id=${current.id}`}>Download original</a>
              <a className="monarch-secondary" href={`/documents/${doc.id}/preview`} target="_blank" rel="noreferrer">Preview with sample data</a>
            </p>
            <h3>Merge fields</h3>
            {current.merge_fields.length ? (
              <ul>{current.merge_fields.map((f) => <li key={f}><code>{f}</code> {MERGE_FIELDS[f]?.label}</li>)}</ul>
            ) : <p className="monarch-muted">None: this document is sent exactly as uploaded.</p>}
            {canSign && <p className="monarch-muted">{current.has_signature_field ? "The signature goes in the form field named “signature”." : "No form field named “signature”: the signature is placed on the signing certificate page."}</p>}
          </>
        ) : <p className="monarch-muted">No file has been accepted yet. Upload one below.</p>}
        {doc.status === "active" && <><h3>Upload a new version</h3><DocumentUploader documentId={doc.id} accept={`.${doc.file_type}`} /><p className="monarch-muted">Copies already sent keep the version they used.</p></>}
      </section>

      {canSign && (
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2>Signing consent</h2>
          <p className="monarch-muted">The statement the signer must agree to (with a checkbox) before signing. Write it in your own words. Each signature request keeps the exact text its signer saw, and it is printed on the signing certificate.</p>
          <form action={saveConsentAction} className="monarch-form">
            <input type="hidden" name="id" value={doc.id} />
            <label className="is-wide">Consent statement<textarea name="consent" rows={6} maxLength={5000} defaultValue={doc.signature_consent ?? ""} placeholder="Required before this document can be sent for signature." /></label>
            <div className="is-wide"><button className="monarch-primary">Save consent statement</button></div>
          </form>
        </section>
      )}

      {doc.status === "active" && current && (
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2>Send to a customer</h2>
          <form action={sendManualAction} className="monarch-form">
            <input type="hidden" name="id" value={doc.id} />
            <label>Customer
              <select name="customer_id" required defaultValue="">
                <option value="" disabled>Choose…</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.full_name ?? c.email} ({c.email})</option>)}
              </select>
            </label>
            <label>Order (optional, for order and product fields)
              <select name="order_id" defaultValue="">
                <option value="">None</option>
                {orders.map((o) => <option key={o.id} value={o.id}>#{o.order_number}</option>)}
              </select>
            </label>
            <label>Send as
              <select name="kind" defaultValue="send">
                <option value="send">A document to view and download</option>
                {canSign && <option value="signature" disabled={!doc.signature_consent}>A signature request{doc.signature_consent ? "" : " (add a consent statement first)"}</option>}
              </select>
            </label>
            <label>From
              <select name="sender_id" defaultValue="">
                <option value="">Default sending address</option>
                {usableSenders.map((s) => <option key={s.id} value={s.id}>{s.from_name} &lt;{senderAddress(s, verifiedDomains.get(s.domain_id)!)}&gt;</option>)}
              </select>
            </label>
            <label>Link works for (days)<input name="link_days" type="number" min={1} max={60} defaultValue={14} /></label>
            <label>Signature reminders every (days, blank = off)<input name="reminder_days" type="number" min={1} max={30} /></label>
            <label className="is-wide">Message (optional)<textarea name="message" rows={3} maxLength={1000} /></label>
            <div className="is-wide"><button className="monarch-primary">Send</button></div>
          </form>
        </section>
      )}

      <section className="monarch-panel">
        <div className="monarch-panel-head"><div><h2>Sent copies</h2></div></div>
        <div className="monarch-table-wrap"><table>
          <thead><tr><th>SENT</th><th>TO</th><th>KIND</th><th>VERSION</th><th>STATUS</th><th>COPY</th><th></th></tr></thead>
          <tbody>
            {deliveries.length === 0 ? <tr><td colSpan={7} className="monarch-empty">Not sent yet.</td></tr> : deliveries.map((d) => {
              const sig = sigByDelivery.get(d.id);
              const v = versions.find((x) => x.id === d.version_id);
              const status = d.revoked_at ? "revoked" : sig ? sig.status : d.download_count ? `downloaded ${d.download_count}×` : d.first_opened_at ? "opened" : "sent";
              return (
                <tr key={d.id}>
                  <td>{when(d.created_at)}{d.is_test ? " (test)" : ""}</td>
                  <td>{d.recipient_name ?? d.recipient_email}<small className="monarch-subcell">{d.recipient_email}</small></td>
                  <td>{d.kind === "signature" ? "Signature" : "Document"}</td>
                  <td>{v ? `v${v.version}` : "—"}</td>
                  <td>{label(status)}{sig?.signed_at && <small className="monarch-subcell">signed {when(sig.signed_at)} as {sig.signed_name}</small>}{sig?.decline_reason && <small className="monarch-subcell">reason: {sig.decline_reason}</small>}</td>
                  <td>
                    <a href={`/documents/file?type=delivery&id=${d.id}`}>As sent</a>
                    {sig?.signed_storage_path && <> · <a href={`/documents/file?type=signed&id=${sig.id}`}>Signed copy</a></>}
                    <small className="monarch-subcell" title={d.sha256}>SHA-256 {d.sha256.slice(0, 12)}…</small>
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

      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2>Details</h2>
        <form action={saveDocumentDetailsAction} className="monarch-form">
          <input type="hidden" name="id" value={doc.id} />
          <label>Name<input name="name" required maxLength={120} defaultValue={doc.name} /></label>
          <label className="is-wide">Description (optional)<input name="description" maxLength={1000} defaultValue={doc.description ?? ""} /></label>
          <div className="is-wide"><button className="monarch-secondary">Save</button></div>
        </form>
      </section>

      <section className="monarch-panel">
        <div className="monarch-panel-head"><div><h2>Versions</h2></div></div>
        <div className="monarch-table-wrap"><table>
          <thead><tr><th>VERSION</th><th>FILE</th><th>STATUS</th><th>MERGE FIELDS</th><th>UPLOADED</th></tr></thead>
          <tbody>{versions.map((v) => (
            <tr key={v.id}>
              <td>v{v.version}{v.id === doc.current_version_id ? " (current)" : ""}</td>
              <td>{v.status === "ready" ? <a href={`/documents/file?type=version&id=${v.id}`}>{v.file_name}</a> : v.file_name}</td>
              <td><Badge value={v.status} /></td>
              <td>{v.merge_fields.join(", ") || "—"}</td>
              <td>{when(v.created_at)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>

      <section className="monarch-panel">
        <div className="monarch-panel-head"><div><h2>History</h2></div></div>
        <div className="monarch-table-wrap"><table>
          <thead><tr><th>WHEN</th><th>WHAT</th></tr></thead>
          <tbody>{events.length === 0 ? <tr><td colSpan={2} className="monarch-empty">Nothing yet.</td></tr> : events.map((e) => <tr key={e.id}><td>{when(e.created_at)}</td><td>{label(e.type)}</td></tr>)}</tbody>
        </table></div>
      </section>

      <section className="monarch-panel" style={{ padding: 20 }}>
        {doc.status === "active" ? (
          <>
            <h2>Remove this document</h2>
            <p className="monarch-muted">A document that was never sent is deleted. One that was sent is archived so its sent and signed copies stay on record.</p>
            <form action={removeDocumentAction}><input type="hidden" name="id" value={doc.id} /><button className="monarch-secondary is-danger">{deliveries.length ? "Archive" : "Delete"}</button></form>
          </>
        ) : (
          <form action={restoreDocumentAction}><input type="hidden" name="id" value={doc.id} /><button className="monarch-primary">Restore</button></form>
        )}
      </section>
    </>
  );
}
