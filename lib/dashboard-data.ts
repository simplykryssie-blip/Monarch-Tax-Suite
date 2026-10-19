import "server-only";
import { automationDeps } from "./automation/server";
import { crmDeps } from "./crm/server";
import type { License } from "./commerce/types.ts";
import type { Extras } from "@/components/admin/dashboard-view";

/** Onboarding and automation figures come from tables added later; if they are missing the section simply reads as empty. */
export async function loadExtras(licenses: License[]): Promise<Extras> {
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

