import Link from "next/link";
import { Flash, PageTitle } from "@/components/admin/ui";
import { Modal } from "@/components/ui/modal";
import { AddWorkForm } from "@/components/workspace/add-work-form";
import { PipelinePicker } from "@/components/workspace/pipeline-picker";
import { WorkBoard } from "@/components/workspace/work-board";
import { pipelinesRepo } from "@/lib/pipelines/server";
import { isLive } from "@/lib/pipelines/service.ts";
import { buildBoard, buildWorkBoard } from "@/lib/workspace/rules.ts";
import { todayIso, workspaceLoad, workspaceRepo } from "@/lib/workspace/load";
import { moveWorkAction } from "../actions";
import { WorkspaceSetup } from "../setup";

/** Work: a board for each pipeline the office runs. Tax returns is the default; any other pipeline shows its own work. */
export default async function MyWork({ searchParams }: { searchParams: Promise<{ year?: string; pipeline?: string; q?: string; notice?: string; error?: string }> }) {
  const sp = await searchParams;
  const result = await workspaceLoad(async () => {
    const repo = workspaceRepo();
    const pipelines = (await pipelinesRepo().list()).filter(isLive);
    const chosen = pipelines.find((p) => p.id === sp.pipeline) ?? pipelines.find((p) => p.kind === "returns" && p.is_default) ?? pipelines.find((p) => p.kind === "returns") ?? pipelines[0] ?? null;
    const [returns, work, clients] = await Promise.all([repo.listReturns(), chosen && chosen.kind !== "returns" ? repo.listWork({ pipelineId: chosen.id }) : Promise.resolve([]), repo.listClients({ includeArchived: true })]);
    return { pipelines, chosen, returns, work, clients };
  });
  return (
    <>
      <PageTitle title="Work">Drag a card to the next stage as you work on it. Click a card to open the client.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? <WorkspaceSetup message={result.message} /> : (() => {
        const { pipelines, chosen, returns, work, clients } = result.data;
        if (!chosen) return <p className="monarch-muted">No pipelines yet. <Link href="/pipelines">Create one</Link></p>;
        const byId = new Map(clients.map((c) => [c.id, c]));
        const active = clients.filter((c) => !c.archived_at);
        const isReturns = chosen.kind === "returns";
        const years = [...new Set(returns.map((r) => r.tax_year))].sort((a, b) => b - a);
        const requested = Number(sp.year);
        const year = years.includes(requested) ? requested : years[0] ?? new Date().getUTCFullYear() - 1;
        const term = (sp.q ?? "").trim().toLowerCase();
        const allColumns = isReturns ? buildBoard(chosen.stages, returns, byId, year, todayIso()) : buildWorkBoard(chosen.stages, work, byId, todayIso());
        const columns = term ? allColumns.map((c) => ({ ...c, cards: c.cards.filter((k) => k.clientName.toLowerCase().includes(term) || k.label.toLowerCase().includes(term)) })) : allColumns;
        const total = columns.reduce((n, c) => n + c.cards.length, 0);
        const back = isReturns ? `/workspace/work?year=${year}` : `/workspace/work?pipeline=${chosen.id}`;
        return (
          <>
            <div className="monarch-page-actions">
              {pipelines.length > 1 && <PipelinePicker pipelines={pipelines.map((p) => ({ id: p.id, name: p.name }))} current={chosen.id} />}
              {isReturns && (
                <nav className="subtabs" aria-label="Tax year">
                  {(years.includes(year) ? years : [year, ...years]).map((y) => <Link key={y} href={`/workspace/work?pipeline=${chosen.id}&year=${y}`} className={"subtab" + (y === year ? " is-on" : "")} aria-current={y === year ? "page" : undefined}>{y}</Link>)}
                </nav>
              )}
              <form method="get" className="monarch-inline-form" role="search">
                {sp.pipeline && <input type="hidden" name="pipeline" value={sp.pipeline} />}{sp.year && <input type="hidden" name="year" value={sp.year} />}
                <input name="q" type="search" defaultValue={sp.q ?? ""} placeholder="Find a client or return" aria-label="Find a client or return" />
              </form>
              <span className="monarch-muted">{total} {total === 1 ? "card" : "cards"}{isReturns ? ` for ${year}` : ""}</span>
              {active.length > 0 && (
                <Modal label="Add" title="Add work" className="monarch-primary">
                  <AddWorkForm clients={active.map((c) => ({ id: c.id, name: c.full_name }))} pipelines={pipelines.map((p) => ({ id: p.id, name: p.name, returns: p.kind === "returns" }))} pipelineId={chosen.id} year={year} back={back} />
                </Modal>
              )}
            </div>
            <WorkBoard key={`${chosen.id}-${year}-${total}`} columns={columns} move={isReturns ? undefined : moveWorkAction} />
          </>
        );
      })()}
    </>
  );
}
