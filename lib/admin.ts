import "server-only";
import { configuredOrigin } from "./origin.ts";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Stripe from "stripe";
import { createClient } from "./supabase/server";
import { platformClient, tenantClient } from "./supabase/service";
import { currentTenantId, MONARCH_TENANT_ID } from "./tenants.ts";
import { adminSeparationOn, isAdminHost, roleOpensWorkspace } from "./admin-host.ts";
import { decideAdmin } from "./commerce/authz.ts";
import { SupabaseCommerceRepo, SupabaseImageStore } from "./commerce/supabase-repo.ts";
import { SupabaseFileStore, SupabaseProductFilesRepo } from "./commerce/supabase-files.ts";
import { SupabaseServiceOrdersRepo } from "./commerce/supabase-services.ts";

/** Database access for the current tenant (row-level security scoped to it). */
export function tenantDb() {
  return tenantClient(currentTenantId());
}

export function commerceRepo() {
  return new SupabaseCommerceRepo(tenantDb());
}

/**
 * Image storage in the current tenant's own bucket (service role; call only after requireAdmin for writes). Addresses
 * are relative (/media/...) unless an origin is given; pass `await appOrigin()` where the address leaves the app.
 */
export function imageStore(origin = "") {
  return new SupabaseImageStore(tenantDb(), currentTenantId(), origin);
}

/** Service orders for the current tenant. */
export function serviceOrdersRepo() {
  return new SupabaseServiceOrdersRepo(tenantDb());
}

/** Product files (code bundles and other deliverables): private storage plus the file and download records. */
export function productFilesDeps() {
  const db = tenantDb();
  return { commerce: new SupabaseCommerceRepo(db), files: new SupabaseProductFilesRepo(db), store: new SupabaseFileStore(db) };
}

type AdminLookup = "yes" | "no" | "setup_missing";

async function lookupAdmin(userId: string): Promise<AdminLookup> {
  const { data, error } = await platformClient("admin_lookup").from("admin_users").select("user_id").eq("user_id", userId).maybeSingle();
  if (error) {
    // Missing table means the migration has not been applied: nobody is an admin yet.
    if (error.code === "42P01" || error.code === "PGRST205") return "setup_missing";
    throw new Error(error.message);
  }
  return data ? "yes" : "no";
}

/** Whether this account is a bureau administrator (used by the office area, where administrators oversee every office). */
export async function isAdminUser(userId: string): Promise<boolean> {
  return (await lookupAdmin(userId)) === "yes";
}

/** Whether this account is an owner or admin of the Monarch workspace (a tenant member, not a platform administrator). */
async function isMonarchMember(userId: string): Promise<boolean> {
  const { data, error } = await platformClient("workspace_member").from("tenant_members").select("role").eq("tenant_id", MONARCH_TENANT_ID).eq("user_id", userId).maybeSingle();
  if (error) return false;
  return roleOpensWorkspace((data as { role?: string } | null)?.role);
}

/** Whether this request arrived on the platform admin's own address. False whenever the separation is not switched on. */
export async function onAdminHost(): Promise<boolean> {
  if (!adminSeparationOn()) return false;
  const h = await headers();
  return isAdminHost(h.get("x-forwarded-host") ?? h.get("host"));
}

export type AdminSession = { userId: string; email: string };

/**
 * Verifies the signed-in user may use the Monarch workspace: an owner or admin of the Monarch tenant, or (until the
 * cutover to separate platform-admin sign-ins) an account still on the platform-admin list. Use in every workspace page
 * and server action. The platform's own pages use requirePlatformAdmin below.
 */
export const requireAdmin = cache(async (): Promise<AdminSession> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let setupMissing = false;
  const decision = await decideAdmin(user, async (id) => {
    const result = await lookupAdmin(id);
    setupMissing = result === "setup_missing";
    return result === "yes" || (result === "no" && (await isMonarchMember(id)));
  });
  if (!decision.allowed) {
    if (decision.reason === "unauthenticated") redirect("/login");
    // EROs and preparers sign in to the same app and work in the office area.
    if (user && !setupMissing) {
      const { data } = await platformClient("office_member").from("office_members").select("id").eq("user_id", user.id).maybeSingle();
      if (data) redirect("/office");
      // An independent PTIN holder works in their own workspace.
      const { data: holder } = await platformClient("practice_member").from("practice_members").select("id").eq("user_id", user.id).maybeSingle();
      if (holder) redirect("/practice");
      // A client of an office signs in to the same place and works in the client portal.
      const { data: portal } = await platformClient("portal_member").from("portal_members").select("id").eq("user_id", user.id).eq("status", "active").limit(1).maybeSingle();
      if (portal) redirect("/portal");
    }
    const message = setupMissing
      ? "Administrator access is not set up yet. Apply the commerce database migration."
      : "This account is not a platform administrator.";
    redirect("/login?error=" + encodeURIComponent(message));
  }
  return { userId: decision.userId, email: user?.email ?? "" };
});

/**
 * Verifies the signed-in user is a Verexa HQ platform administrator: the operator of the platform itself, not an admin of
 * a workspace (tenant). Every page and action under /admin uses this. Today `admin_users` is exactly that list; a
 * workspace's own administrators will be tenant members and are never in it, so they can neither see nor open these pages.
 */
export const requirePlatformAdmin = cache(async (): Promise<AdminSession> => {
  const session = await requireAdmin();
  const separated = adminSeparationOn();
  // With the separation on, the proxy already serves /admin only on the admin address; this is the second lock.
  if (separated && !(await onAdminHost())) redirect("/login?error=" + encodeURIComponent("The platform admin is not available at this address."));
  if (!(await isAdminUser(session.userId))) {
    // A workspace member on the admin address is told so (the login page shows the message), never sent in circles.
    redirect(separated ? "/login?error=" + encodeURIComponent("This account is not a platform administrator.") : "/");
  }
  return session;
});

/** Whether the signed-in user may use the Admin area (to decide whether to show it in the menu). Never throws. */
export async function isPlatformAdmin(): Promise<boolean> {
  try {
    const { data: { user } } = await (await createClient()).auth.getUser();
    return Boolean(user) && (await isAdminUser(user!.id));
  } catch {
    return false;
  }
}

/**
 * Public origin of this deployment (for embed, intake, form and email links). NEXT_PUBLIC_APP_URL (the production
 * domain) is used everywhere except Preview, where links must point at the preview deployment itself.
 */
export async function appOrigin(): Promise<string> {
  const configured = configuredOrigin(process.env);
  if (configured) return configured;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "monarch-tax-suite.vercel.app";
  return `https://${host}`;
}
