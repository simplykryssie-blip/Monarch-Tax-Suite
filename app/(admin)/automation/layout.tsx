import Link from "next/link";
import { commerceRepo } from "@/lib/admin";
import { requireSection } from "@/lib/tier-server";
import { RunHistoryButton } from "@/components/admin/run-history";
import { when } from "@/components/admin/ui";
import { automationDeps } from "@/lib/automation/server";
import { historyRows } from "@/lib/automation/history.ts";
import { retryExecutionAction } from "./actions";

const TABS = [["/automation/workflows", "Workflows"], ["/automation/pipelines", "Pipelines"], ["/automation/templates", "Templates"], ["/automation/images", "Images"]] as const;

const RESULT = { completed: ["Completed", "run-ok"], error: ["Error", "run-err"], skipped: ["Skipped", "run-skip"], waiting: ["Waiting", "monarch-muted"] } as const;

/** Who each recent run was for, step by step. Empty when the Automation tables aren't installed yet. */
async function recentRuns() {
  try {
    const deps = automationDeps();
    const [executions, workflows] = await Promise.all([deps.repo.listExecutions({ limit: 60 }), deps.repo.listWorkflows()]);
    const events = new Map((await Promise.all([...new Set(executions.map((e) => e.event_id))].map((i) => deps.repo.getEvent(i)))).filter((e) => e).map((e) => [e!.id, e!]));
    const people = new Map<string, string>();
    const customers = commerceRepo();
    await Promise.all([...new Set([...events.values()].map((e) => e.customer_id).filter((c): c is string => Boolean(c)))].slice(0, 40).map(async (id) => {
      const c = await customers.getCustomer(id).catch(() => null);
      if (c) people.set(id, c.full_name?.trim() || c.email);
    }));
    return historyRows({
      executions, events, people,
      workflows: new Map(workflows.map((w) => [w.id, w.name])),
      plannedSteps: new Map(workflows.map((w) => [w.id, w.actions.map((a) => a.type)])),
    });
  } catch {
    return null;
  }
}

export default async function AutomationLayout({ children }: { children: React.ReactNode }) {
  await requireSection("operations");
  const rows = await recentRuns();
  const failed = new Set((rows ?? []).filter((r) => r.result === "error").map((r) => r.executionId)).size;
  return (
    <>
      <div className="monarch-page-actions" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <nav aria-label="Automation" style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          {TABS.map(([href, text]) => <Link key={href} href={href} className="monarch-link">{text}</Link>)}
        </nav>
        <RunHistoryButton failed={failed}>
          {!rows ? <p className="monarch-muted">The Automation tables are not installed yet.</p> : rows.length === 0 ? <p className="monarch-muted">Nothing has run yet. Runs appear here as soon as a workflow is triggered or tested.</p> : (
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>WHEN</th><th>WHO</th><th>WORKFLOW</th><th>STEP</th><th>RESULT</th><th></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    {r.first && <td rowSpan={r.span}>{when(r.when)}</td>}
                    {r.first && <td rowSpan={r.span}>{r.who}</td>}
                    {r.first && <td rowSpan={r.span}>{r.workflow}</td>}
                    <td>{r.step}</td>
                    <td style={{ whiteSpace: "normal", maxWidth: 420 }}><span className={RESULT[r.result][1]}>{RESULT[r.result][0]}</span>{r.detail && <small className="monarch-subcell">{r.detail}</small>}</td>
                    <td>{r.canRetry && <form action={retryExecutionAction}><input type="hidden" name="id" value={r.executionId} /><button className="monarch-link">Retry</button></form>}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
          <p className="monarch-muted">Latest 60 runs. No customer message contents are kept. Tests never reach a client.</p>
        </RunHistoryButton>
      </div>
      {children}
    </>
  );
}
