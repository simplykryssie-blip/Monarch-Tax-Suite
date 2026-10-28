import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { isAdminUser } from "../admin";
import { SupabaseCommerceRepo } from "../commerce/supabase-repo.ts";
import { createClient } from "../supabase/server";
import { tenantClient } from "../supabase/service";
import { MONARCH_TENANT_ID } from "../tenants.ts";
import { activeMemberships, type LabContext } from "./service.ts";
import { SupabaseLabRepo } from "./supabase-repo.ts";
import type { LabCommercePort } from "./types.ts";

// Server wiring for the Monarch Tax Lab (/lab). Training licenses are sold by the Monarch store, so all lab data lives
// in the Monarch tenant and every query runs as that tenant (row-level security). Who may do what is decided in
// service.ts from the signed-in account: its active lab membership, or Monarch administrator rights for the library.

export function labRepo() {
  return new SupabaseLabRepo(tenantClient(MONARCH_TENANT_ID));
}

export function labCommerce(): LabCommercePort {
  return new SupabaseCommerceRepo(tenantClient(MONARCH_TENANT_ID));
}

export async function currentUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/** Who is using the lab, or null when nobody is signed in. Looked up once per request. */
export const labContext = cache(async (): Promise<LabContext | null> => {
  const user = await currentUser();
  if (!user) return null;
  const [memberships, isAdmin] = await Promise.all([
    activeMemberships(labRepo(), user.id, new Date()).catch(() => []),
    isAdminUser(user.id).catch(() => false),
  ]);
  return { userId: user.id, email: user.email ?? "", isAdmin, membership: memberships[0] ?? null };
});

/** For every lab page: signed in, and either an active license or Monarch administrator rights. */
export async function requireLab(next = "/lab"): Promise<LabContext> {
  const ctx = await labContext();
  if (!ctx) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!ctx.membership && !ctx.isAdmin) redirect("/lab/activate");
  return ctx;
}

/** Whether the signed-in account has lab access (used to route sign-ins that are not workspace accounts). */
export async function hasLabAccess(userId: string): Promise<boolean> {
  try {
    return (await activeMemberships(labRepo(), userId, new Date())).length > 0;
  } catch {
    return false;
  }
}
