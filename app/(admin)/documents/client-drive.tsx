import Link from "next/link";
import { EmptyRow, when } from "@/components/admin/ui";
import { SubmitOnce } from "@/components/admin/submit-once";
import { Modal } from "@/components/ui/modal";
import { DragCard, DragRow, DropLink } from "@/components/ui/folder-dnd";
import { ClientDocUpload } from "@/components/workspace/client-doc-upload";
import { documentDeps } from "@/lib/documents/server";
import { clientFolderName, folderPaths } from "@/lib/documents/folders.ts";
import type { DocumentFolder } from "@/lib/documents/types.ts";
import { portalStaffRepo } from "@/lib/portal/server";
import { workspaceRepo } from "@/lib/workspace/server";
import { shareDocAction } from "@/app/portal-staff-actions";
import { deleteClientDocAction, openClientDocAction } from "../workspace/actions";
import { createClientFolderAction, deleteClientFolderAction, moveClientByDragAction, moveClientFileAction, renameClientFolderAction } from "./client-folder-actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One client's folders and files. The same view is on the Documents area (under Clients) and on the client's own
 * Documents tab: `base` is the page it is drawn on, and the open folder is `&folder=`.
 */
export async function ClientDrive({ clientId, folderId, base, prefix }: { clientId: string; folderId?: string; base: string; /** Breadcrumb links before the client's own folder. */ prefix?: React.ReactNode }) {
  const repo = workspaceRepo();
  const client = await repo.getClient(clientId);
  if (!client) return <p className="monarch-muted">That client wasn&apos;t found.</p>;
  const [docs, returns, staffDocs, folders] = await Promise.all([
    repo.listDocs(clientId), repo.listReturns({ clientId }), portalStaffRepo(client.tenant_id).listDocs(clientId).catch(() => []), documentDeps().repo.listFolders({ clientId }).catch(() => [] as DocumentFolder[]),
  ]);
  const current = UUID.test(folderId ?? "") ? folders.find((f) => f.id === folderId) ?? null : null;
  const crumbs: DocumentFolder[] = [];
  for (let c = current; c; c = c.parent_id ? folders.find((f) => f.id === c!.parent_id) ?? null : null) crumbs.unshift(c);
  const rootName = clientFolderName(client);
  const open = (id?: string) => (id ? `${base}&folder=${id}` : base);
  const back = open(current?.id);
  const paths = folderPaths(folders);
  const move = moveClientByDragAction.bind(null, clientId);
  const scope = `client-${clientId}`;
  const shared = new Map(staffDocs.map((d) => [d.id, d]));
  const here = (<><input type="hidden" name="client_id" value={clientId} /><input type="hidden" name="back" value={back} /></>);
  const subfolders = folders.filter((f) => (f.parent_id ?? null) === (current?.id ?? null));
  const inHere = docs.filter((d) => (d.folder_id ?? null) === (current?.id ?? null));
  const returnLabel = (id: string | null) => { const r = id ? returns.find((x) => x.id === id) : null; return r ? `${r.tax_year} ${r.kind === "original" ? "return" : r.kind}` : "—"; };
  return (
    <>
      <div className="monarch-page-actions">
        <nav className="pl-crumbs" aria-label="Folder">
          {prefix}
          <DropLink scope={scope} move={move} to={null} href={open()} current={!current}>{rootName}</DropLink>
          {crumbs.map((f) => <span key={f.id}> / <DropLink scope={scope} move={move} to={f.id} href={open(f.id)} current={f.id === current?.id}>{f.name}</DropLink></span>)}
        </nav>
        <span className="cl-card-actions">
          <Modal label="New folder" title="New folder" className="monarch-secondary">
            <form action={createClientFolderAction} className="monarch-form">{here}<input type="hidden" name="folder" value={current?.id ?? ""} /><label>Name *<input name="name" required maxLength={80} placeholder="Taxes" /></label><div className="is-wide"><SubmitOnce className="monarch-primary" busy="Creating…">Create folder</SubmitOnce></div></form>
          </Modal>
          <Modal label="Add a file" title={`Add a file for ${client.full_name}`} className="monarch-primary"><ClientDocUpload clientId={clientId} folderId={current?.id} returns={returns.map((r) => ({ id: r.id, label: returnLabel(r.id) }))} /></Modal>
        </span>
      </div>

      {subfolders.length > 0 && (
        <div className="pl-grid">
          {subfolders.map((f) => (
            <DragCard key={f.id} scope={scope} move={move} kind="folder" id={f.id} dropTo={f.id} className="monarch-panel pl-card pl-folder">
              <Link className="pl-name" href={open(f.id)}>{f.name}</Link>
              <small className="monarch-muted">{docs.filter((d) => d.folder_id === f.id).length} files · {folders.filter((x) => x.parent_id === f.id).length} folders</small>
              <span className="cl-card-actions">
                <Modal label="Rename" title="Rename folder" className="monarch-link"><form action={renameClientFolderAction} className="monarch-form">{here}<input type="hidden" name="id" value={f.id} /><label>Name *<input name="name" required maxLength={80} defaultValue={f.name} /></label><div className="is-wide"><button className="monarch-primary">Save</button></div></form></Modal>
                <form action={deleteClientFolderAction}>{here}<input type="hidden" name="id" value={f.id} /><button className="monarch-link is-danger">Delete</button></form>
              </span>
            </DragCard>
          ))}
        </div>
      )}

      <section className="monarch-panel">
        <div className="monarch-table-wrap"><table>
          <thead><tr><th>NAME</th><th>RETURN</th><th>FROM</th><th>PORTAL</th><th>ADDED</th><th /></tr></thead>
          <tbody>
            {inHere.length === 0 ? <EmptyRow colSpan={6}>{current ? "This folder is empty." : subfolders.length ? "No files outside folders." : "No files yet. Click Add a file."}</EmptyRow> : inHere.map((d) => {
              const s = shared.get(d.id);
              return (
                <DragRow key={d.id} scope={scope} id={d.id}>
                  <td><b>{d.title}</b><small className="monarch-subcell">{d.file_type.toUpperCase()}</small></td>
                  <td>{returnLabel(d.return_id)}</td>
                  <td>{s?.source === "client" ? "The client" : "Your office"}</td>
                  <td>
                    {s?.source === "client" ? "Always visible"
                      : s ? <form action={shareDocAction}><input type="hidden" name="area" value="admin" /><input type="hidden" name="client_id" value={clientId} /><input type="hidden" name="doc_id" value={d.id} /><input type="hidden" name="shared" value={s.shared_with_client ? "0" : "1"} /><button className="monarch-link">{s.shared_with_client ? "Shared · Hide" : "Not shared · Share"}</button></form>
                      : "—"}
                  </td>
                  <td>{when(d.created_at)}</td>
                  <td className="cl-card-actions">
                    <form action={openClientDocAction}>{here}<input type="hidden" name="id" value={d.id} /><button className="monarch-link">Download</button></form>
                    {paths.length > 0 && (
                      <Modal label="Move" title={`Move ${d.title}`} className="monarch-link">
                        <form action={moveClientFileAction} className="monarch-form">{here}<input type="hidden" name="id" value={d.id} />
                          <label className="is-wide">Folder
                            <select name="to" defaultValue={d.folder_id ?? ""}>
                              <option value="">{rootName}</option>
                              {paths.map((p) => <option key={p.id} value={p.id}>{p.path}</option>)}
                            </select>
                          </label>
                          <div className="is-wide"><button className="monarch-primary">Move</button></div>
                        </form>
                      </Modal>
                    )}
                    <form action={deleteClientDocAction}>{here}<input type="hidden" name="id" value={d.id} /><button className="monarch-link is-danger">Delete</button></form>
                  </td>
                </DragRow>
              );
            })}
          </tbody>
        </table></div>
      </section>
    </>
  );
}
