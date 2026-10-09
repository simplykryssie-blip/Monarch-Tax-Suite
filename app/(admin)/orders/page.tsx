import Link from "next/link";
import { commerceRepo, requireAdmin } from "@/lib/admin";
import { Badge, EmptyRow, Flash, label, load, money, PageTitle, SetupRequired, when } from "@/components/admin/ui";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const repo = commerceRepo();
  const result = await load(async () => {
    const [orders, customers, products] = await Promise.all([repo.listOrders(), repo.listCustomers(), repo.listProducts()]);
    return { orders, customers: new Map(customers.map((c) => [c.id, c])), products: new Map(products.map((p) => [p.id, p])) };
  });
  return (
    <>
      <PageTitle title="Orders">Every verified order, its payment status, and how it was verified.</PageTitle>
      <Flash {...await searchParams} />
      {!result.ok ? (
        <SetupRequired message={result.message} />
      ) : (
        <>
          <div className="monarch-page-actions">
            <span>{result.data.orders.length} orders · new Stripe purchases are recorded automatically by the webhook</span>
            <Link className="monarch-primary" href="/orders/reconcile">Reconcile a past purchase</Link>
          </div>
          <section className="monarch-panel">
            <div className="monarch-table-wrap">
              <table>
                <thead><tr><th>ORDER</th><th>CUSTOMER</th><th>PRODUCT</th><th>AMOUNT</th><th>PAYMENT</th><th>INSTALLATION</th><th>VERIFIED BY</th><th>DATE</th></tr></thead>
                <tbody>
                  {result.data.orders.length === 0 ? (
                    <EmptyRow colSpan={8}>No orders recorded yet.</EmptyRow>
                  ) : (
                    result.data.orders.map((o) => {
                      const c = result.data.customers.get(o.customer_id);
                      return (
                        <tr key={o.id}>
                          <td>#{o.order_number}</td>
                          <td><Link href={`/customers/${o.customer_id}`}><b>{c?.full_name ?? c?.email}</b></Link><small className="monarch-subcell">{c?.email}</small></td>
                          <td>{result.data.products.get(o.product_id)?.name}</td>
                          <td><b>{money(o.amount_cents, o.currency)}</b></td>
                          <td><Badge value={o.payment_status} /></td>
                          <td>{label(o.installation_type)}</td>
                          <td>{label(o.verification_method)}</td>
                          <td>{when(o.paid_at ?? o.created_at)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
