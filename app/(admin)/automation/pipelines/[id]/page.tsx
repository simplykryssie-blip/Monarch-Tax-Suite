import { notFound } from "next/navigation";
import { Flash, PageTitle } from "@/components/admin/ui";
import { PipelineBuilder } from "@/components/admin/pipeline-builder";
import { pipelinesRepo } from "@/lib/pipelines/server";
import { archivePipelineAction, defaultPipelineAction, deletePipelineAction, savePipelineAction } from "../../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PipelinePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { id } = await params;
  const { notice, error } = await searchParams;
  if (!UUID.test(id)) notFound();
  const p = await pipelinesRepo().get(id).catch(() => null);
  if (!p) notFound();
  return (
    <>
      <PageTitle title={p.name} back={{ href: "/automation/pipelines", label: "Pipelines" }}>{p.kind === "returns" ? "A tax-return pipeline." : "A pipeline for other work."}{p.is_default ? " It runs the My Work board." : ""}{p.archived_at ? " Archived: restore it to edit it." : ""}</PageTitle>
      <Flash notice={notice} error={error} />
      <PipelineBuilder id={p.id} name={p.name} stages={p.stages} action={savePipelineAction} canSave={!p.archived_at} />
      <section className="monarch-panel" style={{ padding: 20, display: "flex", gap: 12, flexWrap: "wrap" }}>
        {p.kind === "returns" && !p.is_default && !p.archived_at && <form action={defaultPipelineAction}><input type="hidden" name="id" value={p.id} /><button className="monarch-primary">Use this for My Work</button></form>}
        {!p.is_default && <form action={archivePipelineAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="archive" value={p.archived_at ? "no" : "yes"} /><button className="monarch-secondary">{p.archived_at ? "Restore" : "Archive"}</button></form>}
        {p.archived_at && (
          <form action={deletePipelineAction} className="monarch-inline-form">
            <input type="hidden" name="id" value={p.id} />
            <label><input type="checkbox" name="confirm" value="yes" required /> Delete this pipeline for good</label>
            <button className="monarch-secondary is-danger">Delete</button>
          </form>
        )}
        <p className="monarch-muted">Renaming or removing a stage never loses work: anything in a removed stage appears in the first stage of the board until you move it.</p>
      </section>
    </>
  );
}
