import Link from "next/link";
import { commerceRepo, requireAdmin } from "@/lib/admin";
import { computeMetrics } from "@/lib/commerce/fulfillment.ts";
import type { Customer, Installation, License, Order, Product } from "@/lib/commerce/types.ts";
import { Badge, EmptyRow, label, load, money, SetupRequired, when } from "@/components/admin/ui";

export default async function DashboardPage() {
  await requireAdmin();
  const repo = commerceRepo();
  const result = await load(async () => {
    const [customers, orders, products, licenses, installations] = await Promise.all([
      repo.listCustomers(),
      repo.listOrders(),
      repo.listProducts(),
      repo.listLicenses(),
      repo.listInstallations(),
    ]);
    return { customers, orders, products, licenses, installations };
  });

  return (
    <>
      <div className="monarch-page-title">
        <div className="monarch-eyebrow">MONARCH TAX SUITE / ADMIN WORKSPACE</div>
        <h1>
          Your Business. <em>Under Control.</em>
        </h1>
        <p>Every figure on this page comes from recorded customers, verified orders, and licenses.</p>
      </div>
      {!result.ok ? (
        <SetupRequired message={result.message} />
      ) : (
        <Dashboard {...result.data} />
      )}
    </>
  );
}

type DashboardData = { customers: Customer[]; orders: Order[]; products: Product[]; licenses: License[]; installations: Installation[] };

function Dashboard(data: DashboardData) {
  const m = computeMetrics(data);
  const revenue = Object.entries(m.revenueByCurrency);
  const customersById = new Map(data.customers.map((c) => [c.id, c]));
  const productsById = new Map(data.products.map((p) => [p.id, p]));
  const recent = data.orders.slice(0, 5);
  const openInstalls = data.installations.filter((i) => i.status !== "active" && i.status !== "removed").slice(0, 5);

  return (
    <>
      <div className="monarch-metrics">
        <Metric title="CUSTOMERS" value={String(m.customers)} icon="♙" />
        <Metric title="PAID ORDERS" value={String(m.paidOrders)} icon="▤" />
        <Metric title="NET REVENUE" value={revenue.length ? revenue.map(([c, v]) => money(v, c)).join(" · ") : money(0)} icon="$" />
        <Metric title="OPEN INSTALLATIONS" value={String(m.openInstallations)} icon="⚑" />
      </div>
      <div className="monarch-lower-grid">
        <section className="monarch-panel">
          <div className="monarch-panel-head">
            <div>
              <h2>Recent orders</h2>
              <p>Verified purchases and payment status</p>
            </div>
            <Link className="monarch-link" href="/orders">
              View all orders →
            </Link>
          </div>
          <div className="monarch-table-wrap">
            <table>
              <thead>
                <tr><th>ORDER</th><th>CUSTOMER</th><th>PRODUCT</th><th>AMOUNT</th><th>STATUS</th><th>DATE</th></tr>
              </thead>
              <tbody>
                {recent.length === 0 ? (
                  <EmptyRow colSpan={6}>No orders recorded yet. Orders appear here when Stripe confirms a payment or an administrator reconciles one.</EmptyRow>
                ) : (
                  recent.map((o) => (
                    <tr key={o.id}>
                      <td>#{o.order_number}</td>
                      <td><Link href={`/customers/${o.customer_id}`}><b>{customersById.get(o.customer_id)?.full_name ?? customersById.get(o.customer_id)?.email}</b></Link></td>
                      <td>{productsById.get(o.product_id)?.name}</td>
                      <td><b>{money(o.amount_cents, o.currency)}</b></td>
                      <td><Badge value={o.payment_status} /></td>
                      <td>{when(o.created_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
        <section className="monarch-panel">
          <div className="monarch-panel-head">
            <div>
              <h2>Installations needing attention</h2>
              <p>Requested, in progress, or blocked</p>
            </div>
            <Link className="monarch-link" href="/installations">
              View all →
            </Link>
          </div>
          <div className="monarch-table-wrap">
            <table>
              <thead>
                <tr><th>CUSTOMER</th><th>TYPE</th><th>STATUS</th></tr>
              </thead>
              <tbody>
                {openInstalls.length === 0 ? (
                  <EmptyRow colSpan={3}>No open installations.</EmptyRow>
                ) : (
                  openInstalls.map((i) => (
                    <tr key={i.id}>
                      <td><Link href={`/installations/${i.id}`}><b>{customersById.get(i.customer_id)?.email}</b></Link></td>
                      <td>{label(i.installation_type)}</td>
                      <td><Badge value={i.status} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <div className="monarch-metrics monarch-metrics-secondary">
        <Metric title="PUBLISHED PRODUCTS" value={String(m.publishedProducts)} icon="◇" />
        <Metric title="ACTIVE LICENSES" value={String(m.activeLicenses)} icon="⌘" />
        <Metric title="LICENSES AWAITING KEY" value={String(m.pendingLicenses)} icon="⌛" />
        <Metric title="CATALOG PRODUCTS" value={String(data.products.length)} icon="▦" />
      </div>
    </>
  );
}

function Metric({ title, value, icon }: { title: string; value: string; icon: string }) {
  return (
    <article className="monarch-metric">
      <div>
        <span>{title}</span>
        <i>{icon}</i>
      </div>
      <strong>{value}</strong>
    </article>
  );
}
