import Link from "next/link";
import { Badge, EmptyRow, Flash, load, PageTitle, when } from "@/components/admin/ui";
import { workflowsUsing } from "@/lib/automation/admin.ts";
import { automationDeps } from "@/lib/automation/server";

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { notice, error } = await searchParams;
  const deps = automationDeps();
  const result = await load(async () => ({ templates: await deps.repo.listTemplates(), workflows: await deps.repo.listWorkflows() })).catch(() => null);
  return (
    <>
      <PageTitle title="Email templates">The wording of every automated email. Placeholders like {"{{customer_first_name}}"} are filled in safely when it is sent.</PageTitle>
      <Flash notice={notice} error={error} />
      <div className="monarch-page-actions"><span /><Link className="monarch-primary" href="/automation/templates/new">New template</Link></div>
      <section className="monarch-panel"><div className="monarch-table-wrap"><table>
        <thead><tr><th>NAME</th><th>SUBJECT</th><th>STATUS</th><th>USED BY</th><th>UPDATED</th></tr></thead>
        <tbody>
          {!result || !result.ok ? <EmptyRow colSpan={5}>The Automation Center database tables are not installed yet.</EmptyRow> : result.data.templates.length === 0 ? <EmptyRow colSpan={5}>No templates yet. Add the standard set from the Overview.</EmptyRow> : result.data.templates.map((t) => (
            <tr key={t.id}><td><Link href={`/automation/templates/${t.id}`}><b>{t.name}</b></Link></td><td>{t.subject}</td><td><Badge value={t.active ? "active" : "inactive"} /></td><td>{workflowsUsing(t.id, result.data.workflows).length} workflows</td><td>{when(t.updated_at)}</td></tr>
          ))}
        </tbody></table></div></section>
    </>
  );
}
