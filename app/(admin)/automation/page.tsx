import Link from "next/link";
import { Badge, EmptyRow, Flash, load, PageTitle, when } from "@/components/admin/ui";
import { dashboardStats } from "@/lib/automation/admin.ts";
import { automationDeps, automationConfig } from "@/lib/automation/server";
import { installDefaultsAction } from "./actions";

export default async function AutomationOverview({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { notice, error } = await searchParams;
  const deps = automationDeps();
  const result = await load(async () => {
    const [stats, workflows] = await Promise.all([dashboardStats(deps.repo), deps.repo.listWorkflows()]);
    return { stats, names: new Map(workflows.map((w) => [w.id, w.name])), total: workflows.length };
  }).catch(() => null);
  const env = automationConfig().env;
  return (
    <>
      <PageTitle title="Automation Center">Emails and follow-ups that run by themselves when something happens, such as a new license or a connected CRM.</PageTitle>
      <Flash notice={notice} error={error} />
      {env !== "production" && <div className="monarch-notice"><b>TEST MODE</b> This is a {env} environment. Emails go only to addresses listed in AUTOMATION_TEST_RECIPIENTS, never to real customers.</div>}
      {!result || !result.ok ? (
        <div className="monarch-notice"><b>DATABASE SETUP REQUIRED</b> Apply <code>supabase/migrations/20261010200000_automation_center.sql</code> to the Monarch Supabase project, then reload. Nothing else is affected until you do: payments, licenses and leads keep working.</div>
      ) : (
        <>
          {result.data.total === 0 && (
            <section className="monarch-panel" style={{ padding: 20 }}>
              <h2>Start with the standard set</h2>
              <p className="monarch-muted">Adds the standard email templates and workflows. Everything is added <b>paused</b>, so nothing is sent until you review and turn it on.</p>
              <form action={installDefaultsAction}><button className="monarch-primary">Add standard templates and workflows</button></form>
            </section>
          )}
          <div className="monarch-metrics">
            {[["Active workflows", result.data.stats.active], ["Paused workflows", result.data.stats.paused], ["Successful runs", result.data.stats.succeeded], ["Failed runs", result.data.stats.failed], ["Waiting to retry", result.data.stats.retrying + result.data.stats.queued], ["Emails sent", result.data.stats.emailsSent]].map(([l, n]) => (
              <div className="monarch-metric" key={String(l)}><div>{l}</div><strong>{n}</strong></div>
            ))}
          </div>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>Recent activity</h2><p>The latest runs, newest first. <Link href="/automation/activity" className="monarch-link">See all</Link></p></div></div>
            <div className="monarch-table-wrap">
              <table>
                <thead><tr><th>WORKFLOW</th><th>STATUS</th><th>WHEN</th></tr></thead>
                <tbody>
                  {result.data.stats.recent.length === 0 ? <EmptyRow colSpan={3}>Nothing has run yet. Runs appear here as soon as a workflow is triggered or tested.</EmptyRow> : result.data.stats.recent.map((e) => (
                    <tr key={e.id}><td>{result.data.names.get(e.workflow_id) ?? "Removed workflow"}{e.is_test ? " (test)" : ""}</td><td><Badge value={e.status} /></td><td>{when(e.created_at)}</td></tr>
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
