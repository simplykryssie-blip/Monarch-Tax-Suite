import Link from "next/link";
import { notFound } from "next/navigation";
import { commerceRepo, requireAdmin } from "@/lib/admin";
import { Badge, EmptyRow, label, load, money, PageTitle, SetupRequired, when } from "@/components/admin/ui";
import { PLATFORM_GUIDES } from "@/lib/commerce/platforms.ts";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const repo = commerceRepo();
  const result = await load(async () => {
    const customer = await repo.getCustomer(id);
    if (!customer) return null;
    const [orders, licenses, installations, products] = await Promise.all([repo.listOrders(), repo.listLicenses(), repo.listInstallations(), repo.listProducts()]);
    return {
      customer,
      orders: orders.filter((o) => o.customer_id === id),
      licenses: licenses.filter((l) => l.customer_id === id),
      installations: installations.filter((i) => i.customer_id === id),
      products: new Map(products.map((p) => [p.id, p])),
    };
  });
  if (!result.ok) return <SetupRequired message={result.message} />;
  if (!result.data) notFound();
  const { customer, orders, licenses, installations, products } = result.data;

  return (
    <>
      <PageTitle title={customer.full_name ?? customer.email} back={{ href: "/customers", label: "Customers" }}>
        {customer.email} · <Badge value={customer.status} /> · Customer since {when(customer.created_at)}
      </PageTitle>
      <section className="monarch-panel">
        <div className="monarch-panel-head"><h2>Purchases</h2></div>
        <div className="monarch-table-wrap">
          <table>
            <thead><tr><th>ORDER</th><th>PRODUCT</th><th>AMOUNT</th><th>PAYMENT</th><th>INSTALLATION</th><th>VERIFIED BY</th><th>STRIPE REFERENCE</th><th>DATE</th></tr></thead>
            <tbody>
              {orders.length === 0 ? <EmptyRow colSpan={8}>No purchases.</EmptyRow> : orders.map((o) => (
                <tr key={o.id}>
                  <td>#{o.order_number}</td>
                  <td>{products.get(o.product_id)?.name}</td>
                  <td><b>{money(o.amount_cents, o.currency)}</b>{o.amount_refunded_cents > 0 && <small className="monarch-subcell">Refunded {money(o.amount_refunded_cents, o.currency)}</small>}</td>
                  <td><Badge value={o.payment_status} /></td>
                  <td>{label(o.installation_type)}</td>
                  <td>{label(o.verification_method)}</td>
                  <td><code>{o.provider_payment_intent_id ?? "—"}</code></td>
                  <td>{when(o.paid_at ?? o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="monarch-lower-grid">
        <section className="monarch-panel">
          <div className="monarch-panel-head"><h2>Licenses</h2></div>
          <div className="monarch-table-wrap">
            <table>
              <thead><tr><th>LICENSE</th><th>PRODUCT</th><th>STATUS</th></tr></thead>
              <tbody>
                {licenses.length === 0 ? <EmptyRow colSpan={3}>No licenses.</EmptyRow> : licenses.map((l) => (
                  <tr key={l.id}>
                    <td><Link href={`/licenses/${l.id}`}><b>{l.key_prefix ? `${l.key_prefix}…` : "Key not issued"}</b></Link></td>
                    <td>{products.get(l.product_id)?.name}</td>
                    <td><Badge value={l.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="monarch-panel">
          <div className="monarch-panel-head"><h2>Installations</h2></div>
          <div className="monarch-table-wrap">
            <table>
              <thead><tr><th>TYPE</th><th>PLATFORM</th><th>STATUS</th></tr></thead>
              <tbody>
                {installations.length === 0 ? <EmptyRow colSpan={3}>No installations.</EmptyRow> : installations.map((i) => (
                  <tr key={i.id}>
                    <td><Link href={`/installations/${i.id}`}><b>{label(i.installation_type)}</b></Link></td>
                    <td>{PLATFORM_GUIDES[i.platform].label}</td>
                    <td><Badge value={i.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <div className="monarch-notice"><b>SUPPORT HISTORY</b> No support system is connected yet, so there is no support history to show.</div>
    </>
  );
}
