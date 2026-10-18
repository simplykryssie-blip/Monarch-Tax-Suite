import { invitePortalAction, setPortalAccessAction, withdrawPortalAction } from "@/app/portal-staff-actions";
import { portalMemberRepo } from "@/lib/portal/server";

type Area = "admin" | "office" | "practice";

/** The "Client portal" panel on a client's page: invite, resend, withdraw, turn access off or on. */
export async function PortalPanel({ area, tenantId, clientId, email }: { area: Area; tenantId: string; clientId: string; email: string | null }) {
  const member = await portalMemberRepo(tenantId).getForClient(clientId).catch(() => null);
  const hidden = (<><input type="hidden" name="area" value={area} /><input type="hidden" name="client_id" value={clientId} /></>);
  const when = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(iso)) : "");
  return (
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
  );
}
