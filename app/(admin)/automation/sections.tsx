import Link from "next/link";
import { tenantDb } from "@/lib/admin";
import { Badge, EmptyRow, load, SetupRequired, when } from "@/components/admin/ui";
import { workflowsUsing } from "@/lib/automation/admin.ts";
import { automationDeps } from "@/lib/automation/server";
import { SupabaseSmsRepo } from "@/lib/automation/sms-repo";
import { tenantClient } from "@/lib/supabase/service";
import { currentTenantId } from "@/lib/tenants.ts";
import { completeTaskAction, reopenTaskAction } from "./actions";

type Task = { id: string; title: string; due_on: string | null; done_at: string | null; contact_name: string | null; contact_email: string | null; lead_id: string | null; client_id: string | null; created_at: string };

const day = (d: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "medium" }).format(new Date(`${d}T12:00:00Z`));

/** The wording of every automated message: emails and texts. */
export async function TemplatesSection() {
  const deps = automationDeps();
  const result = await load(async () => ({ templates: await deps.repo.listTemplates(), workflows: await deps.repo.listWorkflows() })).catch(() => null);
  const sms = await load(() => new SupabaseSmsRepo(tenantDb()).list());
  return (
    <>
      <section className="monarch-panel">
        <div className="monarch-panel-head"><div><h2>Email</h2></div><Link className="monarch-primary" href="/automation/templates/new">New email template</Link></div>
        <div className="monarch-table-wrap"><table>
          <thead><tr><th>NAME</th><th>SUBJECT</th><th>STATUS</th><th>USED BY</th><th>UPDATED</th></tr></thead>
          <tbody>
            {!result || !result.ok ? <EmptyRow colSpan={5}>The Automation Center database tables are not installed yet.</EmptyRow> : result.data.templates.length === 0 ? <EmptyRow colSpan={5}>No templates yet. Add the standard set from Workflows.</EmptyRow> : result.data.templates.map((t) => (
              <tr key={t.id}><td><Link href={`/automation/templates/${t.id}`}><b>{t.name}</b></Link></td><td>{t.subject}</td><td><Badge value={t.active ? "active" : "inactive"} /></td><td>{workflowsUsing(t.id, result.data.workflows).length} workflows</td><td>{when(t.updated_at)}</td></tr>
            ))}
          </tbody></table></div>
      </section>
      <section className="monarch-panel">
        <div className="monarch-panel-head"><div><h2>Text messages (SMS)</h2><p>Plain text, no formatting. Workflows don&apos;t send texts yet; staff can text a client from the client&apos;s Messages tab once Twilio is connected.</p></div><Link className="monarch-primary" href="/automation/templates/sms/new">New text template</Link></div>
        <div className="monarch-table-wrap"><table>
          <thead><tr><th>NAME</th><th>MESSAGE</th><th>STATUS</th><th>UPDATED</th></tr></thead>
          <tbody>
            {!sms.ok ? <EmptyRow colSpan={4}>Text templates need their table. Apply <code>20261026090000_pipelines_sms.sql</code>.</EmptyRow> : sms.data.length === 0 ? <EmptyRow colSpan={4}>No text templates yet.</EmptyRow> : sms.data.map((t) => (
              <tr key={t.id}><td><Link href={`/automation/templates/sms/${t.id}`}><b>{t.name}</b></Link></td><td style={{ whiteSpace: "normal", maxWidth: 420 }}>{t.body.slice(0, 120)}{t.body.length > 120 ? "…" : ""}</td><td><Badge value={t.active ? "active" : "inactive"} /></td><td>{when(t.updated_at)}</td></tr>
            ))}
          </tbody></table></div>
      </section>
    </>
  );
}

/** Follow-ups that workflow steps created for staff. Open ones first, soonest due first. */
export async function FollowUpsSection({ all }: { all: boolean }) {
  const result = await load(async () => {
    let q = tenantClient(currentTenantId()).from("automation_tasks").select("id, title, due_on, done_at, contact_name, contact_email, lead_id, client_id, created_at");
    if (!all) q = q.is("done_at", null);
    const { data, error } = await q.order("due_on", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).limit(300);
    if (error) throw new Error(error.message);
    return (data ?? []) as Task[];
  });
  if (result.ok && result.data.length === 0 && !all) return null;
  return (
    <section className="monarch-panel" style={{ padding: 20 }}>
      <h2>Follow-ups from your workflows</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <Link className={all ? "monarch-secondary" : "monarch-primary"} href="/automation/workflows">Open</Link>
        <Link className={all ? "monarch-primary" : "monarch-secondary"} href="/automation/workflows?show=all">All</Link>
      </div>
      {!result.ok ? <SetupRequired message={result.message} /> : result.data.length === 0 ? <p className="monarch-muted">{all ? "No tasks yet." : "No open tasks. Add a Create a task step to a workflow to get follow-ups here."}</p> : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
          {result.data.map((t) => (
            <li key={t.id} className="monarch-panel" style={{ padding: 12, opacity: t.done_at ? 0.6 : 1 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                <strong style={{ textDecoration: t.done_at ? "line-through" : "none" }}>{t.title}</strong>
                {t.due_on && <span className="monarch-muted">due {day(t.due_on)}</span>}
                <span style={{ flex: 1 }} />
                <form action={t.done_at ? reopenTaskAction : completeTaskAction}><input type="hidden" name="id" value={t.id} /><button className="monarch-secondary">{t.done_at ? "Reopen" : "Mark done"}</button></form>
              </div>
              <div className="monarch-muted">
                {t.contact_name ?? t.contact_email ?? "No contact"}{t.contact_name && t.contact_email ? ` · ${t.contact_email}` : ""}
                {t.lead_id && <> · <Link href={`/leads/${t.lead_id}`}>lead</Link></>}
                {t.client_id && <> · <Link href={`/workspace/clients/${t.client_id}`}>client</Link></>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
