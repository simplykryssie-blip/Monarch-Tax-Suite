import { cancelRequestAction, invitePortalAction, openStaffDocAction, requestDocAction, setPortalAccessAction, shareDocAction, withdrawPortalAction } from "@/app/portal-staff-actions";
import { portalMemberRepo, portalStaffRepo } from "@/lib/portal/server";

type Area = "admin" | "office" | "practice";

/** The "Client portal" panel on a client's page: invite, resend, withdraw, turn access off or on. */
export async function PortalPanel({ area, tenantId, clientId, email }: { area: Area; tenantId: string; clientId: string; email: string | null }) {
  const [member, requests, docs] = await Promise.all([
    portalMemberRepo(tenantId).getForClient(clientId).catch(() => null),
    portalStaffRepo(tenantId).listRequests(clientId).catch(() => []),
    portalStaffRepo(tenantId).listDocs(clientId).catch(() => []),
  ]);
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
    </>
  );
}
