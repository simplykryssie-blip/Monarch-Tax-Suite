// The platform's sellers. Until Phase 2 Step 0 moves every table onto tenant_id, everything belongs to Monarch Tax
// Suite, tenant #1 (seeded with this fixed id by migration 20261013110000_service_orders.sql). New tables carry
// tenant_id from day one and take it from here, so the backfill has nothing to guess.
export const MONARCH_TENANT_ID = "00000000-0000-4000-8000-000000000001";
