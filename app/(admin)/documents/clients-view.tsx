import Link from "next/link";
import { EmptyRow, when } from "@/components/admin/ui";
import { Modal } from "@/components/ui/modal";
import { ClientDocUpload } from "@/components/workspace/client-doc-upload";
import { portalStaffRepo } from "@/lib/portal/server";
import { workspaceRepo } from "@/lib/workspace/server";
import { deleteClientDocAction, openClientDocAction } from "../workspace/actions";
import { shareDocAction } from "@/app/portal-staff-actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The "Clients" folder: every client is a folder holding the same files as their Files tab. */
export async function ClientsFolder({ clientId, q }: { clientId?: string; q: string }) {
  const repo = workspaceRepo();
  if (clientId && UUID.test(clientId)) {
    const client = await repo.getClient(clientId);
    if (!client) return <p className="monarch-muted">That client wasn&apos;t found.</p>;
    const [docs, returns, staffDocs] = await Promise.all([repo.listDocs(clientId), repo.listReturns({ clientId }), portalStaffRepo(client.tenant_id).listDocs(clientId).catch(() => [])]);
    const shared = new Map(staffDocs.map((d) => [d.id, d]));
    return (
      <>
        <div className="monarch-page-actions">
          <nav className="pl-crumbs" aria-label="Folder">
            <Link href="/documents">All documents</Link> / <Link href="/documents?clients=1">Clients</Link> / <b>{client.full_name}</b>
          </nav>
          <span className="cl-card-actions">
            <Link className="monarch-secondary" href={`/workspace/clients/${client.id}?tab=documents`}>Open client</Link>
            <Modal label="Add a file" title={`Add a file for ${client.full_name}`} className="monarch-primary"><ClientDocUpload clientId={client.id} returns={returns.map((r) => ({ id: r.id, label: `${r.tax_year} ${r.kind === "original" ? "return" : r.kind}` }))} /></Modal>
          </span>
        </div>
        <section className="monarch-panel">
          <div className="monarch-table-wrap"><table>
            <thead><tr><th>NAME</th><th>FROM</th><th>PORTAL</th><th>ADDED</th><th /></tr></thead>
            <tbody>
              {docs.length === 0 ? <EmptyRow colSpan={5}>No files yet.</EmptyRow> : docs.map((d) => {
                const s = shared.get(d.id);
                return (
                  <tr key={d.id}>
                    <td><b>{d.title}</b><small className="monarch-subcell">{d.file_type.toUpperCase()}</small></td>
                    <td>{s?.source === "client" ? "The client" : "Your office"}</td>
                    <td>
                      {s?.source === "client" ? "Always visible"
                        : s ? <form action={shareDocAction}><input type="hidden" name="area" value="admin" /><input type="hidden" name="client_id" value={client.id} /><input type="hidden" name="doc_id" value={d.id} /><input type="hidden" name="shared" value={s.shared_with_client ? "0" : "1"} /><button className="monarch-link">{s.shared_with_client ? "Shared · Hide" : "Not shared · Share"}</button></form>
                        : "—"}
                    </td>
                    <td>{when(d.created_at)}</td>
                    <td className="cl-card-actions">
                      <form action={openClientDocAction}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="client_id" value={client.id} /><button className="monarch-link">Download</button></form>
                      <form action={deleteClientDocAction}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="client_id" value={client.id} /><button className="monarch-link is-danger">Delete</button></form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </section>
      </>
    );
  }
  const clients = (await repo.listClients({ includeArchived: false, q: q || undefined })).slice(0, 300);
  return (
    <>
      <div className="monarch-page-actions">
        <nav className="pl-crumbs" aria-label="Folder"><Link href="/documents">All documents</Link> / <b>Clients</b></nav>
        <form method="get" action="/documents" role="search"><input type="hidden" name="clients" value="1" /><input name="q" defaultValue={q} placeholder="Find a client" aria-label="Find a client" maxLength={80} /></form>
      </div>
      <div className="pl-grid">
        {clients.length === 0 ? <p className="monarch-muted">{q ? "No client matches that." : "No clients yet."}</p> : clients.map((c) => (
          <section key={c.id} className="monarch-panel pl-card pl-folder">
            <Link className="pl-name" href={`/documents?client=${c.id}`}>{c.full_name}</Link>
            {c.email && <small className="monarch-muted">{c.email}</small>}
          </section>
        ))}
      </div>
    </>
  );
}
