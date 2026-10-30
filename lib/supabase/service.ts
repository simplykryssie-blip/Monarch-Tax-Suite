import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, supabaseConfigProblems } from "./config";
import { TENANT_HEADER, tenantHeaders } from "../tenants.ts";

function serviceKey() {
  const problems = supabaseConfigProblems(process.env);
  if (problems.length) throw new Error(`Supabase is not configured: ${problems.join(" ")}`);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  return key;
}

/**
 * Database access for one tenant. Every request carries the tenant id, and the database runs it as the tenant_app
 * role (migration 20261014090000_tenant_foundation): row-level security returns, changes and accepts only that
 * tenant's rows, and rows inserted without a tenant_id get this tenant. Use this for all tenant data.
 */
export function tenantClient(tenantId: string) {
  return createClient(SUPABASE_URL, serviceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: tenantHeaders(tenantId) },
  });
}

export type PlatformAccessReason = "brand_host" | "admin_lookup" | "workspace_member" | "platform_audit" | "rate_limit" | "document_link" | "form_link" | "wisp_link" | "office_member" | "office_invite" | "sms_sweep" | "practice_member" | "practice_invite" | "practice_provision" | "scheduler_tick" | "portal_member" | "portal_invite" | "connect_webhook" | "site_host" | "campaign_token" | "suppression" | "sms_inbound" | "billing_webhook" | "billing_sweep" | "signup" | "default_host";

/**
 * Platform access: the service role without a tenant, which bypasses row-level security. Only for platform-level
 * tables (admin_users, rate_limit_counters, tenants), and to find which tenant a public document or form link belongs to.
 * Each use is logged with its reason. Inserting tenant data
 * through it fails, because tenant rows need a tenant.
 */
export function platformClient(reason: PlatformAccessReason) {
  console.info(JSON.stringify({ event: "platform_db_access", reason }));
  return createClient(SUPABASE_URL, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } });
}

export { TENANT_HEADER };
