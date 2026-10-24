import Link from "next/link";
import { Flash, load, PageTitle, when } from "@/components/admin/ui";
import { Modal } from "@/components/ui/modal";
import { pipelinesRepo } from "@/lib/pipelines/server";
import { DEFAULT_RETURN_STAGES, STAGE_COLORS } from "@/lib/pipelines/service.ts";
import type { Pipeline, PipelineFolder } from "@/lib/pipelines/types.ts";
import { SubmitOnce } from "@/components/admin/submit-once";
import { archivePipelineAction, createFolderAction, createPipelineAction, deleteFolderAction, deletePipelineAction, movePipelineAction, publishPipelineAction, renameFolderAction } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every folder a pipeline can be moved to, written as its path. */
function folderPaths(folders: PipelineFolder[]): { id: string; path: string }[] {
  const path = (f: PipelineFolder): string => (f.parent_id ? `${path(folders.find((x) => x.id === f.parent_id) ?? f)} / ${f.name}` : f.name);
  return folders.map((f) => ({ id: f.id, path: path(f) })).sort((a, b) => a.path.localeCompare(b.path));
}

function Swatches({ name = "color" }: { name?: string }) {
  return (
    <fieldset className="pl-swatches"><legend>Color</legend>
      {STAGE_COLORS.map((c, i) => <label key={c} className="pl-swatch" style={{ background: c }}><input type="radio" name={name} value={c} defaultChecked={i === 1} aria-label={c} /></label>)}
    </fieldset>
  );
}

