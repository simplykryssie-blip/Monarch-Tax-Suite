import Link from "next/link";
import { computeMetrics } from "@/lib/commerce/fulfillment.ts";
import { ago, buildActivity, type ActivityItem } from "@/lib/activity.ts";
import { cumulativeByMonth, countBy, monthOverMonth, ordersByMonth, revenueByMonth, type Change } from "@/lib/dashboard-metrics.ts";
import type { Customer, Installation, License, Order, Product } from "@/lib/commerce/types.ts";
import { AreaChart, BarChart, BarRows, Sparkline } from "./charts";
import { Icon, type IconName } from "./icons";
import { Badge, EmptyRow, label, money } from "./ui";

export type Data = { customers: Customer[]; orders: Order[]; products: Product[]; licenses: License[]; installations: Installation[]; now: Date };
export type Extras = { domains: number; crm: number; completed: number; runs: { ok: number; failed: number; waiting: number }; available: boolean; feed: ActivityItem[] };

const FEED_ICON: Record<ActivityItem["kind"], IconName> = { customer: "customers", order: "orders", installation: "installs", email: "automation", alert: "support" };

export function DashboardView({ data, x, months = 12 }: { data: Data; x: Extras; months?: number }) {
  const { now } = data;
  const m = computeMetrics(data);
  const revenue = Object.entries(m.revenueByCurrency);
  const revYear = revenueByMonth(data.orders, now);
  const ordYear = ordersByMonth(data.orders, now);
  const revSeries = revYear.slice(-months);
  const orderSeries = ordYear.slice(-months);
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
  const feed = buildActivity(data, x.feed);
  const settingUp = Math.max(m.activeLicenses - x.completed, 0);
  const tasks = [
    { title: "Licenses waiting for a key", note: "Issue the key so the customer can set up", count: m.pendingLicenses, href: "/licenses" },
    { title: "Customers still setting up", note: "Active licenses that have not finished setup", count: settingUp, href: "/licenses" },
    { title: "Installations needing attention", note: "Requested, in progress or blocked", count: m.openInstallations, href: "/installations" },
    { title: "Automations that failed", note: "Emails or steps to retry", count: x.runs.failed, href: "/automation/activity?status=failed" },
  ];

  return (
    <>
      <div className="mt-kpis">
        <Kpi href="/orders" icon="orders" title="Net revenue" value={revenue.length ? revenue.map(([c, v]) => money(v, c)).join(" · ") : money(0)} sub={`${money(netNow)} this month`} series={revYear.map((p) => p.value)} delta={pctChip(monthOverMonth(revYear))} sparkLabel="Revenue, last 12 months" />
        <Kpi href="/orders" icon="products" title="Paid orders" value={String(m.paidOrders)} sub="Verified sales, excluding internal licenses" series={ordYear.map((p) => p.value)} delta={pctChip(monthOverMonth(ordYear))} sparkLabel="Orders, last 12 months" />
        <Kpi href="/licenses" icon="licenses" title="Active licenses" value={String(m.activeLicenses)} suffix={`of ${total}`} sub={m.pendingLicenses ? `${m.pendingLicenses} waiting for a key` : "All keys issued"} series={licenseSeries.map((p) => p.value)} delta={addedChip(licenseSeries)} sparkLabel="Licenses, growth over 12 months" />
        <Kpi href="/customers" icon="customers" title="Customers" value={String(m.customers)} sub={`${m.openInstallations} open installation${m.openInstallations === 1 ? "" : "s"}`} series={customerSeries.map((p) => p.value)} delta={addedChip(customerSeries)} sparkLabel="Customers, growth over 12 months" />
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
            <div><h2>Revenue</h2><p>Net of refunds, last {months} months</p></div>
            <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <div className="mt-seg" role="group" aria-label="Range">{[3, 6, 12].map((n) => <Link key={n} href={n === 12 ? "/" : `/?range=${n}`} className={n === months ? "is-on" : ""} scroll={false}>{n}M</Link>)}</div>
              <Link className="mt-card-link" href="/orders">View orders →</Link>
            </div>
          </div>
          <div className="mt-card-body"><AreaChart points={revSeries} format={dollars} label="Net revenue per month" /></div>
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
          <div className="mt-card-head"><div><h2>Orders</h2><p>Paid sales, last {months} months</p></div></div>
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

      <div className="mt-grid-act">
        <section className="mt-card">
          <div className="mt-card-head"><div><h2>Recent activity</h2><p>Sign-ups, payments, installs and automations</p></div></div>
          <div className="mt-card-body">
            {feed.length === 0 ? <p className="monarch-muted">Nothing has happened yet. New customers, payments and emails appear here as they occur.</p> : (
              <ul className="mt-feed">
                {feed.map((f) => (
                  <li key={f.id}>
                    <span className={"mt-feed-ico" + (f.kind === "alert" ? " is-bad" : "")}><Icon name={FEED_ICON[f.kind]} size={17} /></span>
                    <span className="mt-feed-text"><b>{f.title}</b><span>{f.detail}</span></span>
                    <time dateTime={f.at}>{ago(f.at, now)}</time>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
        <section className="mt-card">
          <div className="mt-card-head"><div><h2>Needs your attention</h2><p>Select an item to open it</p></div></div>
          <div className="mt-card-body">
            <ul className="mt-tasks">
              {tasks.map((t) => (
                <li key={t.title}>
                  <Link href={t.href}>
                    <span className={"mt-task-box" + (t.count === 0 ? " is-done" : "")}>{t.count === 0 && <Icon name="check" size={13} />}</span>
                    <span><span className="mt-task-title">{t.title}</span><span className="mt-task-note">{t.note}</span></span>
                    <span className={"mt-pill" + (t.count > 0 ? " is-hot" : "")}>{t.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
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
              <thead><tr><th>Order</th><th>Customer</th><th>Product</th><th>Amount</th><th>Status</th></tr></thead>
              <tbody>
                {recent.length === 0 ? <EmptyRow colSpan={5}>No orders yet. Orders appear when Stripe confirms a payment or you reconcile one.</EmptyRow> : recent.map((o) => (
                  <tr key={o.id}>
                    <td>#{o.order_number}</td>
                    <td><Link href={`/customers/${o.customer_id}`}><b>{customersById.get(o.customer_id)?.full_name ?? customersById.get(o.customer_id)?.email}</b></Link></td>
                    <td>{productsById.get(o.product_id)?.name}</td>
                    <td><b>{money(o.amount_cents, o.currency)}</b></td>
                    <td><Badge value={o.payment_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="monarch-panel">
          <div className="monarch-panel-head">
            <div><h2>Open installations</h2><p>Requested, in progress or blocked</p></div>
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

type Chip = { text: string; tone: "up" | "down" | "flat"; title: string } | null;

/** Revenue and orders: percentage against last month. */
function pctChip(c: Change): Chip {
  if (c.kind === "none") return null;
  if (c.kind === "new") return { text: "New", tone: "up", title: "Nothing in the previous month" };
  if (c.kind === "flat") return { text: "No change", tone: "flat", title: "Same as last month" };
  return { text: `${c.kind === "up" ? "▲" : "▼"} ${c.pct}%`, tone: c.kind, title: "Compared with last month" };
}

/** Customers and licenses: how many were added this month. */
function addedChip(cumulative: { value: number }[]): Chip {
  const n = (cumulative.at(-1)?.value ?? 0) - (cumulative.at(-2)?.value ?? 0);
  return n > 0 ? { text: `+${n} this month`, tone: "up", title: "Added this month" } : null;
}

function DeltaChip({ c }: { c: Chip }) {
  if (!c) return null;
  return <span className={"mt-delta" + (c.tone === "up" ? " is-up" : c.tone === "down" ? " is-down" : "")} title={c.title}>{c.text}</span>;
}

function Kpi({ href, icon, title, value, suffix, sub, series, sparkLabel, delta }: { href: string; icon: IconName; title: string; value: string; suffix?: string; sub: string; series: number[]; sparkLabel: string; delta: Chip }) {
  return (
    <Link href={href} className="mt-kpi">
      <div className="mt-kpi-top"><span>{title}</span><span className="mt-kpi-ico"><Icon name={icon} size={17} /></span></div>
      <div className="mt-kpi-value">{value}{suffix && <small> {suffix}</small>}</div>
      <div className="mt-kpi-sub"><DeltaChip c={delta} />{sub}</div>
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
