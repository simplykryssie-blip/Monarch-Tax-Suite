import Link from "next/link";
import { clientFolderName } from "@/lib/documents/folders.ts";
import { workspaceRepo } from "@/lib/workspace/server";

/** The Clients folder: one folder per client, named with their name and the last four of their SSN. */
export async function ClientsList({ q }: { q: string }) {
  const clients = (await workspaceRepo().listClients({ includeArchived: false, q: q || undefined })).slice(0, 300);
  return (
    <>
      <div className="monarch-page-actions">
        <nav className="pl-crumbs" aria-label="Folder"><Link href="/documents">All documents</Link> / <b>Clients</b></nav>
        <form method="get" action="/documents" role="search"><input type="hidden" name="clients" value="1" /><input name="q" defaultValue={q} placeholder="Find a client" aria-label="Find a client" maxLength={80} /></form>
      </div>
      {clients.length === 0 ? <p className="monarch-muted">{q ? "No client matches that." : "No clients yet."}</p> : (
        <div className="pl-grid">
          {clients.map((c) => (
            <section key={c.id} className="monarch-panel pl-card pl-folder">
              <Link className="pl-name" href={`/documents?client=${c.id}`}>{clientFolderName(c)}</Link>
              {c.email && <small className="monarch-muted">{c.email}</small>}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
