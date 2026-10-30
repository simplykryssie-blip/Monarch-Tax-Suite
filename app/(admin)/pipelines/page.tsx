import { requireAdmin } from "@/lib/admin";
import Link from "next/link";
import { Flash, load, PageTitle, when } from "@/components/admin/ui";
import { Modal } from "@/components/ui/modal";
import { pipelinesRepo } from "@/lib/pipelines/server";
import { DEFAULT_RETURN_STAGES, STAGE_COLORS } from "@/lib/pipelines/service.ts";
import type { Pipeline, PipelineFolder } from "@/lib/pipelines/types.ts";
import { SubmitOnce } from "@/components/admin/submit-once";
import { automationDeps } from "@/lib/automation/server";
import { workflowsUsing } from "@/lib/pipelines/usage.ts";
import { DragCard, DropLink } from "@/components/ui/folder-dnd";
import { archivePipelineAction, createFolderAction, createPipelineAction, deleteFolderAction, deletePipelineAction, moveByDragAction, movePipelineAction, publishPipelineAction, renameFolderAction } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every folder a pipeline can be moved to, written as its path. */
function folderPaths(folders: PipelineFolder[]): { id: string; path: string }[] {
  const path = (f: PipelineFolder): string => (f.parent_id ? `${path(folders.find((x) => x.id === f.parent_id) ?? f)} / ${f.name}` : f.name);
  return folders.map((f) => ({ id: f.id, path: path(f) })).sort((a, b) => a.path.localeCompare(b.path));
}

/** Shown instead of a plain button when a workflow still uses the pipeline: names them and asks again. */
function UsedWarning({ names, action, verb, pipelineId, folder, extra }: { names: string[]; action: (form: FormData) => Promise<void>; verb: string; pipelineId: string; folder?: string; extra?: React.ReactNode }) {
  return (
    <form action={action} className="monarch-form">
      <input type="hidden" name="id" value={pipelineId} />
      <input type="hidden" name="used_ok" value="yes" />
      {folder && <input type="hidden" name="folder" value={folder} />}
      {extra}
      <p className="is-wide"><b>This pipeline is used by {names.length === 1 ? "a workflow" : `${names.length} workflows`}:</b></p>
      <ul className="is-wide">{names.map((n) => <li key={n}>{n}</li>)}</ul>
      <p className="is-wide">Their steps that use it will stop working and say so in the run history. Do you still want to {verb.toLowerCase()} it?</p>
      <div className="is-wide"><button className="monarch-primary is-danger">{verb} anyway</button></div>
    </form>
  );
}

function Swatches({ name = "color" }: { name?: string }) {
  return (
    <fieldset className="pl-swatches"><legend>Color</legend>
      {STAGE_COLORS.map((c, i) => <label key={c} className="pl-swatch" style={{ background: c }}><input type="radio" name={name} value={c} defaultChecked={i === 1} aria-label={c} /></label>)}
    </fieldset>
  );
}

