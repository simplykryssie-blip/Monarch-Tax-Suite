import Link from "next/link";
import { tenantDb } from "@/lib/admin";
import { Badge, EmptyRow, Flash, load, PageTitle, when } from "@/components/admin/ui";
import { workflowsUsing } from "@/lib/automation/admin.ts";
import { automationDeps } from "@/lib/automation/server";
import { SupabaseSmsRepo } from "@/lib/automation/sms-repo";

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { notice, error } = await searchParams;
  const deps = automationDeps();
  const result = await load(async () => ({ templates: await deps.repo.listTemplates(), workflows: await deps.repo.listWorkflows() })).catch(() => null);
  const sms = await load(() => new SupabaseSmsRepo(tenantDb()).list());
  return (
    <>
      <PageTitle title="Templates">The wording of every automated message: emails (with formatting) and texts (plain). Placeholders like {"{{customer_first_name}}"} are filled in safely when it is sent.</PageTitle>
      <Flash notice={notice} error={error} />
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
