import Link from "next/link";
import { computeMetrics } from "@/lib/commerce/fulfillment.ts";
import { cumulativeByMonth, countBy, ordersByMonth, revenueByMonth } from "@/lib/dashboard-metrics.ts";
import type { Customer, Installation, License, Order, Product } from "@/lib/commerce/types.ts";
import { AreaChart, BarChart, BarRows, Sparkline } from "./charts";
import { Icon, type IconName } from "./icons";
import { Badge, EmptyRow, label, money, when } from "./ui";

export type Data = { customers: Customer[]; orders: Order[]; products: Product[]; licenses: License[]; installations: Installation[]; now: Date };
export type Extras = { domains: number; crm: number; completed: number; runs: { ok: number; failed: number; waiting: number }; available: boolean };

export function DashboardView({ data, x }: { data: Data; x: Extras }) {
  const { now } = data;
  const m = computeMetrics(data);
  const revenue = Object.entries(m.revenueByCurrency);
  const revSeries = revenueByMonth(data.orders, now);
  const orderSeries = ordersByMonth(data.orders, now);
  const customerSeries = cumulativeByMonth(data.customers, now);
  const licenseSeries = cumulativeByMonth(data.licenses, now);
  const customersById = new Map(data.customers.map((c) => [c.id, c]));
  const productsById = new Map(data.products.map((p) => [p.id, p]));
  const recent = data.orders.slice(0, 6);
  const openInstalls = data.installations.filter((i) => i.status !== "active" && i.status !== "removed").slice(0, 5);
  const licenseCounts = countBy(data.licenses, (l) => l.status);
  const installCounts = countBy(data.installations, (i) => i.status);
  const total = data.licenses.length;
  const dollars = (c: number) => (c >= 100000 ? `$${(c / 100000).toFixed(c % 100000 ? 1 : 0)}k` : `$${Math.round(c / 100)}`);
  const netNow = revSeries.at(-1)?.value ?? 0;

  return (
    <>
      <div className="mt-kpis">
        <Kpi href="/orders" icon="orders" title="Net revenue" value={revenue.length ? revenue.map(([c, v]) => money(v, c)).join(" · ") : money(0)} sub={`${money(netNow)} this month`} series={revSeries.map((p) => p.value)} sparkLabel="Revenue, last 12 months" />
        <Kpi href="/orders" icon="products" title="Paid orders" value={String(m.paidOrders)} sub="Verified sales, excluding internal licenses" series={orderSeries.map((p) => p.value)} sparkLabel="Orders, last 12 months" />
        <Kpi href="/licenses" icon="licenses" title="Active licenses" value={String(m.activeLicenses)} suffix={`of ${total}`} sub={m.pendingLicenses ? `${m.pendingLicenses} waiting for a key` : "All keys issued"} series={licenseSeries.map((p) => p.value)} sparkLabel="Licenses, growth over 12 months" />
        <Kpi href="/customers" icon="customers" title="Customers" value={String(m.customers)} sub={`${m.openInstallations} open installation${m.openInstallations === 1 ? "" : "s"}`} series={customerSeries.map((p) => p.value)} sparkLabel="Customers, growth over 12 months" />
      </div>

      <div className="mt-quick">
        <QuickLink href="/orders/internal" icon="licenses" title="Create a license" note="Complimentary or internal" />
        <QuickLink href="/automation/activity" icon="automation" title="Automation activity" note="Emails, retries, setup links" />
        <QuickLink href="/installations" icon="installs" title="Installations" note={`${m.openInstallations} need attention`} />
        <QuickLink href="/products" icon="products" title="Products" note={`${m.publishedProducts} published`} />
      </div>

      <div className="mt-grid-2">
        <section className="mt-card">
          <div className="mt-card-head">
            <div><h2>Revenue</h2><p>Net of refunds, last 12 months</p></div>
            <Link className="mt-card-link" href="/orders">View orders →</Link>
          </div>
          <div className="mt-card-body"><AreaChart points={revSeries} format={dollars} label="Net revenue per month" id="rev" /></div>
        </section>
        <section className="mt-card">
          <div className="mt-card-head">
            <div><h2>Customer setup</h2><p>Where each license stands</p></div>
            <Link className="mt-card-link" href="/licenses">Open licenses →</Link>
          </div>
          <div className="mt-card-body">
            <BarRows
              total={Math.max(total, 1)}
              empty="No licenses yet."
              rows={[
                { label: "Licenses issued", value: m.activeLicenses, href: "/licenses", tone: "ink" },
                { label: "Website authorized", value: x.domains, href: "/licenses" },
                { label: "Lead destination connected", value: x.crm, href: "/licenses" },
                { label: "Setup completed", value: x.completed, href: "/licenses", note: x.available ? undefined : "Setup tracking is not available yet." },
              ]}
            />
          </div>
        </section>
      </div>

      <div className="mt-grid-3">
        <section className="mt-card">
          <div className="mt-card-head"><div><h2>Orders</h2><p>Paid sales per month</p></div></div>
          <div className="mt-card-body"><BarChart points={orderSeries} format={(v) => String(v)} label="Paid orders per month" /></div>
        </section>
        <section className="mt-card">
          <div className="mt-card-head"><div><h2>Licenses</h2><p>By status</p></div><Link className="mt-card-link" href="/licenses">All →</Link></div>
          <div className="mt-card-body">
            <BarRows total={Math.max(total, 1)} empty="No licenses yet." rows={[
              { label: "Active", value: licenseCounts.active ?? 0, href: "/licenses", tone: "ink" },
              { label: "Pending a key", value: licenseCounts.pending ?? 0, href: "/licenses" },
              { label: "Suspended", value: licenseCounts.suspended ?? 0, href: "/licenses", tone: "soft" },
              { label: "Revoked", value: licenseCounts.revoked ?? 0, href: "/licenses", tone: "soft" },
            ]} />
          </div>
        </section>
        <section className="mt-card">
          <div className="mt-card-head"><div><h2>Automation</h2><p>Last 30 days</p></div><Link className="mt-card-link" href="/automation">Open →</Link></div>
          <div className="mt-card-body">
            <div className="mt-stat-row">
              <Link href="/automation/activity?status=succeeded" className="mt-stat" style={{ textDecoration: "none", color: "inherit" }}><b>{x.runs.ok}</b><span>Succeeded</span></Link>
              <Link href="/automation/activity?status=failed" className="mt-stat" style={{ textDecoration: "none", color: "inherit" }}><b>{x.runs.failed}</b><span>Failed</span></Link>
              <Link href="/automation/activity?status=retrying" className="mt-stat" style={{ textDecoration: "none", color: "inherit" }}><b>{x.runs.waiting}</b><span>Waiting</span></Link>
            </div>
            <BarRows total={Math.max(data.installations.length, 1)} empty="No installations yet." rows={[
              { label: "Installations active", value: installCounts.active ?? 0, href: "/installations", tone: "ink" },
              { label: "Needing attention", value: m.openInstallations, href: "/installations" },
            ]} />
          </div>
        </section>
      </div>

      <div className="monarch-lower-grid">
        <section className="monarch-panel">
          <div className="monarch-panel-head">
            <div><h2>Recent orders</h2><p>Verified purchases and payment status</p></div>
            <Link className="mt-card-link" href="/orders">View all →</Link>
          </div>
          <div className="monarch-table-wrap">
            <table>
              <thead><tr><th>Order</th><th>Customer</th><th>Product</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
              <tbody>
                {recent.length === 0 ? <EmptyRow colSpan={6}>No orders yet. Orders appear when Stripe confirms a payment or you reconcile one.</EmptyRow> : recent.map((o) => (
                  <tr key={o.id}>
                    <td>#{o.order_number}</td>
                    <td><Link href={`/customers/${o.customer_id}`}><b>{customersById.get(o.customer_id)?.full_name ?? customersById.get(o.customer_id)?.email}</b></Link></td>
                    <td>{productsById.get(o.product_id)?.name}</td>
                    <td><b>{money(o.amount_cents, o.currency)}</b></td>
                    <td><Badge value={o.payment_status} /></td>
                    <td>{when(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="monarch-panel">
          <div className="monarch-panel-head">
            <div><h2>Needs attention</h2><p>Installations that are requested, in progress or blocked</p></div>
            <Link className="mt-card-link" href="/installations">View all →</Link>
          </div>
          <div className="monarch-table-wrap">
            <table>
              <thead><tr><th>Customer</th><th>Type</th><th>Status</th></tr></thead>
              <tbody>
                {openInstalls.length === 0 ? <EmptyRow colSpan={3}>Nothing waiting on you.</EmptyRow> : openInstalls.map((i) => (
                  <tr key={i.id}>
                    <td><Link href={`/installations/${i.id}`}><b>{customersById.get(i.customer_id)?.email}</b></Link></td>
                    <td>{label(i.installation_type)}</td>
                    <td><Badge value={i.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

function Kpi({ href, icon, title, value, suffix, sub, series, sparkLabel }: { href: string; icon: IconName; title: string; value: string; suffix?: string; sub: string; series: number[]; sparkLabel: string }) {
  return (
    <Link href={href} className="mt-kpi">
      <div className="mt-kpi-top"><span>{title}</span><span className="mt-kpi-ico"><Icon name={icon} size={17} /></span></div>
      <div className="mt-kpi-value">{value}{suffix && <small> {suffix}</small>}</div>
      <div className="mt-kpi-sub">{sub}</div>
      <div className="mt-kpi-foot"><span className="mt-kpi-go">Open <Icon name="arrow" size={14} /></span><Sparkline values={series} label={sparkLabel} /></div>
    </Link>
  );
}

function QuickLink({ href, icon, title, note }: { href: string; icon: IconName; title: string; note: string }) {
  return (
    <Link href={href}>
      <span className="q-ico"><Icon name={icon} size={19} /></span>
      <span><b>{title}</b><small>{note}</small></span>
      <span className="q-go"><Icon name="arrow" size={18} /></span>
    </Link>
  );
}
