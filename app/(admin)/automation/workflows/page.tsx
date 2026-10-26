import Link from "next/link";
import { Badge, EmptyRow, Flash, load, PageTitle, when } from "@/components/admin/ui";
import { EVENTS } from "@/lib/automation/events.ts";
import { automationDeps } from "@/lib/automation/server";
import { currentTier } from "@/lib/tier-server";
import { allows } from "@/lib/tier.ts";
import { TemplatesSection } from "../sections";
import { missingDefaults } from "@/lib/automation/defaults.ts";
import { duplicateWorkflowAction, installDefaultsAction, workflowStatusAction } from "../actions";
import { ArchiveRowButton, ArchiveTabs } from "@/components/admin/archive";
import { inView, viewCounts, viewOf } from "@/lib/archive.ts";

export default async function WorkflowsPage({ searchParams }: { searchParams: Promise<{ view?: string; notice?: string; error?: string }> }) {
  const { notice, error, view: rawView } = await searchParams;
  const view = viewOf(rawView);
  const deps = automationDeps();
  const result = await load(() => deps.repo.listWorkflows()).catch(() => null);
  const rows = result?.ok ? inView(result.data, view) : [];
  const missing = result?.ok ? await missingDefaults(deps.repo, allows(await currentTier(), "store") ? "verexa" : "office").catch(() => null) : null;
  return (
    <>
      <PageTitle title="Automation">Workflows say: when this happens, do these steps. The messages they send are below.</PageTitle>
      <Flash notice={notice} error={error} />
      {missing && (missing.templates.length > 0 || missing.workflows.length > 0) && (
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2>{result?.ok && result.data.length === 0 ? "Start with the standard set" : "New standard templates and workflows are available"}</h2>
          <p className="monarch-muted">These are added as listed. Nothing you already have is changed. An <b>active</b> workflow starts sending as soon as its event happens; pause any you want to review first.</p>
          <ul>
            {missing.workflows.map((w) => <li key={w.key}>Workflow: {w.name} · <b>{w.status}</b></li>)}
            {missing.templates.map((t) => <li key={t.key}>Template: {t.name}</li>)}
          </ul>
          <form action={installDefaultsAction}><button className="monarch-primary">Add {missing.workflows.length} workflow{missing.workflows.length === 1 ? "" : "s"} and {missing.templates.length} template{missing.templates.length === 1 ? "" : "s"}</button></form>
        </section>
      )}
      <div className="monarch-page-actions"><span>{result?.ok ? `${rows.length} ${view === "archived" ? "archived " : ""}workflows` : ""}</span><Link className="monarch-primary" href="/automation/workflows/new">New workflow</Link></div>
      <section className="monarch-panel">
        {result?.ok && <div style={{ padding: "0 20px" }}><ArchiveTabs base="/automation/workflows" view={view} counts={viewCounts(result.data)} /></div>}
        <div className="monarch-table-wrap">
          <table>
            <thead><tr><th>NAME</th><th>STARTS WHEN</th><th>STEPS</th><th>STATUS</th><th>{view === "archived" ? "ARCHIVED" : "UPDATED"}</th><th></th></tr></thead>
            <tbody>
              {!result || !result.ok ? <EmptyRow colSpan={6}>The Automation Center database tables are not installed yet.</EmptyRow> : rows.length === 0 ? <EmptyRow colSpan={6}>{view === "archived" ? "No archived workflows." : "No workflows yet. Add the standard set above, or create your own."}</EmptyRow> : rows.map((w) => (
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
      <TemplatesSection />
    </>
  );
}
