import Link from "next/link";
import { Badge, EmptyRow, Flash, load, PageTitle, when } from "@/components/admin/ui";
import { EVENTS } from "@/lib/automation/events.ts";
import { automationDeps } from "@/lib/automation/server";
import { duplicateWorkflowAction, workflowStatusAction } from "../actions";
import { ArchiveRowButton, ArchiveTabs } from "@/components/admin/archive";
import { inView, viewCounts, viewOf } from "@/lib/archive.ts";

export default async function WorkflowsPage({ searchParams }: { searchParams: Promise<{ view?: string; notice?: string; error?: string }> }) {
  const { notice, error, view: rawView } = await searchParams;
  const view = viewOf(rawView);
  const deps = automationDeps();
  const result = await load(() => deps.repo.listWorkflows()).catch(() => null);
  const rows = result?.ok ? inView(result.data, view) : [];
  return (
    <>
      <PageTitle title="Workflows">Each workflow says: when this happens, do these steps.</PageTitle>
      <Flash notice={notice} error={error} />
      <div className="monarch-page-actions"><span>{result?.ok ? `${rows.length} ${view === "archived" ? "archived " : ""}workflows` : ""}</span><Link className="monarch-primary" href="/automation/workflows/new">New workflow</Link></div>
      <section className="monarch-panel">
        {result?.ok && <div style={{ padding: "0 20px" }}><ArchiveTabs base="/automation/workflows" view={view} counts={viewCounts(result.data)} /></div>}
        <div className="monarch-table-wrap">
          <table>
            <thead><tr><th>NAME</th><th>STARTS WHEN</th><th>STEPS</th><th>STATUS</th><th>{view === "archived" ? "ARCHIVED" : "UPDATED"}</th><th></th></tr></thead>
            <tbody>
              {!result || !result.ok ? <EmptyRow colSpan={6}>The Automation Center database tables are not installed yet.</EmptyRow> : rows.length === 0 ? <EmptyRow colSpan={6}>{view === "archived" ? "No archived workflows." : "No workflows yet. Add the standard set from the Overview, or create your own."}</EmptyRow> : rows.map((w) => (
                <tr key={w.id}>
                  <td><Link href={`/automation/workflows/${w.id}`}><b>{w.name}</b></Link></td>
                  <td>{EVENTS[w.trigger_event]?.label ?? w.trigger_event}</td>
                  <td>{w.actions.length}</td>
                  <td><Badge value={w.status} /></td>
                  <td>{view === "archived" ? when(w.archived_at ?? null) : when(w.updated_at)}</td>
                  <td style={{ display: "flex", gap: 8 }}>
                    {view === "archived" ? <ArchiveRowButton entity="workflow" id={w.id} archived back="/automation/workflows?view=archived" /> : <form action={workflowStatusAction}><input type="hidden" name="id" value={w.id} /><input type="hidden" name="status" value={w.status === "active" ? "paused" : "active"} /><button className="monarch-link">{w.status === "active" ? "Pause" : "Turn on"}</button></form>}
                    <form action={duplicateWorkflowAction}><input type="hidden" name="id" value={w.id} /><button className="monarch-link">Duplicate</button></form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
