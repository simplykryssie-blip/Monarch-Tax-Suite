import { Badge, EmptyRow, Flash, load, PageTitle, when } from "@/components/admin/ui";
import { automationDeps } from "@/lib/automation/server";
import { retryExecutionAction, revokeLinkAction } from "../actions";

const currentTime = () => Date.now();

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string; status?: string }> }) {
  const { notice, error, status } = await searchParams;
  const filter = ["failed", "retrying", "queued", "succeeded", "running", "skipped"].includes(status ?? "") ? (status as "failed") : undefined;
  const deps = automationDeps();
  const result = await load(async () => {
    const [execs, workflows, links, audit] = await Promise.all([deps.repo.listExecutions({ status: filter, limit: 100 }), deps.repo.listWorkflows(), deps.repo.listLinks(20), deps.repo.listAudit(25)]);
    const events = new Map((await Promise.all([...new Set(execs.map((e) => e.event_id))].map((i) => deps.repo.getEvent(i)))).filter((e) => e).map((e) => [e!.id, e!]));
    return { now: currentTime(), execs, names: new Map(workflows.map((w) => [w.id, w.name])), events, links, audit };
  }).catch(() => null);
  return (
    <>
      <PageTitle title="Activity">Every automated run: what started it, what it did, and what went wrong. No customer message contents are kept.</PageTitle>
      <Flash notice={notice} error={error} />
      <div className="monarch-page-actions"><span>Show:</span>{[["", "All"], ["failed", "Failed"], ["retrying", "Retrying"], ["succeeded", "Succeeded"]].map(([v, l]) => <a key={l} className="monarch-link" href={v ? `/automation/activity?status=${v}` : "/automation/activity"}>{l}</a>)}</div>
      <section className="monarch-panel"><div className="monarch-table-wrap"><table>
        <thead><tr><th>WORKFLOW</th><th>TRIGGER</th><th>RELATED</th><th>STATUS</th><th>TRIES</th><th>STEPS</th><th>EMAIL ID</th><th>PROBLEM</th><th>WHEN</th><th></th></tr></thead>
        <tbody>
          {!result || !result.ok ? <EmptyRow colSpan={10}>The Automation Center database tables are not installed yet.</EmptyRow> : result.data.execs.length === 0 ? <EmptyRow colSpan={10}>No runs match. Failed deliveries will appear here with a Retry button.</EmptyRow> : result.data.execs.map((e) => {
            const ev = result.data.events.get(e.event_id);
            return (
              <tr key={e.id}>
                <td>{result.data.names.get(e.workflow_id) ?? "Removed workflow"}{e.is_test ? " (test)" : ""}</td>
                <td>{ev?.event_type ?? "—"}</td>
                <td>{ev?.license_id ? <a href={`/licenses/${ev.license_id}`}>License</a> : "—"}</td>
                <td><Badge value={e.status} /></td>
                <td>{e.attempts}/{e.max_attempts}{e.next_attempt_at && (e.status === "retrying" || e.status === "queued") ? <small className="monarch-subcell">next {when(e.next_attempt_at)}</small> : null}</td>
                <td>{e.action_log.map((a) => `${a.index + 1}:${a.status}`).join(" ") || "—"}</td>
                <td>{e.provider_message_id ?? "—"}</td>
                <td style={{ whiteSpace: "normal", maxWidth: 280 }}>{e.error ?? "—"}</td>
                <td>{when(e.created_at)}</td>
                <td>{(e.status === "failed" || e.status === "skipped") && <form action={retryExecutionAction}><input type="hidden" name="id" value={e.id} /><button className="monarch-link">Retry</button></form>}</td>
              </tr>
            );
          })}
        </tbody></table></div></section>
      <section className="monarch-panel"><div className="monarch-panel-head"><div><h2>Customer setup links</h2><p>Only a hash of each link is stored. Links expire after 14 days and can be revoked.</p></div></div>
        <div className="monarch-table-wrap"><table><thead><tr><th>LICENSE</th><th>CREATED</th><th>EXPIRES</th><th>OPENED</th><th>STATE</th><th></th></tr></thead><tbody>
          {!result || !result.ok || result.data.links.length === 0 ? <EmptyRow colSpan={6}>No setup links yet.</EmptyRow> : result.data.links.map((l) => {
            const state = l.revoked_at ? "revoked" : Date.parse(l.expires_at) <= result.data.now ? "expired" : "active";
            return <tr key={l.id}><td><a href={`/licenses/${l.license_id}`}>License</a></td><td>{when(l.created_at)}</td><td>{when(l.expires_at)}</td><td>{when(l.first_opened_at)}</td><td><Badge value={state} /></td><td>{state === "active" && <form action={revokeLinkAction}><input type="hidden" name="id" value={l.id} /><button className="monarch-link">Revoke</button></form>}</td></tr>;
          })}
        </tbody></table></div></section>
      <section className="monarch-panel"><div className="monarch-panel-head"><div><h2>Admin changes</h2></div></div>
        <div className="monarch-table-wrap"><table><thead><tr><th>WHEN</th><th>ACTION</th><th>TARGET</th></tr></thead><tbody>
          {!result || !result.ok || result.data.audit.length === 0 ? <EmptyRow colSpan={3}>No changes recorded yet.</EmptyRow> : result.data.audit.map((a) => <tr key={a.id}><td>{when(a.created_at)}</td><td>{a.action.replace(/_/g, " ")}</td><td>{a.target_type ?? "—"}</td></tr>)}
        </tbody></table></div></section>
    </>
  );
}
