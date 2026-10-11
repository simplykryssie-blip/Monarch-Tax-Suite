import "server-only";
import { commerceRepo } from "./admin";
import { automationDeps } from "./automation/server";
import type { Alert } from "@/components/admin/shell";

/** Items that need the owner's action, for the bell menu. Each part degrades to zero if its data is unavailable. */
export async function loadAlerts(): Promise<Alert[]> {
  const repo = commerceRepo();
  const [licenses, installs, failed] = await Promise.all([
    repo.listLicenses().catch(() => []),
    repo.listInstallations().catch(() => []),
    automationDeps().repo.listExecutions({ status: "failed", limit: 100 }).catch(() => []),
  ]);
  const since = Date.now() - 30 * 86_400_000;
  return [
    { title: "Licenses waiting for a key", note: "Issue the key so the customer can set up", count: licenses.filter((l) => l.status === "pending").length, href: "/licenses" },
    { title: "Installations needing attention", note: "Requested, in progress or blocked", count: installs.filter((i) => i.status === "requested" || i.status === "in_progress" || i.status === "blocked").length, href: "/installations" },
    { title: "Automations that failed", note: "Emails or steps to retry (last 30 days)", count: failed.filter((e) => !e.is_test && Date.parse(e.created_at) >= since).length, href: "/automation/activity?status=failed" },
  ];
}
