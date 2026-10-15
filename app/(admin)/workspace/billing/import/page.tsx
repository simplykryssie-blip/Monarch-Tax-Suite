import Link from "next/link";
import { EmptyRow, Flash, PageTitle, when } from "@/components/admin/ui";
import { workspaceLoad, workspaceRepo } from "@/lib/workspace/load";
import { importPaymentsAction } from "../../actions";
import { WorkspaceSetup } from "../../setup";

export default async function ImportPaymentsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await searchParams;
  const result = await workspaceLoad(() => workspaceRepo().listImports(15));
  return (
    <>
      <PageTitle title="Import bank payments" back={{ href: "/workspace/billing", label: "Billing" }}>Upload your bank&apos;s CSV export. Each deposit is matched to an open invoice by tax year, client name and the last 4 of their SSN. Nothing is applied until you review it.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? <WorkspaceSetup message={result.message} /> : (
        <>
          <form action={importPaymentsAction} className="monarch-panel monarch-form" style={{ padding: 20 }}>
            <label className="is-wide">Bank statement (.csv) *<input name="file" type="file" accept=".csv,text/csv" required /></label>
            <p className="is-wide monarch-muted" style={{ margin: 0 }}>
              The file needs a Date, a Description (or Memo) and an Amount (or Credit) column. Only money coming in is read. Put the client&apos;s name, the tax year and the last 4 of their SSN in the deposit&apos;s memo (for example <code>CASEY CLIENT SSN 1234 TY2025</code>) and the match is exact; with only two of the three it is a suggestion for you to confirm.
              Use test or sample data until you are comfortable with it.
            </p>
            <div className="is-wide"><button className="monarch-primary">Read the file</button></div>
          </form>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>Recent imports</h2></div></div>
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>FILE</th><th>WHEN</th><th>DEPOSITS</th><th>STATE</th></tr></thead>
              <tbody>
                {result.data.length === 0 ? <EmptyRow colSpan={4}>No imports yet.</EmptyRow> : result.data.map((p) => (
                  <tr key={p.id}><td><Link href={`/workspace/billing/import/${p.id}`}><b>{p.file_name}</b></Link></td><td>{when(p.created_at)}</td><td>{p.row_count}</td><td>{p.status === "review" ? "Waiting for review" : p.status === "applied" ? "Applied" : "Discarded"}</td></tr>
                ))}
              </tbody>
            </table></div>
          </section>
        </>
      )}
    </>
  );
}
