import Link from "next/link";
import { EmptyRow, Flash, PageTitle } from "@/components/admin/ui";
import { Kpi } from "../efin/parts";
import { balance, dollars, totals } from "@/lib/workspace/rules.ts";
import { boardStages, todayIso, workspaceLoad, workspaceRepo } from "@/lib/workspace/load";
import { WorkspaceSetup } from "./setup";

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** My Tax Office: the account holder's own practice at a glance. Returns in progress, revenue, deadlines and quick actions. */
export default async function MyTaxOffice({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await searchParams;
  const today = todayIso();
  const result = await workspaceLoad(async () => {
    const repo = workspaceRepo();
    const [stages, returns, clients, invoices, tasks] = await Promise.all([boardStages(), repo.listReturns(), repo.listClients(), repo.listInvoices(), repo.listTasks({ openOnly: true })]);
    return { stages, returns, clients: new Map(clients.map((c) => [c.id, c])), invoices, tasks };
  });
  return (
    <>
      <PageTitle title="My Tax Office">Your own practice: the returns you are preparing, what you have billed and collected, and what is due soon.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? <WorkspaceSetup message={result.message} /> : (() => {
        const { stages, returns, clients, invoices, tasks } = result.data;
        const finished = new Set(stages.filter((s) => s.done).map((s) => s.id));
        const active = returns.filter((r) => !finished.has(r.stage_id));
        const soon = addDays(today, 30);
        const deadlines = [
          ...active.filter((r) => r.due_on && r.due_on <= soon).map((r) => ({ key: `r${r.id}`, when: r.due_on!, text: `${clients.get(r.client_id)?.full_name ?? "Client"} — ${r.kind === "original" ? "return" : r.kind} ${r.tax_year}`, href: `/workspace/clients/${r.client_id}?tab=work`, kind: r.due_on! < today ? "late" : "due" })),
          ...tasks.filter((t) => t.due_on && t.due_on <= soon).map((t) => ({ key: `t${t.id}`, when: t.due_on!, text: `${clients.get(t.client_id)?.full_name ?? "Client"} — ${t.title}`, href: `/workspace/clients/${t.client_id}?tab=tasks`, kind: t.due_on! < today ? "late" : "task" })),
        ].sort((a, b) => a.when.localeCompare(b.when)).slice(0, 12);
        const t = totals(invoices, today);
        const thisYear = String(new Date().getUTCFullYear());
        const collectedThisYear = invoices.filter((i) => i.paid_on?.startsWith(thisYear)).reduce((n, i) => n + i.paid_cents, 0);
        return (
          <>
            <div className="mt-kpis">
              <Kpi href="/workspace/work" icon="checklist" title="Returns in progress" value={active.length} sub={`${returns.length - active.length} finished`} />
              <Kpi href="/workspace/clients" icon="user" title="Clients" value={clients.size} sub="Active" />
              <Kpi href="/workspace/billing" icon="reports" title="Outstanding" value={dollars(t.outstanding)} sub={t.overdue ? `${dollars(t.overdue)} overdue` : "Nothing overdue"} />
              <Kpi href="/workspace/billing" icon="licenses" title={`Collected in ${thisYear}`} value={dollars(collectedThisYear)} sub={`${dollars(t.invoiced)} invoiced in all`} />
            </div>
            <div className="grid2">
              <section className="monarch-panel">
                <div className="monarch-panel-head"><div><h2>Returns in progress</h2><p>Where each one is.</p></div><Link className="mt-card-link" href="/workspace/work">Open board</Link></div>
                <div className="monarch-table-wrap"><table><tbody>
                  {stages.filter((s) => !s.done).map((s) => <tr key={s.id}><td><span className="pb-flow"><i style={{ background: s.color }} />{s.name}</span></td><td style={{ textAlign: "right" }}><b>{returns.filter((r) => r.stage_id === s.id).length}</b></td></tr>)}
                  {active.length === 0 && <EmptyRow colSpan={2}>Nothing in progress. Add a return from My Work.</EmptyRow>}
                </tbody></table></div>
              </section>
              <section className="monarch-panel">
                <div className="monarch-panel-head"><div><h2>Deadlines</h2><p>Returns and tasks due in the next 30 days, and anything late.</p></div></div>
                <div className="monarch-table-wrap"><table><tbody>
                  {deadlines.length === 0 ? <EmptyRow colSpan={2}>Nothing due soon.</EmptyRow> : deadlines.map((d) => (
                    <tr key={d.key}><td style={{ whiteSpace: "nowrap" }} className={d.kind === "late" ? "wb-late" : undefined}>{d.when}{d.kind === "late" ? " · late" : ""}</td><td style={{ whiteSpace: "normal" }}><Link href={d.href}>{d.text}</Link></td></tr>
                  ))}
                </tbody></table></div>
              </section>
              <section className="monarch-panel">
                <div className="monarch-panel-head"><div><h2>Revenue snapshot</h2></div><Link className="mt-card-link" href="/workspace/billing">Billing</Link></div>
                <div className="monarch-table-wrap"><table><tbody>
                  <tr><td>Invoiced</td><td style={{ textAlign: "right" }}><b>{dollars(t.invoiced)}</b></td></tr>
                  <tr><td>Collected</td><td style={{ textAlign: "right" }}><b>{dollars(t.collected)}</b></td></tr>
                  <tr><td>Outstanding</td><td style={{ textAlign: "right" }}><b>{dollars(t.outstanding)}</b></td></tr>
                  <tr><td>Overdue</td><td style={{ textAlign: "right" }} className={t.overdue ? "wb-late" : undefined}><b>{dollars(t.overdue)}</b></td></tr>
                  <tr><td className="monarch-muted">Largest open balance</td><td style={{ textAlign: "right" }} className="monarch-muted">{dollars(Math.max(0, ...invoices.filter((i) => i.status === "sent").map(balance)))}</td></tr>
                </tbody></table></div>
              </section>
              <section className="monarch-panel" style={{ padding: 20 }}>
                <h2>Quick actions</h2>
                <div style={{ display: "grid", gap: 8 }}>
                  <Link className="monarch-primary" href="/workspace/clients#add">Add a client</Link>
                  <Link className="monarch-secondary" href="/workspace/work#add-return">Add a return</Link>
                  <Link className="monarch-secondary" href="/workspace/billing#new-invoice">New invoice</Link>
                  <Link className="monarch-secondary" href="/workspace/billing/import">Import bank payments</Link>
                  <Link className="monarch-secondary" href="/documents">Open the document library</Link>
                </div>
              </section>
            </div>
          </>
        );
      })()}
    </>
  );
}
