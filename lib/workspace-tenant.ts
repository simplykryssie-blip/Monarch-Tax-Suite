import { MONARCH_TENANT_ID } from "./tenants.ts";
import { roleOpensWorkspace } from "./admin-host.ts";

// Which workspace (tenant) a signed-in person opens, worked out from their own memberships. Pure, so it can be tested; the
// wiring is in lib/workspace-session.ts. Nothing the browser sends is an input here.

export type Membership = { tenant_id: string; role: string };
export type WorkspaceChoice = { tenantId: string; role: string };

/**
 * Today only Monarch's own people can open the workspace. Turning this on (with TENANT_STRICT in lib/tenants.ts) opens the
 * real workspace to every tenant's owners and admins. Both switch together, in the same change.
 */
export const WORKSPACES_OPEN_TO_ALL_TENANTS = false;

/**
 * The workspace a person opens: one of their memberships whose role opens a workspace (owner or admin; staff don't yet).
 * A platform administrator with no membership of their own keeps opening Monarch's, as before. With more than one usable
 * membership Monarch's comes first (nothing changes for the people who have it), then the lowest tenant id, so the answer
 * never depends on the order the rows came back in. Null: this person has no workspace to open.
 */
export function chooseWorkspace(input: { platformAdmin: boolean; memberships: Membership[]; openToAll?: boolean }): WorkspaceChoice | null {
  const open = input.openToAll ?? WORKSPACES_OPEN_TO_ALL_TENANTS;
  const usable = input.memberships.filter((m) => roleOpensWorkspace(m.role) && (open || m.tenant_id === MONARCH_TENANT_ID));
  if (usable.length === 0) return input.platformAdmin ? { tenantId: MONARCH_TENANT_ID, role: "admin" } : null;
  const monarch = usable.find((m) => m.tenant_id === MONARCH_TENANT_ID);
  const chosen = monarch ?? [...usable].sort((a, b) => a.tenant_id.localeCompare(b.tenant_id))[0];
  return { tenantId: chosen.tenant_id, role: chosen.role };
}
