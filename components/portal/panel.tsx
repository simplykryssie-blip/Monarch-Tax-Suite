import { sendDocumentAction, cancelRequestAction, invitePortalAction, openStaffDocAction, requestDocAction, setPortalAccessAction, shareDocAction, withdrawPortalAction } from "@/app/portal-staff-actions";
import { Modal } from "@/components/ui/modal";
import { documentDeps } from "@/lib/documents/server";
import { folderPaths } from "@/lib/documents/folders.ts";
import { askFieldsFor } from "@/lib/portal/signing.ts";
import { portalMemberRepo, portalStaffRepo } from "@/lib/portal/server";
import { ssnDeps } from "@/lib/ssn/server";
import { hasStoredSsn } from "@/lib/ssn/service.ts";

type Area = "admin" | "office" | "practice";

/** The "Client portal" panel on a client's page: invite, resend, withdraw, turn access off or on. */
export async function PortalPanel({ area, tenantId, clientId, email, signDocId, backHref, mode = "all", part = "both", extraActions, tab = "portal" }: { area: Area; tenantId: string; clientId: string; email: string | null; /** The library document chosen for signing (admin workspace). */ signDocId?: string; backHref?: string; /** "documents": the layout used inside a client's Documents tab (buttons at the top, lists below). */ mode?: "all" | "documents"; /** In the documents layout: only the buttons, only the lists, or both. */ part?: "actions" | "lists" | "both"; /** More buttons to put first in the row. */ extraActions?: React.ReactNode; /** The tab the signing chooser comes back to. */ tab?: string }) {
  const [member, requests, docs] = await Promise.all([
    portalMemberRepo(tenantId).getForClient(clientId).catch(() => null),
    portalStaffRepo(tenantId).listRequests(clientId).catch(() => []),
    portalStaffRepo(tenantId).listDocs(clientId).catch(() => []),
  ]);
  const signing = area === "admin" ? await signingChoices(tenantId, clientId, signDocId) : null;
  const hidden = (<><input type="hidden" name="area" value={area} /><input type="hidden" name="client_id" value={clientId} /></>);
  const when = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(iso)) : "");
  if (mode === "documents") {
    const actions = (
        <div className="cl-head-actions">
          {extraActions}
          <Modal label="Ask for a document" title="Ask for a document" className="monarch-secondary">
      <form action={requestDocAction} className="monarch-form">
        {hidden}
        <label>What do you need? *<input name="title" required maxLength={200} placeholder="For example 2025 W-2" /></label>
        <label>Send by (optional)<input name="due_on" type="date" /></label>
        <label className="is-wide">Note to the client (optional)<input name="note" maxLength={1000} /></label>
        <div className="is-wide"><button className="monarch-primary">Add request</button></div>
      </form>
          </Modal>
          {signing && (
            <Modal label="Send a document" title="Send a document" className="monarch-primary" defaultOpen={Boolean(signDocId)}>
              <SendDocumentForm signing={signing} signDocId={signDocId} backHref={backHref} tab={tab} email={email} hidden={hidden} />
            </Modal>
          )}
        </div>
    );
    if (part === "actions") return actions;
    const lists = (
      <>
        {member && (
    <section className="monarch-panel" style={{ padding: 20 }}>
      <h2 style={{ marginTop: 0 }}>Client portal</h2>
      {!member && (
        <>
          <p className="monarch-muted">Invite this client to a secure portal where they can see their return status and messages{email ? "" : ". Add their email address first, since the invite is sent there"}.</p>
          <form action={invitePortalAction}>{hidden}<button className="monarch-primary" disabled={!email}>Invite to portal</button></form>
        </>
      )}
      {member && member.status === "invited" && (
        <>
          <p>Invite sent to <b>{member.email}</b>; the link works until {when(member.invite_expires_at)}. They haven&apos;t opened it yet.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <form action={invitePortalAction}>{hidden}<button className="monarch-secondary">Send a new link</button></form>
            <form action={withdrawPortalAction}>{hidden}<button className="monarch-secondary">Withdraw invite</button></form>
          </div>
        </>
      )}
      {member && member.status === "active" && (
        <>
          <p>Portal access is <b>on</b> for {member.email}{member.accepted_at ? `, since ${when(member.accepted_at)}` : ""}{member.last_seen_at ? `. Last seen ${when(member.last_seen_at)}.` : "."}</p>
          <form action={setPortalAccessAction}>{hidden}<input type="hidden" name="enabled" value="0" /><button className="monarch-secondary">Turn access off</button></form>
        </>
      )}
      {member && member.status === "suspended" && (
        <>
          <p>{member.user_id ? "Portal access is off." : "The invite was withdrawn."}</p>
          {member.user_id
            ? <form action={setPortalAccessAction}>{hidden}<input type="hidden" name="enabled" value="1" /><button className="monarch-secondary">Turn access on</button></form>
            : <form action={invitePortalAction}>{hidden}<button className="monarch-secondary">Send a new invite</button></form>}
        </>
      )}
    </section>
        )}
        {requests.length > 0 && (
          <section className="monarch-panel" style={{ padding: 20 }}>
            <h2 style={{ marginTop: 0 }}>Documents we asked for</h2>
        <ul className="portal-list" style={{ marginTop: 14 }}>
          {requests.map((r) => (
            <li key={r.id}>
              <b>{r.title}</b> <span className="monarch-muted">· {r.status === "received" ? `received ${when(r.received_at)}` : "waiting for the client"}{r.due_on ? ` · by ${r.due_on}` : ""}</span>
              {r.status === "open" && <form action={cancelRequestAction}>{hidden}<input type="hidden" name="request_id" value={r.id} /><button className="monarch-link">Cancel request</button></form>}
            </li>
          ))}
        </ul>
          </section>
        )}
      </>
    );
    if (part === "lists") return lists;
    return <>{actions}{lists}</>;
  }

  return (
    <>
    <section className="monarch-panel" style={{ padding: 20 }}>
      <h2 style={{ marginTop: 0 }}>Client portal</h2>
      {!member && (
        <>
          <p className="monarch-muted">Invite this client to a secure portal where they can see their return status and messages{email ? "" : ". Add their email address first, since the invite is sent there"}.</p>
          <form action={invitePortalAction}>{hidden}<button className="monarch-primary" disabled={!email}>Invite to portal</button></form>
        </>
      )}
      {member && member.status === "invited" && (
        <>
          <p>Invite sent to <b>{member.email}</b>; the link works until {when(member.invite_expires_at)}. They haven&apos;t opened it yet.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <form action={invitePortalAction}>{hidden}<button className="monarch-secondary">Send a new link</button></form>
            <form action={withdrawPortalAction}>{hidden}<button className="monarch-secondary">Withdraw invite</button></form>
          </div>
        </>
      )}
      {member && member.status === "active" && (
        <>
          <p>Portal access is <b>on</b> for {member.email}{member.accepted_at ? `, since ${when(member.accepted_at)}` : ""}{member.last_seen_at ? `. Last seen ${when(member.last_seen_at)}.` : "."}</p>
          <form action={setPortalAccessAction}>{hidden}<input type="hidden" name="enabled" value="0" /><button className="monarch-secondary">Turn access off</button></form>
        </>
      )}
      {member && member.status === "suspended" && (
        <>
          <p>{member.user_id ? "Portal access is off." : "The invite was withdrawn."}</p>
          {member.user_id
            ? <form action={setPortalAccessAction}>{hidden}<input type="hidden" name="enabled" value="1" /><button className="monarch-secondary">Turn access on</button></form>
            : <form action={invitePortalAction}>{hidden}<button className="monarch-secondary">Send a new invite</button></form>}
        </>
      )}
    </section>
    <section className="monarch-panel" style={{ padding: 20 }}>
      <h2 style={{ marginTop: 0 }}>Ask for a document</h2>
      <form action={requestDocAction} className="monarch-form">
        {hidden}
        <label>What do you need? *<input name="title" required maxLength={200} placeholder="For example 2025 W-2" /></label>
        <label>Send by (optional)<input name="due_on" type="date" /></label>
        <label className="is-wide">Note to the client (optional)<input name="note" maxLength={1000} /></label>
        <div className="is-wide"><button className="monarch-primary">Add request</button></div>
      </form>
      {requests.length > 0 && (
        <ul className="portal-list" style={{ marginTop: 14 }}>
          {requests.map((r) => (
            <li key={r.id}>
              <b>{r.title}</b> <span className="monarch-muted">· {r.status === "received" ? `received ${when(r.received_at)}` : "waiting for the client"}{r.due_on ? ` · by ${r.due_on}` : ""}</span>
              {r.status === "open" && <form action={cancelRequestAction}>{hidden}<input type="hidden" name="request_id" value={r.id} /><button className="monarch-link">Cancel request</button></form>}
            </li>
          ))}
        </ul>
      )}
    </section>
    <section className="monarch-panel" style={{ padding: 20 }}>
      <h2 style={{ marginTop: 0 }}>What the client can see</h2>
      <p className="monarch-muted">Nothing is shown in the portal until you share it. A client&apos;s own uploads always show to them.</p>
      {docs.length === 0 ? <p className="monarch-muted">No documents on this client yet.</p> : (
        <ul className="portal-list">
          {docs.map((d) => (
            <li key={d.id}>
              <b>{d.title}</b> <span className="monarch-muted">· {d.source === "client" ? "uploaded by the client" : d.shared_with_client ? "shared" : "not shared"} · {d.file_type.toUpperCase()} · {when(d.created_at)}</span>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <form action={openStaffDocAction}>{hidden}<input type="hidden" name="doc_id" value={d.id} /><button className="monarch-link">Download</button></form>
                {d.source === "staff" && <form action={shareDocAction}>{hidden}<input type="hidden" name="doc_id" value={d.id} /><input type="hidden" name="shared" value={d.shared_with_client ? "0" : "1"} /><button className="monarch-link">{d.shared_with_client ? "Hide from client" : "Share with client"}</button></form>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
    {signing && (
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Send a document</h2>
        <SendDocumentForm signing={signing} signDocId={signDocId} backHref={backHref} tab={tab} email={email} hidden={hidden} />
      </section>
    )}
    </>
  );
}

type Choices = Awaited<ReturnType<typeof signingChoices>>;

/** Pick a document from the library (grouped by folder), then say how to send it. */
function SendDocumentForm({ signing, signDocId, backHref, tab, email, hidden }: { signing: Choices; signDocId?: string; backHref?: string; tab: string; email: string | null; hidden: React.ReactNode }) {
  if (signing.docs.length === 0) return <p className="monarch-muted">No documents in your library yet. Add one under Documents first.</p>;
  const groups = [...new Set(signing.docs.map((d) => d.folder))].sort((a, b) => a.localeCompare(b));
  return (
    <>
      <form method="get" action={backHref} className="monarch-form">
        <input type="hidden" name="tab" value={tab} />
        <label className="is-wide">Document
          <select name="sign" defaultValue={signDocId ?? ""}>
            <option value="">Choose a document…</option>
            {groups.map((g) => (
              <optgroup key={g || "none"} label={g || "Not in a folder"}>
                {signing.docs.filter((d) => d.folder === g).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="is-wide"><button className="monarch-secondary">Continue</button></div>
      </form>
      {signing.chosen && (
        <form action={sendDocumentAction} className="monarch-form" style={{ marginTop: 14 }}>
          {hidden}
          <input type="hidden" name="document_id" value={signing.chosen.id} />
          <label className="is-wide">Send it
            <select name="kind" defaultValue="send">
              <option value="send">To read and download</option>
              {signing.chosen.canSign && <option value="signature">To sign</option>}
            </select>
          </label>
          {signing.chosen.needsSsn && <p className="is-wide">{signing.ssnOnFile ? "The client's Social Security number is filled from the encrypted copy." : "This form needs the client's Social Security number: add it on the client's Overview first."}</p>}
          {signing.asks.map((a) => <label key={a.name} className="is-wide">{a.label} *<input name={a.name} required maxLength={300} /></label>)}
          <label className="is-wide">Message to the client (optional)<input name="message" maxLength={1000} /></label>
          <div className="is-wide"><button className="monarch-primary" disabled={!email || (signing.chosen.needsSsn && !signing.ssnOnFile)}>Send to {email ?? "the client"}</button></div>
        </form>
      )}
      {signing.error && <p className="monarch-alert is-error" role="alert">{signing.error}</p>}
    </>
  );
}

async function signingChoices(tenantId: string, clientId: string, signDocId?: string) {
  const docs = documentDeps(tenantId);
  const [all, folders] = await Promise.all([docs.repo.listDocuments().catch(() => []), docs.repo.listFolders().catch(() => [])]);
  const paths = new Map(folderPaths(folders).map((f) => [f.id, f.path]));
  const sendable = all.filter((d) => d.status === "active" && d.current_version_id).map((d) => ({ id: d.id, name: d.name, folder: d.folder_id ? paths.get(d.folder_id) ?? "" : "", canSign: d.file_type === "pdf" && Boolean(d.signature_consent) }));
  const ssnOnFile = await hasStoredSsn(ssnDeps(tenantId), clientId).catch(() => false);
  const doc = signDocId ? sendable.find((d) => d.id === signDocId) ?? null : null;
  let chosen: { id: string; needsSsn: boolean; canSign: boolean } | null = null;
  let asks: { name: string; label: string }[] = [];
  let error: string | null = null;
  if (doc) {
    try {
      asks = await askFieldsFor(docs, doc.id, "send");
      const version = await docs.repo.getVersion((await docs.repo.getDocument(doc.id))!.current_version_id!);
      chosen = { id: doc.id, needsSsn: Boolean(version?.merge_fields.includes("client_ssn")), canSign: doc.canSign };
    } catch (e) {
      error = e instanceof Error ? e.message : "That document can't be sent.";
    }
  }
  return { docs: sendable, chosen, asks, ssnOnFile, error };
}
