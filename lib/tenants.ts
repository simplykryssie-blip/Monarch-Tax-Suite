// The platform's sellers. Monarch Tax Suite is tenant #1 (seeded with this fixed id by migration
// 20261013110000_service_orders.sql). Every tenant table carries tenant_id (migration 20261014090000_tenant_foundation).
export const MONARCH_TENANT_ID = "00000000-0000-4000-8000-000000000001";

/** Verexa HQ itself: the home of audit entries for platform-wide actions. Not a workspace (see migration 20261118090000). */
export const PLATFORM_TENANT_ID = "00000000-0000-4000-8000-000000000002";

/** Request header that tells the database which tenant a server request acts for (see public.pgrst_pre_request). */
export const TENANT_HEADER = "x-tenant-id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function tenantHeaders(tenantId: string): Record<string, string> {
  if (!UUID.test(tenantId)) throw new Error("A tenant id is required for tenant data access.");
  return { [TENANT_HEADER]: tenantId };
}

/**
 * Un-hardwiring Monarch (Messages 148-151). The workspace asks "which tenant is this request for?" through currentTenantId().
 * The answer comes from the signed-in person's own membership (lib/workspace-session.ts registers the resolver and the
 * workspace gate fills it in); it never comes from anything the browser sends.
 *
 * While TENANT_STRICT is false (today: only Monarch's own people can open the workspace) a request with no resolved tenant
 * still acts for Monarch, exactly as before. When the workspace opens to other tenants TENANT_STRICT turns on and an
 * unresolved request is an error, never Monarch's data. Code that is deliberately Monarch's own (its store, WISP, Tax Lab,
 * webhooks) names MONARCH_TENANT_ID itself instead of calling this.
 */
export const TENANT_STRICT = false;

type Resolver = () => string | null;
let resolver: Resolver | null = null;

/** Registered once by the server session module: reads the tenant the workspace gate resolved for this request. */
export function setTenantResolver(fn: Resolver | null) {
  resolver = fn;
}

/** The decision itself, pure so it can be tested: a resolved tenant wins; otherwise Monarch (loose) or an error (strict). */
export function pickTenant(resolved: string | null | undefined, strict: boolean): string {
  if (resolved) {
    if (!UUID.test(resolved)) throw new Error("A tenant id is required for tenant data access.");
    return resolved;
  }
  if (strict) throw new Error("No workspace is resolved for this request, so it cannot act for any tenant.");
  return MONARCH_TENANT_ID;
}

export function currentTenantId(): string {
  return pickTenant(resolver ? resolver() : null, TENANT_STRICT);
}
