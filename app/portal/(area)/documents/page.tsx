import { PortalUpload } from "@/components/portal/upload";
import { Flash } from "@/components/admin/ui";
import { portalDocDeps, requirePortal } from "@/lib/portal/server";
import { openPortalDocAction } from "../../documents-actions";

export default async function PortalDocuments({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await searchParams;
  const ctx = await requirePortal();
  const { repo } = portalDocDeps(ctx.tenantId, ctx.clientId);
  const [docs, requests] = await Promise.all([repo.listVisibleDocs(), repo.listRequests("open")]);
  const day = (iso: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(iso));
  return (
    <>
      <h1 className="office-h1">Documents</h1>
      <Flash notice={sp.notice} error={sp.error} />
      {requests.length > 0 && (
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>{ctx.office.name} is asking for</h2>
          <ul className="portal-list">
            {requests.map((r) => (
              <li key={r.id}>
                <b>{r.title}</b>{r.due_on ? <span className="monarch-muted"> · please send by {r.due_on}</span> : null}
                {r.note && <p style={{ margin: "4px 0" }}>{r.note}</p>}
                <PortalUpload requestId={r.id} label="Choose your file" />
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Your documents</h2>
        {docs.length === 0 ? <p className="monarch-muted">Nothing here yet. Documents {ctx.office.name} shares with you, and files you upload, appear here.</p> : (
          <ul className="portal-list">
            {docs.map((d) => (
              <li key={d.id}>
                <b>{d.title}</b> <span className="monarch-muted">· {d.source === "client" ? "You uploaded" : `From ${ctx.office.name}`} · {d.file_type.toUpperCase()} · {day(d.created_at)}</span>
                <form action={openPortalDocAction}><input type="hidden" name="id" value={d.id} /><button className="monarch-link">Download</button></form>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Send a document</h2>
        <p className="monarch-muted">Upload anything your preparer needs. Files are kept in private storage and only your tax office can see them.</p>
        <PortalUpload />
      </section>
    </>
  );
}
