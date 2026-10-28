import "server-only";
import { tenantClient } from "../supabase/service";
import { currentTenantId } from "../tenants.ts";
import type { StaffMember } from "./assign.ts";

const ROLES = new Set(["owner", "admin", "staff"]);

/** The people who work in this workspace, named by their profile name or, failing that, their email. Read-only. */
export async function listStaff(tenantId: string = currentTenantId()): Promise<StaffMember[]> {
  const db = tenantClient(tenantId);
  const { data, error } = await db.from("tenant_members").select("user_id, role").limit(100);
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as { user_id: string; role: string }[]).filter((r) => ROLES.has(r.role));
  const people = await Promise.all(rows.map(async (r): Promise<StaffMember | null> => {
    const { data: u } = await db.auth.admin.getUserById(r.user_id);
    if (!u?.user) return null;
    const meta = (u.user.user_metadata ?? {}) as { full_name?: unknown };
    const name = typeof meta.full_name === "string" && meta.full_name.trim() ? meta.full_name.trim() : u.user.email ?? "Teammate";
    return { id: r.user_id, label: name, role: r.role as StaffMember["role"] };
  }));
  return people.filter((p): p is StaffMember => p !== null).sort((a, b) => a.label.localeCompare(b.label));
}
