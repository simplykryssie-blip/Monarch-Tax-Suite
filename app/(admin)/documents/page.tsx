import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { documentDeps } from "@/lib/documents/server";
import { EmptyRow, Flash, load, PageTitle, SetupRequired, when } from "@/components/admin/ui";
import { DocumentUploader } from "@/components/admin/document-uploader";
import { ArchiveRowButton } from "@/components/admin/archive";
import { SubmitOnce } from "@/components/admin/submit-once";
import { Modal } from "@/components/ui/modal";
import { DragCard, DragRow, DropLink } from "@/components/ui/folder-dnd";
import { folderPaths } from "@/lib/documents/folders.ts";
import { inView, viewCounts, viewOf } from "@/lib/archive.ts";
import type { DocumentFolder } from "@/lib/documents/types.ts";
import { ClientDrive } from "./client-drive";
import { ClientsList } from "./clients-list";
import { createFolderAction, deleteFolderAction, moveByDragAction, moveDocumentAction, renameFolderAction } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The document library: folders, then the documents in the folder you're looking at. Everything else is on a document's own page. */
export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ view?: string; folder?: string; internal?: string; clients?: string; client?: string; q?: string; notice?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const view = viewOf(sp.view);
  const where = UUID.test(sp.client ?? "") ? "client" : sp.clients === "1" ? "clients" : sp.internal === "1" || sp.folder || sp.view || sp.q ? "internal" : "root";
  const q = (sp.q ?? "").trim().toLowerCase().slice(0, 80);
  const result = await load(async () => {
    const deps = documentDeps();
    const [documents, folders] = await Promise.all([deps.repo.listDocuments(), deps.repo.listFolders().catch(() => [] as DocumentFolder[])]);
    const sent = new Map(await Promise.all(documents.map(async (d) => [d.id, await deps.repo.countDeliveries(d.id)] as const)));
    return { documents, folders, sent };
  });
  const folders = result.ok ? result.data.folders : [];
  const current = UUID.test(sp.folder ?? "") ? folders.find((f) => f.id === sp.folder) ?? null : null;
  const crumbs: DocumentFolder[] = [];
  for (let c = current; c; c = c.parent_id ? folders.find((f) => f.id === c!.parent_id) ?? null : null) crumbs.unshift(c);
  const paths = folderPaths(folders);
  const here = current ? <input type="hidden" name="folder" value={current.id} /> : null;
  const all = result.ok ? result.data.documents : [];
  const searching = q.length > 0;
  const shown = inView(all, view).filter((d) => (searching ? `${d.name} ${d.description ?? ""}`.toLowerCase().includes(q) : (d.folder_id ?? null) === (current?.id ?? null)));
  const subfolders = searching || view === "archived" ? [] : folders.filter((f) => (f.parent_id ?? null) === (current?.id ?? null));
  const counts = viewCounts(all);
  return (
    <>
      <PageTitle title="Documents">Client files and your office&apos;s own documents, in folders.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? (
        <SetupRequired message={result.message} />
      ) : where === "client" ? (
        <ClientDrive clientId={sp.client!} folderId={sp.folder} base={`/documents?client=${sp.client}`} prefix={<><Link href="/documents">All documents</Link> / <Link href="/documents?clients=1">Clients</Link> / </>} />
      ) : where === "clients" ? (
        <ClientsList q={q} />
      ) : where === "root" ? (
        <div className="pl-grid">
          <section className="monarch-panel pl-card pl-folder"><Link className="pl-name" href="/documents?clients=1">Clients</Link><small className="monarch-muted">A folder for each client, named with their name and the last four of their SSN. What clients upload lands here too.</small></section>
          <section className="monarch-panel pl-card pl-folder"><Link className="pl-name" href="/documents?internal=1">Internal docs</Link><small className="monarch-muted">Your office&apos;s own files and folders.</small></section>
        </div>
      ) : (
        <>
          <div className="monarch-page-actions">
            <nav className="pl-crumbs" aria-label="Folder">
              <Link href="/documents">All documents</Link> / <DropLink scope="document" move={moveByDragAction} to={null} href="/documents?internal=1" current={!current && view === "current"}>Internal docs</DropLink>
              {crumbs.map((f) => <span key={f.id}> / <DropLink scope="document" move={moveByDragAction} to={f.id} href={`/documents?internal=1&folder=${f.id}`} current={f.id === current?.id}>{f.name}</DropLink></span>)}
              {counts.archived > 0 && <span> · <Link href={view === "archived" ? "/documents?internal=1" : "/documents?internal=1&view=archived"} aria-current={view === "archived" ? "page" : undefined}>{view === "archived" ? "Back to documents" : `Archived (${counts.archived})`}</Link></span>}
            </nav>
            <span className="cl-card-actions">
              <form method="get" action="/documents" role="search"><input type="hidden" name="internal" value="1" /><input name="q" defaultValue={sp.q ?? ""} placeholder="Search documents" aria-label="Search documents" maxLength={80} /></form>
              <Modal label="New folder" title="New folder" className="monarch-secondary">
                <form action={createFolderAction} className="monarch-form">{here}<label>Name *<input name="name" required maxLength={80} placeholder="Engagement letters" /></label><div className="is-wide"><SubmitOnce className="monarch-primary" busy="Creating…">Create folder</SubmitOnce></div></form>
              </Modal>
              <Modal label="Add a document" title="Add a document" className="monarch-primary">
                <DocumentUploader folderId={current?.id} />
                <p className="monarch-muted">PDF, Word, Excel or image (JPG, PNG), up to 25 MB.</p>
              </Modal>
            </span>
          </div>

          {subfolders.length > 0 && (
            <div className="pl-grid">
              {subfolders.map((f) => (
                <DragCard key={f.id} scope="document" move={moveByDragAction} kind="folder" id={f.id} dropTo={f.id} className="monarch-panel pl-card pl-folder">
                  <Link className="pl-name" href={`/documents?internal=1&folder=${f.id}`}>{f.name}</Link>
                  <small className="monarch-muted">{all.filter((d) => !d.archived_at && d.folder_id === f.id).length} documents · {folders.filter((x) => x.parent_id === f.id).length} folders</small>
                  <span className="cl-card-actions">
                    <Modal label="Rename" title="Rename folder" className="monarch-link"><form action={renameFolderAction} className="monarch-form">{here}<input type="hidden" name="id" value={f.id} /><label>Name *<input name="name" required maxLength={80} defaultValue={f.name} /></label><div className="is-wide"><button className="monarch-primary">Save</button></div></form></Modal>
                    <form action={deleteFolderAction}>{here}<input type="hidden" name="id" value={f.id} /><button className="monarch-link is-danger">Delete</button></form>
                  </span>
                </DragCard>
              ))}
            </div>
          )}

          <section className="monarch-panel">
            <div className="monarch-table-wrap">
              <table>
                <thead><tr><th>NAME</th><th>TYPE</th><th>SENT</th><th>{view === "archived" ? "ARCHIVED" : "UPDATED"}</th><th /></tr></thead>
                <tbody>
                  {shown.length === 0 ? (
                    <EmptyRow colSpan={5}>{searching ? "Nothing matches that search." : view === "archived" ? "No archived documents." : current ? "This folder is empty." : subfolders.length ? "No documents outside folders." : "No documents yet. Click Add a document."}</EmptyRow>
                  ) : shown.map((d) => (
                    <DragRow key={d.id} scope="document" id={d.id}>
                      <td><Link href={`/documents/${d.id}`}><b>{d.name}</b></Link>{d.description && <small className="monarch-subcell">{d.description}</small>}{searching && d.folder_id && <small className="monarch-subcell">in {paths.find((p) => p.id === d.folder_id)?.path}</small>}</td>
                      <td>{d.file_type.toUpperCase()}</td>
                      <td>{result.data.sent.get(d.id) ?? 0}</td>
                      <td>{view === "archived" ? when(d.archived_at ?? null) : when(d.updated_at)}</td>
                      <td>
                        {view === "archived" ? <ArchiveRowButton entity="document" id={d.id} archived back="/documents?internal=1&view=archived" /> : (
                          <span className="cl-card-actions">
                            <Link className="monarch-link" href={`/documents/${d.id}`}>Send</Link>
                            {paths.length > 0 && (
                              <Modal label="Move" title={`Move ${d.name}`} className="monarch-link">
                                <form action={moveDocumentAction} className="monarch-form">{here}<input type="hidden" name="id" value={d.id} />
                                  <label className="is-wide">Folder
                                    <select name="to" defaultValue={d.folder_id ?? ""}>
                                      <option value="">No folder</option>
                                      {paths.map((p) => <option key={p.id} value={p.id}>{p.path}</option>)}
                                    </select>
                                  </label>
                                  <div className="is-wide"><button className="monarch-primary">Move</button></div>
                                </form>
                              </Modal>
                            )}
                          </span>
                        )}
                      </td>
                    </DragRow>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
