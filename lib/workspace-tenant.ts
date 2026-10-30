import { MONARCH_TENANT_ID } from "./tenants.ts";
import { roleOpensWorkspace } from "./admin-host.ts";

// Which workspace (tenant) a signed-in person opens, worked out from their own memberships. Pure, so it can be tested; the
// wiring is in lib/workspace-session.ts. Nothing the browser sends is an input here.

export type Membership = { tenant_id: string; role: string };
export type WorkspaceChoice = { tenantId: string; role: string };

/**
 * Whether every tenant's owners and admins can open the real workspace, not only Monarch's people. Step 2 of the real-workspace
 * plan turns this on for **Preview only**, so a real PTIN tenant can be walked there; production stays closed until the
 * remaining batches (the tenant-aware daily features, the store, background jobs) have been walked and Krystal says go.
 */
export const workspacesOpenToAll = (env: Record<string, string | undefined> = process.env): boolean => env.VERCEL_ENV === "preview";

/**
 * The workspace a person opens: one of their memberships whose role opens a workspace (owner or admin; staff don't yet).
 * A platform administrator with no membership of their own keeps opening Monarch's, as before. With more than one usable
 * membership Monarch's comes first (nothing changes for the people who have it), then the lowest tenant id, so the answer
 * never depends on the order the rows came back in. A chosen workspace (`preferred`) wins when it is one of their usable memberships.
 * Null: this person has no workspace to open.
 */
export function chooseWorkspace(input: { platformAdmin: boolean; memberships: Membership[]; openToAll?: boolean; preferred?: string | null }): WorkspaceChoice | null {
  const open = input.openToAll ?? workspacesOpenToAll();
  const usable = input.memberships.filter((m) => roleOpensWorkspace(m.role) && (open || m.tenant_id === MONARCH_TENANT_ID));
  if (usable.length === 0) return input.platformAdmin ? { tenantId: MONARCH_TENANT_ID, role: "admin" } : null;
  // A person who belongs to more than one workspace (Preview only) may have chosen one of them; it counts only if it is one of theirs.
  const preferred = input.preferred ? usable.find((m) => m.tenant_id === input.preferred) : undefined;
  if (preferred) return { tenantId: preferred.tenant_id, role: preferred.role };
  const monarch = usable.find((m) => m.tenant_id === MONARCH_TENANT_ID);
  const chosen = monarch ?? [...usable].sort((a, b) => a.tenant_id.localeCompare(b.tenant_id))[0];
  return { tenantId: chosen.tenant_id, role: chosen.role };
}
