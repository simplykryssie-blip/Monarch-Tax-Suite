import Link from "next/link";
import { redirect } from "next/navigation";
import { commerceRepo, requireAdmin } from "@/lib/admin";
import { currentTier } from "@/lib/tier-server";
import { homeFor } from "@/lib/tier.ts";
import { computeMetrics } from "@/lib/commerce/fulfillment.ts";
import { loadExtras } from "@/lib/dashboard-data";
import { buildActivity } from "@/lib/activity.ts";
import { revenueByMonth } from "@/lib/dashboard-metrics.ts";
import { ActivityAndAttention, buildTasks, type Data } from "@/components/admin/dashboard-view";
import { Icon } from "@/components/admin/icons";
import { load, money, SetupRequired } from "@/components/admin/ui";

const clock = () => new Date();

/** My Office: the whole business at a glance. Commerce detail lives under My Store. */
export default async function OfficeHome() {
  await requireAdmin();
  // The business-wide overview is for the Service Bureau tier; the others start in their own area.
  const tier = await currentTier();
  if (tier !== "bureau") redirect(homeFor(tier));
  const repo = commerceRepo();
  const result = await load(async () => {
    const [customers, orders, products, licenses, installations] = await Promise.all([repo.listCustomers(), repo.listOrders(), repo.listProducts(), repo.listLicenses(), repo.listInstallations()]);
    return { customers, orders, products, licenses, installations };
  });
  const now = clock();
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/Chicago" }).format(now)) % 24;
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <>
      <div className="mt-hero">
        <div>
          <div className="mt-eyebrow">MY OFFICE</div>
          <h1>{greeting}.</h1>
          <p>Everything in one place. Open a section to work in it, or pick up what needs you below.</p>
          <div className="mt-metal-rule" />
        </div>
        <div className="mt-actions">
          <Link className="monarch-primary" href="/orders/internal"><Icon name="plus" size={16} />New license</Link>
          <Link className="monarch-secondary" href="/store">Open My Store</Link>
        </div>
      </div>
      {!result.ok ? <SetupRequired message={result.message} /> : <Body data={{ ...result.data, now }} />}
    </>
  );
}

async function Body({ data }: { data: Data }) {
  const x = await loadExtras(data.licenses);
  const m = computeMetrics(data);
  const revenue = Object.entries(m.revenueByCurrency);
  const monthNet = revenueByMonth(data.orders, data.now).at(-1)?.value ?? 0;
  const feed = buildActivity(data, x.feed);
  const tasks = buildTasks(m, x);
  return (
    <>
      <div className="mt-sections">
        <Link href="/store" className="mt-section">
          <span className="mt-section-ico"><Icon name="store" size={22} /></span>
          <h2>My Store</h2>
          <p>Sales, customers, licenses and installations.</p>
          <dl>
            <div><dt>Net revenue</dt><dd>{revenue.length ? revenue.map(([c, v]) => money(v, c)).join(" · ") : money(0)}</dd></div>
            <div><dt>This month</dt><dd>{money(monthNet)}</dd></div>
            <div><dt>Active licenses</dt><dd>{m.activeLicenses}</dd></div>
          </dl>
          <span className="mt-section-go">Open store dashboard <Icon name="arrow" size={14} /></span>
        </Link>
        <Link href="/automation" className="mt-section">
          <span className="mt-section-ico"><Icon name="automation" size={22} /></span>
          <h2>Operations</h2>
          <p>Automations, emails and customer onboarding.</p>
          <dl>
            <div><dt>Succeeded (30 days)</dt><dd>{x.runs.ok}</dd></div>
            <div><dt>Failed</dt><dd>{x.runs.failed}</dd></div>
            <div><dt>Setups finished</dt><dd>{x.completed}</dd></div>
          </dl>
          <span className="mt-section-go">Open automation <Icon name="arrow" size={14} /></span>
        </Link>
        <Link href="/workspace" className="mt-section">
          <span className="mt-section-ico"><Icon name="firms" size={22} /></span>
          <h2>My Workspace</h2>
          <p>Your own EFIN, the partner EROs attached to it, and the PTINs working under it.</p>
          <span className="mt-section-go">Open workspace <Icon name="arrow" size={14} /></span>
        </Link>
      </div>
      <ActivityAndAttention feed={feed} tasks={tasks} now={data.now} />
    </>
  );
}
