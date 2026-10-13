import Link from "next/link";
import { commerceRepo, requireAdmin } from "@/lib/admin";
import { Badge, EmptyRow, Flash, load, money, PageTitle, SetupRequired, when } from "@/components/admin/ui";
import { ArchiveRowButton, ArchiveTabs } from "@/components/admin/archive";
import { inView, viewCounts, viewOf } from "@/lib/archive.ts";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ view?: string; notice?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const view = viewOf(sp.view);
  const repo = commerceRepo();
  const result = await load(async () => ({ customers: await repo.listCustomers(), orders: await repo.listOrders() }));
  const customers = result.ok ? inView(result.data.customers, view) : [];
  return (
    <>
      <PageTitle title="Customers">Customer accounts and purchase history from verified orders.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? (
        <SetupRequired message={result.message} />
      ) : (
        <section className="monarch-panel">
          <div className="monarch-panel-head"><h2>{view === "archived" ? "Archived customers" : "Customer directory"}</h2><span>{customers.length} records</span></div>
          <div style={{ padding: "0 20px" }}><ArchiveTabs base="/customers" view={view} counts={viewCounts(result.data.customers)} /></div>
          <div className="monarch-table-wrap">
            <table>
              <thead><tr><th>CUSTOMER</th><th>ORDERS</th><th>LIFETIME VALUE</th><th>STATUS</th><th>{view === "archived" ? "ARCHIVED" : "SINCE"}</th>{view === "archived" && <th />}</tr></thead>
              <tbody>
                {customers.length === 0 ? (
                  <EmptyRow colSpan={view === "archived" ? 6 : 5}>{view === "archived" ? "No archived customers." : "No customers yet. Customers are created from verified purchases."}</EmptyRow>
                ) : (
                  customers.map((c) => {
                    const orders = result.data.orders.filter((o) => o.customer_id === c.id);
                    const paid = orders.filter((o) => o.payment_status === "paid" || o.payment_status === "partially_refunded" || o.payment_status === "refunded");
                    const value = paid.reduce((sum, o) => sum + o.amount_cents - o.amount_refunded_cents, 0);
                    return (
                      <tr key={c.id}>
                        <td><Link href={`/customers/${c.id}`}><b>{c.full_name ?? "—"}</b></Link><small className="monarch-subcell">{c.email}</small></td>
                        <td>{orders.length}</td>
                        <td>{money(value, paid[0]?.currency ?? "usd")}</td>
                        <td><Badge value={c.status} /></td>
                        <td>{view === "archived" ? <>{when(c.archived_at ?? null)}{c.archive_reason && <small className="monarch-subcell">{c.archive_reason}</small>}</> : when(c.created_at)}</td>
                        {view === "archived" && <td><ArchiveRowButton entity="customer" id={c.id} archived back="/customers?view=archived" /></td>}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
