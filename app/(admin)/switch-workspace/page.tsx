import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { PageTitle } from "@/components/admin/ui";
import { platformClient } from "@/lib/supabase/service";
import { workspaceMemberships } from "@/lib/workspace-session";
import { workspacesOpenToAll } from "@/lib/workspace-tenant.ts";
import { switchWorkspaceAction } from "./actions";

/** Preview only: an account that belongs to more than one workspace chooses which one to work in. */
export default async function SwitchWorkspacePage() {
  if (!workspacesOpenToAll()) notFound();
  const admin = await requireAdmin();
  const memberships = await workspaceMemberships(admin.userId);
  const { data } = memberships.length ? await platformClient("practice_member").from("tenants").select("id, name, tier").in("id", memberships.map((m) => m.tenant_id)) : { data: [] };
  const names = new Map(((data ?? []) as { id: string; name: string; tier: string }[]).map((t) => [t.id, t]));
  return (
    <>
      <PageTitle title="Choose a workspace">You belong to more than one workspace. The one marked Current is open now.</PageTitle>
      <section className="monarch-panel" style={{ padding: 20 }}>
        {memberships.map((m) => {
          const t = names.get(m.tenant_id);
          return (
            <form key={m.tenant_id} action={switchWorkspaceAction} className="monarch-inline-form" style={{ marginBottom: 10 }}>
              <input type="hidden" name="tenant" value={m.tenant_id} />
              <b>{t?.name ?? "Workspace"}</b> <small className="monarch-muted">{t?.tier ?? ""} · {m.role}</small>{" "}
              {m.tenant_id === admin.tenantId ? <small>Current</small> : <button className="monarch-secondary">Open this workspace</button>}
            </form>
          );
        })}
      </section>
    </>
  );
}
