import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { documentDeps } from "@/lib/documents/server";
import { EmptyRow, load, PageTitle, SetupRequired, when } from "@/components/admin/ui";

/**
 * My Workspace: the account holder's own client work. Clients, client work and documents. Firm and EFIN records live
 * in the ERO Dashboard and My Service Bureau, not here.
 */
export default async function Workspace() {
  await requireAdmin();
  const result = await load(async () => {
    const deps = documentDeps();
    const documents = await deps.repo.listDocuments();
    return documents.filter((d) => !d.archived_at && d.status === "active").slice(0, 6);
  });
  return (
    <>
      <PageTitle title="My Workspace">Your own clients, the returns you prepare for them, and your documents.</PageTitle>
      <div className="efin-flow">
        <section className="monarch-panel" id="clients">
          <div className="monarch-panel-head"><div><h2>Clients</h2><p>The people and businesses you prepare returns for.</p></div></div>
          <div className="monarch-table-wrap"><table>
            <thead><tr><th>CLIENT</th><th>CONTACT</th><th>RETURNS</th></tr></thead>
            <tbody><EmptyRow colSpan={3}>No clients yet. Your client list starts here once client records are switched on for your account.</EmptyRow></tbody>
          </table></div>
        </section>

        <section className="monarch-panel" id="client-work">
          <div className="monarch-panel-head"><div><h2>Client work</h2><p>Returns in progress, what each is waiting on, and what is due.</p></div></div>
          <div className="monarch-table-wrap"><table>
            <thead><tr><th>RETURN</th><th>CLIENT</th><th>STATUS</th><th>DUE</th></tr></thead>
            <tbody><EmptyRow colSpan={4}>Nothing in progress.</EmptyRow></tbody>
          </table></div>
        </section>

        <section className="monarch-panel" id="documents">
          <div className="monarch-panel-head"><div><h2>Documents</h2><p>Your document library.</p></div><Link className="mt-card-link" href="/documents">Open documents</Link></div>
          {!result.ok ? <SetupRequired message={result.message} /> : (
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>NAME</th><th>TYPE</th><th>UPDATED</th></tr></thead>
              <tbody>
                {result.data.length === 0 ? <EmptyRow colSpan={3}>No documents yet. <Link href="/documents" className="efin-card-link">Add one</Link>.</EmptyRow> : result.data.map((d) => (
                  <tr key={d.id}><td><Link href={`/documents/${d.id}`}><b>{d.name}</b></Link></td><td>{d.file_type.toUpperCase()}</td><td>{when(d.updated_at)}</td></tr>
                ))}
              </tbody>
            </table></div>
          )}
        </section>
      </div>
    </>
  );
}