export default async function PipelinesPage({ searchParams }: { searchParams: Promise<{ folder?: string; notice?: string; error?: string }> }) {
  const sp = await searchParams;
  const result = await load(async () => {
    const repo = pipelinesRepo();
    const [pipelines, folders] = await Promise.all([repo.list(), repo.listFolders().catch(() => [] as PipelineFolder[])]);
    return { pipelines, folders };
  });
  const folders = result.ok ? result.data.folders : [];
  const current = UUID.test(sp.folder ?? "") ? folders.find((f) => f.id === sp.folder) ?? null : null;
  const inHere = (p: Pipeline) => (p.folder_id ?? null) === (current?.id ?? null);
  const all = result.ok ? result.data.pipelines : [];
  const list = all.filter((p) => !p.archived_at && inHere(p));
  const archived = all.filter((p) => p.archived_at);
  const hasReturns = all.some((p) => p.kind === "returns" && !p.archived_at);
  const subfolders = folders.filter((f) => (f.parent_id ?? null) === (current?.id ?? null));
  const crumbs: PipelineFolder[] = [];
  for (let c = current; c; c = c.parent_id ? folders.find((f) => f.id === c!.parent_id) ?? null : null) crumbs.unshift(c);
  const paths = folderPaths(folders);
  const here = current ? <input type="hidden" name="folder" value={current.id} /> : null;
  return (
    <>
      <PageTitle title="Pipelines">The stages a piece of work moves through. A published pipeline appears on the Work board.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? (
        <div className="monarch-notice"><b>DATABASE SETUP REQUIRED</b> Pipelines needs its table. Apply <code>supabase/migrations/20261026090000_pipelines_sms.sql</code>, then reload. <small>({result.message})</small></div>
      ) : (
        <>
          {!hasReturns && (
            <section className="monarch-panel" style={{ padding: 20 }}>
              <h2>Start with the standard tax-return pipeline</h2>
              <p className="monarch-muted">{DEFAULT_RETURN_STAGES.map((s) => s.name).join(" → ")}. You can rename, add, remove and reorder every stage afterwards.</p>
              <form action={createPipelineAction}><input type="hidden" name="name" value="Tax returns" /><input type="hidden" name="quick" value="1" /><SubmitOnce className="monarch-primary" busy="Creating…">Create the tax-return pipeline</SubmitOnce></form>
            </section>
          )}
          <div className="monarch-page-actions">
            <nav className="pl-crumbs" aria-label="Folder">
              <Link href="/pipelines" aria-current={current ? undefined : "page"}>All pipelines</Link>
              {crumbs.map((f) => <span key={f.id}> / <Link href={`/pipelines?folder=${f.id}`} aria-current={f.id === current?.id ? "page" : undefined}>{f.name}</Link></span>)}
            </nav>
            <span className="cl-card-actions">
              <Modal label="New folder" title="New folder" className="monarch-secondary">
                <form action={createFolderAction} className="monarch-form">{here}<label>Name *<input name="name" required maxLength={80} placeholder="Bookkeeping clients" /></label><div className="is-wide"><SubmitOnce className="monarch-primary" busy="Creating…">Create folder</SubmitOnce></div></form>
              </Modal>
              <Modal label="New pipeline" title="New pipeline" className="monarch-primary">
                <form action={createPipelineAction} className="monarch-form">
                  {here}
                  <label>Name *<input name="name" required maxLength={80} placeholder="Monthly bookkeeping" /></label>
                  <label>Type<input name="type_label" maxLength={40} placeholder="Bookkeeping, tax planning, payroll…" /></label>
                  <Swatches />
                  <div className="is-wide"><SubmitOnce className="monarch-primary" busy="Creating…">Create and edit</SubmitOnce></div>
                </form>
              </Modal>
            </span>
          </div>

          {subfolders.length > 0 && (
            <div className="pl-grid">
              {subfolders.map((f) => (
                <section key={f.id} className="monarch-panel pl-card pl-folder">
                  <Link className="pl-name" href={`/pipelines?folder=${f.id}`}>{f.name}</Link>
                  <small className="monarch-muted">{all.filter((p) => !p.archived_at && p.folder_id === f.id).length} pipelines · {folders.filter((x) => x.parent_id === f.id).length} folders</small>
                  <span className="cl-card-actions">
                    <Modal label="Rename" title="Rename folder" className="monarch-link"><form action={renameFolderAction} className="monarch-form">{here}<input type="hidden" name="id" value={f.id} /><label>Name *<input name="name" required maxLength={80} defaultValue={f.name} /></label><div className="is-wide"><button className="monarch-primary">Save</button></div></form></Modal>
                    <form action={deleteFolderAction}><input type="hidden" name="id" value={f.id} /><button className="monarch-link is-danger">Delete</button></form>
                  </span>
                </section>
              ))}
            </div>
          )}

          {list.length === 0 && subfolders.length === 0 ? <p className="monarch-muted">{current ? "This folder is empty." : "No pipelines yet."}</p> : (
            <div className="pl-grid">
              {list.map((p) => {
                const live = p.published !== false;
                return (
                  <section key={p.id} className="monarch-panel pl-card" style={{ borderTopColor: p.color ?? undefined }}>
                    <Link className="pl-name" href={`/pipelines/${p.id}`}>{p.name}</Link>
                    <dl className="pl-facts">
                      <div><dt>Type</dt><dd>{p.type_label || (p.kind === "returns" ? "Tax returns" : "—")}</dd></div>
                      <div><dt>Stages</dt><dd>{p.stages.length}</dd></div>
                    </dl>
                    <span className="cl-card-actions">
                      <form action={publishPipelineAction}>{here}<input type="hidden" name="id" value={p.id} /><input type="hidden" name="publish" value={live ? "no" : "yes"} /><button className={live ? "monarch-secondary" : "monarch-primary"} aria-pressed={live}>{live ? "Published" : "Publish"}</button></form>
                    </span>
                    <span className="cl-card-actions">
                      <Link className="monarch-link" href={`/pipelines/${p.id}`}>Edit</Link>
                      {paths.length > 0 && (
                        <Modal label="Move" title={`Move ${p.name}`} className="monarch-link">
                          <form action={movePipelineAction} className="monarch-form">{here}<input type="hidden" name="id" value={p.id} />
                            <label>Folder<select name="to" defaultValue={p.folder_id ?? ""}><option value="">No folder</option>{paths.map((f) => <option key={f.id} value={f.id}>{f.path}</option>)}</select></label>
                            <div className="is-wide"><button className="monarch-primary">Move</button></div></form>
                        </Modal>
                      )}
                      {!p.is_default && <form action={archivePipelineAction}>{here}<input type="hidden" name="id" value={p.id} /><input type="hidden" name="archive" value="yes" /><button className="monarch-link">Archive</button></form>}
                    </span>
                  </section>
                );
              })}
            </div>
          )}

          {archived.length > 0 && (
            <section className="monarch-panel">
              <div className="monarch-panel-head"><div><h2>Archived pipelines</h2></div></div>
              <div className="pl-grid">
                {archived.map((p) => (
                  <section key={p.id} className="monarch-panel pl-card" style={{ borderTopColor: p.color ?? undefined }}>
                    <Link className="pl-name" href={`/pipelines/${p.id}`}>{p.name}</Link>
                    <small className="monarch-muted">Archived {when(p.archived_at!)}</small>
                    <span className="cl-card-actions">
                      <form action={archivePipelineAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="archive" value="no" /><button className="monarch-link">Restore</button></form>
                      <form action={deletePipelineAction}><input type="hidden" name="id" value={p.id} /><button className="monarch-link is-danger">Delete</button></form>
                    </span>
                  </section>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}