export default async function PipelinesPage({ searchParams }: { searchParams: Promise<{ folder?: string; notice?: string; error?: string }> }) {
  // The layout and this page render side by side, so the page proves the workspace itself before reading anything.
  await requireAdmin();
  const sp = await searchParams;
  const result = await load(async () => {
    const repo = pipelinesRepo();
    const [pipelines, folders, workflows] = await Promise.all([repo.list(), repo.listFolders().catch(() => [] as PipelineFolder[]), automationDeps().repo.listWorkflows().catch(() => [])]);
    return { pipelines, folders, workflows };
  });
  const folders = result.ok ? result.data.folders : [];
  const current = UUID.test(sp.folder ?? "") ? folders.find((f) => f.id === sp.folder) ?? null : null;
  const inHere = (p: Pipeline) => (p.folder_id ?? null) === (current?.id ?? null);
  const all = result.ok ? result.data.pipelines : [];
  const list = all.filter((p) => !p.archived_at && inHere(p));
  const workflows = result.ok ? result.data.workflows : [];
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
        <div className="monarch-notice"><b>NOT SET UP YET</b> This part of your account isn&apos;t ready yet. Please contact support and we&apos;ll finish setting it up. Nothing else is affected. </div>
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
              <DropLink scope="pipeline" move={moveByDragAction} to={null} href="/pipelines" current={!current}>All pipelines</DropLink>
              {crumbs.map((f) => <span key={f.id}> / <DropLink scope="pipeline" move={moveByDragAction} to={f.id} href={`/pipelines?folder=${f.id}`} current={f.id === current?.id}>{f.name}</DropLink></span>)}
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
                <DragCard key={f.id} scope="pipeline" move={moveByDragAction} kind="folder" id={f.id} dropTo={f.id} className="monarch-panel pl-card pl-folder">
                  <Link className="pl-name" href={`/pipelines?folder=${f.id}`}>{f.name}</Link>
                  <small className="monarch-muted">{all.filter((p) => !p.archived_at && p.folder_id === f.id).length} pipelines · {folders.filter((x) => x.parent_id === f.id).length} folders</small>
                  <span className="cl-card-actions">
                    <Modal label="Rename" title="Rename folder" className="monarch-link"><form action={renameFolderAction} className="monarch-form">{here}<input type="hidden" name="id" value={f.id} /><label>Name *<input name="name" required maxLength={80} defaultValue={f.name} /></label><div className="is-wide"><button className="monarch-primary">Save</button></div></form></Modal>
                    <form action={deleteFolderAction}><input type="hidden" name="id" value={f.id} /><button className="monarch-link is-danger">Delete</button></form>
                  </span>
                </DragCard>
              ))}
            </div>
          )}

          {list.length === 0 && subfolders.length === 0 ? <p className="monarch-muted">{current ? "This folder is empty." : "No pipelines yet."}</p> : (
            <div className="pl-grid">
              {list.map((p) => {
                const live = p.published !== false;
                const used = workflowsUsing(p, workflows);
                return (
                  <DragCard key={p.id} scope="pipeline" move={moveByDragAction} kind="item" id={p.id} className="monarch-panel pl-card" style={{ borderTopColor: p.color ?? undefined }}>
                    <Link className="pl-name" href={`/pipelines/${p.id}`}>{p.name}</Link>
                    <dl className="pl-facts">
                      <div><dt>Type</dt><dd>{p.type_label || (p.kind === "returns" ? "Tax returns" : "—")}</dd></div>
                      <div><dt>Stages</dt><dd>{p.stages.length}</dd></div>
                    </dl>
                    <span className="cl-card-actions pl-actions">
                      <form action={publishPipelineAction}>{here}<input type="hidden" name="id" value={p.id} /><input type="hidden" name="publish" value={live ? "no" : "yes"} /><button className={live ? "monarch-secondary" : "monarch-primary"} aria-pressed={live}>{live ? "Published" : "Publish"}</button></form>
                      <Link className="monarch-link" href={`/pipelines/${p.id}`}>Edit</Link>
                      {paths.length > 0 && (
                        <Modal label="Move" title={`Move ${p.name}`} className="monarch-link">
                          <form action={movePipelineAction} className="monarch-form">{here}<input type="hidden" name="id" value={p.id} />
                            <label>Folder<select name="to" defaultValue={p.folder_id ?? ""}><option value="">No folder</option>{paths.map((f) => <option key={f.id} value={f.id}>{f.path}</option>)}</select></label>
                            <div className="is-wide"><button className="monarch-primary">Move</button></div></form>
                        </Modal>
                      )}
                      {!p.is_default && (used.length > 0
                        ? <Modal label="Archive" title={`Archive ${p.name}?`} className="monarch-link"><UsedWarning names={used.map((w) => w.name)} action={archivePipelineAction} verb="Archive" pipelineId={p.id} folder={current?.id} extra={<input type="hidden" name="archive" value="yes" />} /></Modal>
                        : <form action={archivePipelineAction}>{here}<input type="hidden" name="id" value={p.id} /><input type="hidden" name="archive" value="yes" /><button className="monarch-link">Archive</button></form>)}
                      {!p.is_default && (used.length > 0
                        ? <Modal label="Delete" title={`Delete ${p.name}?`} className="monarch-link is-danger"><UsedWarning names={used.map((w) => w.name)} action={deletePipelineAction} verb="Delete" pipelineId={p.id} folder={current?.id} /></Modal>
                        : <form action={deletePipelineAction}>{here}<input type="hidden" name="id" value={p.id} /><button className="monarch-link is-danger">Delete</button></form>)}
                    </span>
                  </DragCard>
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
