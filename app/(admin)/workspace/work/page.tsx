import Link from "next/link";
import { Flash, PageTitle } from "@/components/admin/ui";
import { WorkBoard } from "@/components/workspace/work-board";
import { buildBoard } from "@/lib/workspace/rules.ts";
import { RETURN_KINDS } from "@/lib/workspace/types.ts";
import { boardStages, todayIso, workspaceLoad, workspaceRepo } from "@/lib/workspace/load";
import { addReturnAction } from "../actions";
import { WorkspaceSetup } from "../setup";

/** Returns: a board of every return for a tax year, a column per stage of your tax-return pipeline. */
export default async function MyWork({ searchParams }: { searchParams: Promise<{ year?: string; notice?: string; error?: string }> }) {
  const sp = await searchParams;
  const result = await workspaceLoad(async () => {
    const repo = workspaceRepo();
    const [stages, returns, clients] = await Promise.all([boardStages(), repo.listReturns(), repo.listClients({ includeArchived: true })]);
    return { stages, returns, clients };
  });
  return (
    <>
      <PageTitle title="Returns">Drag a return to the next stage as you work on it. Extensions and amendments are cards of their own. Click a card to open the client.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? <WorkspaceSetup message={result.message} /> : (() => {
        const { stages, returns, clients } = result.data;
        const years = [...new Set(returns.map((r) => r.tax_year))].sort((a, b) => b - a);
        const requested = Number(sp.year);
        const year = years.includes(requested) ? requested : years[0] ?? new Date().getUTCFullYear() - 1;
        const columns = buildBoard(stages, returns, new Map(clients.map((c) => [c.id, c])), year, todayIso());
        const total = columns.reduce((n, c) => n + c.cards.length, 0);
        const active = clients.filter((c) => !c.archived_at);
        return (
          <>
            <div className="monarch-page-actions">
              <form method="get" className="monarch-inline-form">
                <label>Tax year <select name="year" defaultValue={String(year)}>{(years.includes(year) ? years : [year, ...years]).map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
                <button className="monarch-secondary">Show</button>
              </form>
              <span className="monarch-muted">{total} {total === 1 ? "return" : "returns"} for {year} · <Link href="/automation/pipelines">Edit the stages</Link></span>
            </div>
            <WorkBoard key={`${year}-${total}`} columns={columns} />
            <section className="monarch-panel" id="add-return" style={{ padding: 20 }}>
              <h2>Add a return</h2>
              {active.length === 0 ? <p className="monarch-muted">Add a client first. <Link href="/workspace/clients#add">Add a client</Link></p> : (
                <form action={addReturnAction} className="monarch-form">
                  <input type="hidden" name="back" value={`/workspace/work?year=${year}`} />
                  <label>Client *<select name="client_id" required defaultValue=""><option value="" disabled>Choose a client…</option>{active.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}</select></label>
                  <label>Tax year *<input name="tax_year" required inputMode="numeric" maxLength={4} defaultValue={year} /></label>
                  <label>Kind<select name="kind" defaultValue="original">{Object.entries(RETURN_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <label>Due date<input name="due_on" type="date" /></label>
                  <div className="is-wide"><button className="monarch-primary">Add return</button></div>
                </form>
              )}
            </section>
          </>
        );
      })()}
    </>
  );
}
