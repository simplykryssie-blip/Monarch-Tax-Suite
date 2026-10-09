import Link from "next/link";
import { commerceRepo, requireAdmin } from "@/lib/admin";
import { Badge, EmptyRow, load, money, PageTitle, SetupRequired, when } from "@/components/admin/ui";

export default async function CustomersPage() {
  await requireAdmin();
  const repo = commerceRepo();
  const result = await load(async () => ({ customers: await repo.listCustomers(), orders: await repo.listOrders() }));
  return (
    <>
      <PageTitle title="Customers">Customer accounts and purchase history from verified orders.</PageTitle>
      {!result.ok ? (
        <SetupRequired message={result.message} />
      ) : (
        <section className="monarch-panel">
          <div className="monarch-panel-head"><h2>Customer directory</h2><span>{result.data.customers.length} records</span></div>
          <div className="monarch-table-wrap">
            <table>
              <thead><tr><th>CUSTOMER</th><th>ORDERS</th><th>LIFETIME VALUE</th><th>STATUS</th><th>SINCE</th></tr></thead>
              <tbody>
                {result.data.customers.length === 0 ? (
                  <EmptyRow colSpan={5}>No customers yet. Customers are created from verified purchases.</EmptyRow>
                ) : (
                  result.data.customers.map((c) => {
                    const orders = result.data.orders.filter((o) => o.customer_id === c.id);
                    const paid = orders.filter((o) => o.payment_status === "paid" || o.payment_status === "partially_refunded" || o.payment_status === "refunded");
                    const value = paid.reduce((sum, o) => sum + o.amount_cents - o.amount_refunded_cents, 0);
                    return (
                      <tr key={c.id}>
                        <td><Link href={`/customers/${c.id}`}><b>{c.full_name ?? "—"}</b></Link><small className="monarch-subcell">{c.email}</small></td>
                        <td>{orders.length}</td>
                        <td>{money(value, paid[0]?.currency ?? "usd")}</td>
                        <td><Badge value={c.status} /></td>
                        <td>{when(c.created_at)}</td>
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
