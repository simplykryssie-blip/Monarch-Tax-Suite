import { requireAdmin } from "@/lib/admin";
import { AddContact } from "@/components/contacts/add-contact";
import { contactKinds } from "@/lib/contacts/kinds.ts";
import { currentTier } from "@/lib/tier-server";
import Link from "next/link";
import { EmptyRow, Flash, PageTitle } from "@/components/admin/ui";
import { balance, dollars } from "@/lib/workspace/rules.ts";
import { workspaceLoad, workspaceRepo } from "@/lib/workspace/load";
import { WorkspaceSetup } from "../setup";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string; notice?: string; error?: string }> }) {
  // The layout and this page render side by side, so the page proves the workspace itself before reading anything.
  await requireAdmin();
  const sp = await searchParams;
  const kinds = contactKinds(await currentTier());
  const q = (sp.q ?? "").slice(0, 80);
  const result = await workspaceLoad(async () => {
    const repo = workspaceRepo();
    const [clients, returns, invoices] = await Promise.all([repo.listClients({ q }), repo.listReturns(), repo.listInvoices()]);
    return { clients, returns, invoices };
  });
  return (
    <>
      <PageTitle title="Clients">The people and businesses you prepare returns for. </PageTitle>
      <div className="cl-head-actions"><AddContact kinds={kinds} /></div>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? <WorkspaceSetup message={result.message} /> : (
        <>
          <section className="monarch-panel">
            <div className="monarch-panel-head">
              <form method="get" className="monarch-inline-form"><input name="q" type="search" defaultValue={q} placeholder="Search name, email or phone" aria-label="Search clients" maxLength={80} /><button className="monarch-secondary">Search</button>{q && <Link href="/workspace/clients">Clear</Link>}</form>
            </div>
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>CLIENT</th><th>CONTACT</th><th>RETURNS</th><th>BALANCE DUE</th></tr></thead>
              <tbody>
                {result.data.clients.length === 0 ? <EmptyRow colSpan={4}>{q ? "No clients match that search." : "No clients yet."}</EmptyRow> : result.data.clients.map((c) => {
                  const due = result.data.invoices.filter((i) => i.client_id === c.id && (i.status === "sent")).reduce((n, i) => n + balance(i), 0);
                  const years = [...new Set(result.data.returns.filter((r) => r.client_id === c.id).map((r) => r.tax_year))].sort().reverse();
                  return (
                    <tr key={c.id}>
                      <td><Link href={`/workspace/clients/${c.id}`}><b>{c.full_name}</b></Link></td>
                      <td>{c.email ?? "—"}{c.phone && <small className="monarch-subcell">{c.phone}</small>}</td>
                      <td>{years.length ? years.join(", ") : "—"}</td>
                      <td>{due ? <b>{dollars(due)}</b> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          </section>
        </>
      )}
    </>
  );
}
