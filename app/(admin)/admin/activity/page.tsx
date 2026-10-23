import { requirePlatformAdmin } from "@/lib/admin";
import { PageTitle } from "@/components/admin/ui";
import { PLATFORM_ACTION_LABEL } from "@/lib/platform-audit.ts";
import { recentPlatformActivity } from "@/lib/platform-audit-server";
import { platformClient } from "@/lib/supabase/service";
import { PLATFORM_TENANT_ID } from "@/lib/tenants.ts";

const when = (iso: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" }).format(new Date(iso));

/** What platform administrators have done, newest first. Append-only: entries cannot be changed or removed. */
export default async function ActivityPage() {
  const me = await requirePlatformAdmin();
  const rows = await recentPlatformActivity(100).catch(() => null);
  const ids = [...new Set((rows ?? []).map((r) => r.tenant_id))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data } = await platformClient("platform_audit").from("tenants").select("id, name").in("id", ids);
    for (const t of (data ?? []) as { id: string; name: string }[]) names.set(t.id, t.name);
  }
  return (
    <>
      <PageTitle title="Activity">Everything platform administrators have done, newest first. Entries are append-only.</PageTitle>
      <section className="monarch-panel"><div className="monarch-table-wrap"><table><thead><tr><th>WHEN (CENTRAL)</th><th>ACTION</th><th>WORKSPACE</th><th>BY</th><th>DETAILS</th></tr></thead><tbody>
        {rows === null && <tr><td colSpan={5}>The activity log couldn&apos;t be read. Nothing was changed.</td></tr>}
        {rows?.length === 0 && <tr><td colSpan={5}>No platform actions recorded yet.</td></tr>}
        {rows?.map((r) => (
          <tr key={r.id}>
            <td style={{ whiteSpace: "nowrap" }}>{when(r.created_at)}</td>
            <td>{PLATFORM_ACTION_LABEL[r.action]}</td>
            <td>{r.tenant_id === PLATFORM_TENANT_ID ? "Verexa HQ (platform)" : names.get(r.tenant_id) ?? "Unknown"}</td>
            <td>{r.actor_id === me.userId ? "You" : r.actor_id ? r.actor_id.slice(0, 8) : "System"}</td>
            <td style={{ whiteSpace: "normal" }}>{Object.entries(r.detail ?? {}).map(([k, v]) => `${k}: ${v}`).join(" · ")}</td>
          </tr>
        ))}
      </tbody></table></div></section>
    </>
  );
}
