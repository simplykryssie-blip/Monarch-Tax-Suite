import Link from "next/link";
import { clearSsnAction, saveSsnAction, sendSignatureAction, cancelRequestAction, invitePortalAction, openStaffDocAction, requestDocAction, setPortalAccessAction, shareDocAction, withdrawPortalAction } from "@/app/portal-staff-actions";
import { documentDeps } from "@/lib/documents/server";
import { askFieldsFor } from "@/lib/portal/signing.ts";
import { portalMemberRepo, portalStaffRepo } from "@/lib/portal/server";
import { ssnDeps } from "@/lib/ssn/server";
import { hasStoredSsn } from "@/lib/ssn/service.ts";

type Area = "admin" | "office" | "practice";

/** The "Client portal" panel on a client's page: invite, resend, withdraw, turn access off or on. */
export async function PortalPanel({ area, tenantId, clientId, email, signDocId, backHref }: { area: Area; tenantId: string; clientId: string; email: string | null; /** The library document chosen for signing (admin workspace). */ signDocId?: string; backHref?: string }) {
  const [member, requests, docs] = await Promise.all([
    portalMemberRepo(tenantId).getForClient(clientId).catch(() => null),
    portalStaffRepo(tenantId).listRequests(clientId).catch(() => []),
    portalStaffRepo(tenantId).listDocs(clientId).catch(() => []),
  ]);
  const signing = area === "admin" ? await signingChoices(tenantId, clientId, signDocId) : null;
  const hidden = (<><input type="hidden" name="area" value={area} /><input type="hidden" name="client_id" value={clientId} /></>);
  const when = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(iso)) : "");
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
      <>
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Send a form to sign</h2>
          {signing.docs.length === 0 ? (
            <p className="monarch-muted">No signable documents yet. In Documents, upload a PDF (Form 8879, Form 8821, an engagement letter), name its form fields after the merge fields, and add its signing consent statement.</p>
          ) : (
            <>
              <form method="get" action={backHref} className="monarch-form">
                <input type="hidden" name="tab" value="portal" />
                <label>Document<select name="sign" defaultValue={signDocId ?? ""}><option value="">Choose a document…</option>{signing.docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
                <div className="is-wide"><button className="monarch-secondary">Continue</button></div>
              </form>
              {signing.chosen && (
                <form action={sendSignatureAction} className="monarch-form" style={{ marginTop: 14 }}>
                  {hidden}
                  <input type="hidden" name="document_id" value={signing.chosen.id} />
                  <p className="is-wide">Filled in automatically from the client&apos;s record and your firm profile. {signing.chosen.needsSsn ? (signing.ssnOnFile ? "The client's Social Security number is filled from the encrypted copy." : "This form needs the client's Social Security number: add it under Tax ID below first.") : ""}</p>
                  {signing.asks.map((a) => <label key={a.name} className="is-wide">{a.label} *<input name={a.name} required maxLength={300} /></label>)}
                  <label className="is-wide">Message to the client (optional)<input name="message" maxLength={1000} /></label>
                  <div className="is-wide"><button className="monarch-primary" disabled={!email || (signing.chosen.needsSsn && !signing.ssnOnFile)}>Send to {email ?? "the client"}</button></div>
                </form>
              )}
              {signing.error && <p className="monarch-alert is-error" role="alert">{signing.error}</p>}
            </>
          )}
        </section>
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Tax ID</h2>
          <p>{signing.ssnOnFile ? "A full Social Security number is on file, encrypted." : "No full Social Security number on file."} It is used only to fill IRS forms you send, and every use is recorded. The portal and exports show the last four digits only.</p>
          <form action={saveSsnAction} className="monarch-form" autoComplete="off">
            {hidden}
            <label>{signing.ssnOnFile ? "Replace with" : "Social Security number"}<input name="ssn" type="password" inputMode="numeric" autoComplete="off" maxLength={11} placeholder="9 digits" /></label>
            <div className="is-wide"><button className="monarch-secondary">{signing.ssnOnFile ? "Replace" : "Save"}</button></div>
          </form>
          {signing.ssnOnFile && <form action={clearSsnAction} style={{ marginTop: 8 }}>{hidden}<button className="monarch-link is-danger">Remove the stored number</button></form>}
          <p className="monarch-muted" style={{ marginTop: 10 }}>Signed forms the client has returned are in <Link href="/documents">Documents</Link>.</p>
        </section>
      </>
    )}
    </>
  );
}

async function signingChoices(tenantId: string, clientId: string, signDocId?: string) {
  const docs = documentDeps(tenantId);
  const all = await docs.repo.listDocuments().catch(() => []);
  const signable = all.filter((d) => d.status === "active" && d.file_type === "pdf" && d.current_version_id && d.signature_consent);
  const ssnOnFile = await hasStoredSsn(ssnDeps(tenantId), clientId).catch(() => false);
  const doc = signDocId ? signable.find((d) => d.id === signDocId) ?? null : null;
  let chosen: { id: string; needsSsn: boolean } | null = null;
  let asks: { name: string; label: string }[] = [];
  let error: string | null = null;
  if (doc) {
    try {
      asks = await askFieldsFor(docs, doc.id);
      const version = await docs.repo.getVersion(doc.current_version_id!);
      chosen = { id: doc.id, needsSsn: Boolean(version?.merge_fields.includes("client_ssn")) };
    } catch (e) {
      error = e instanceof Error ? e.message : "That document can't be sent.";
    }
  }
  return { docs: signable, chosen, asks, ssnOnFile, error };
}
