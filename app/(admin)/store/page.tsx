import Link from "next/link";
import { commerceRepo, requireAdmin } from "@/lib/admin";
import { DashboardView } from "@/components/admin/dashboard-view";
import { loadExtras } from "@/lib/dashboard-data";
import { Icon } from "@/components/admin/icons";
import { load, SetupRequired } from "@/components/admin/ui";

const clock = () => new Date();

export default async function StoreDashboardPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await requireAdmin();
  const { range } = await searchParams;
  const months = range === "3" ? 3 : range === "6" ? 6 : 12;
  const repo = commerceRepo();
  const result = await load(async () => {
    const [customers, orders, products, licenses, installations] = await Promise.all([repo.listCustomers(), repo.listOrders(), repo.listProducts(), repo.listLicenses(), repo.listInstallations()]);
    return { customers, orders, products, licenses, installations };
  });
  const now = clock();
  return (
    <>
      <div className="mt-hero">
        <div>
          <div className="mt-eyebrow">MY OFFICE / MY STORE</div>
          <h1>My Store</h1>
          <p>Sales, licenses and installations. Every figure comes from recorded customers, verified payments and licenses. Select any card to open it.</p>
          <div className="mt-metal-rule" />
        </div>
        <div className="mt-actions">
          <Link className="monarch-primary" href="/orders/internal"><Icon name="plus" size={16} />New license</Link>
          <Link className="monarch-secondary" href="/orders/reconcile">Reconcile a payment</Link>
        </div>
      </div>
      {!result.ok ? <SetupRequired message={result.message} /> : <DashboardView data={{ ...result.data, now }} x={await loadExtras(result.data.licenses)} months={months} />}
    </>
  );
}

