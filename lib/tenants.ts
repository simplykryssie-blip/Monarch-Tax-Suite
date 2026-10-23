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
 * The tenant the current request acts for. Only Monarch sells today, so every storefront, admin and webhook request
 * is Monarch's; Phase 2 replaces this with the signed-in member's tenant and, for payments, the tenant of the
 * Stripe account the event came from.
 */
export function currentTenantId(): string {
  return MONARCH_TENANT_ID;
}
