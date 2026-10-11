import Link from "next/link";
import { commerceRepo, requireAdmin } from "@/lib/admin";
import { automationDeps } from "@/lib/automation/server";
import { crmDeps } from "@/lib/crm/server";
import type { License } from "@/lib/commerce/types.ts";
import { DashboardView, type Extras } from "@/components/admin/dashboard-view";
import { Icon } from "@/components/admin/icons";
import { load, SetupRequired } from "@/components/admin/ui";

const clock = () => new Date();

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await requireAdmin();
  const { range } = await searchParams;
  const months = range === "3" ? 3 : range === "6" ? 6 : 12;
  const repo = commerceRepo();
  const result = await load(async () => {
    const [customers, orders, products, licenses, installations] = await Promise.all([repo.listCustomers(), repo.listOrders(), repo.listProducts(), repo.listLicenses(), repo.listInstallations()]);
    return { customers, orders, products, licenses, installations };
  });
  const now = clock();
  const greeting = now.getUTCHours() < 12 ? "Good morning" : now.getUTCHours() < 18 ? "Good afternoon" : "Good evening";
  return (
    <>
      <div className="mt-hero">
        <div>
          <div className="mt-eyebrow">MY OFFICE / DASHBOARD</div>
          <h1>{greeting}.</h1>
          <p>Your business at a glance. Every figure comes from recorded customers, verified payments and licenses. Select any card to open it.</p>
          <div className="mt-metal-rule" />
        </div>
        <div className="mt-actions">
          <Link className="monarch-primary" href="/orders/internal"><Icon name="plus" size={16} />New license</Link>
          <Link className="monarch-secondary" href="/orders/reconcile">Reconcile a payment</Link>
        </div>
      </div>
      {!result.ok ? <SetupRequired message={result.message} /> : <DashboardView data={{ ...result.data, now }} x={await extras(result.data.licenses)} months={months} />}
    </>
  );
}

/** Onboarding and automation figures come from tables added later; if they are missing the section simply reads as empty. */
async function extras(licenses: License[]): Promise<Extras> {
  try {
    const auto = automationDeps();
    const crm = crmDeps();
    const ids = licenses.slice(0, 100).map((l) => l.id);
    const [domainLists, profiles, connections, executions] = await Promise.all([
      Promise.all(ids.map((id) => crm.commerce.listDomains(id))),
      Promise.all(ids.map((id) => auto.repo.getProfile(id))),
      Promise.all(ids.map((id) => crm.repo.getLiveConnection(id))),
      auto.repo.listExecutions({ limit: 200 }),
    ]);
    const workflows = new Map((await auto.repo.listWorkflows()).map((w) => [w.id, w.name]));
    const since = Date.now() - 30 * 86_400_000;
    const recent = executions.filter((e) => !e.is_test && Date.parse(e.created_at) >= since);
    return {
      domains: domainLists.filter((d) => d.some((x) => x.status === "active")).length,
      crm: connections.filter((c) => c && c.status === "connected" && c.last_checked_at && !c.last_error).length,
      completed: profiles.filter((p) => p?.completed_at).length,
      runs: { ok: recent.filter((e) => e.status === "succeeded").length, failed: recent.filter((e) => e.status === "failed").length, waiting: recent.filter((e) => e.status === "retrying" || e.status === "queued").length },
      available: true,
      feed: executions.filter((e) => !e.is_test && e.status !== "queued").slice(0, 12).map((e) => ({
        id: `x:${e.id}`,
        at: e.finished_at ?? e.created_at,
        kind: e.status === "failed" ? ("alert" as const) : ("email" as const),
        title: e.status === "failed" ? "Automation failed" : e.status === "retrying" ? "Automation retrying" : "Automation ran",
        detail: workflows.get(e.workflow_id) ?? "Workflow",
      })),
    };
  } catch {
    return { domains: 0, crm: 0, completed: 0, runs: { ok: 0, failed: 0, waiting: 0 }, available: false, feed: [] };
  }
}

