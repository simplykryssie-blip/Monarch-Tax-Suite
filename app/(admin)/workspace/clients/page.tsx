import { FormattedInput } from "@/components/forms/formatted-input";
import Link from "next/link";
import { EmptyRow, Flash, PageTitle } from "@/components/admin/ui";
import { balance, dollars } from "@/lib/workspace/rules.ts";
import { workspaceLoad, workspaceRepo } from "@/lib/workspace/load";
import { addClientAction } from "../actions";
import { WorkspaceSetup } from "../setup";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string; notice?: string; error?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").slice(0, 80);
  const result = await workspaceLoad(async () => {
    const repo = workspaceRepo();
    const [clients, returns, invoices] = await Promise.all([repo.listClients({ q }), repo.listReturns(), repo.listInvoices()]);
    return { clients, returns, invoices };
  });
  return (
    <>
      <PageTitle title="Clients">The people and businesses you prepare returns for. Open a client for their documents, messages, work, billing, tasks and notes.</PageTitle>
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
                {result.data.clients.length === 0 ? <EmptyRow colSpan={4}>{q ? "No clients match that search." : "No clients yet. Add your first one below."}</EmptyRow> : result.data.clients.map((c) => {
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
          <section className="monarch-panel" id="add" style={{ padding: 20 }}>
            <h2>Add a client</h2>
            <form action={addClientAction} className="monarch-form">
              <label>Name *<input name="full_name" required maxLength={200} autoComplete="off" /></label>
              <label>Email<input name="email" type="email" maxLength={254} autoComplete="off" /></label>
              <label>Phone<FormattedInput kind="phone" name="phone" autoComplete="off" /></label>
              <label>Social Security number or ITIN<FormattedInput kind="ssn" name="ssn" secret autoComplete="off" placeholder="Nine digits" /><small className="monarch-muted">Kept encrypted. Only the last four show, and revealing the full number needs a password and is recorded.</small></label>
              <label className="is-wide">Address<input name="address" maxLength={300} autoComplete="off" /></label>
              <div className="is-wide"><button className="monarch-primary">Add client</button></div>
            </form>
          </section>
        </>
      )}
    </>
  );
}
