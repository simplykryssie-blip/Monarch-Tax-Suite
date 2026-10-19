# Phase 2, Step 0: tenant foundation

Migration: `supabase/migrations/20261014090000_tenant_foundation.sql`
Verification gate: `supabase/tests/tenant_isolation.sql`, plus `tests/tenant-foundation.test.ts`

Nothing else from Phase 2 starts until the gate passes on the test project and the migration is on production.

## What changed

1. **`tenant_id` on every tenant table.** That covers all 45 tables: products, versions and changes, images, product files, download events, customers, orders, storefront and update checkouts, Stripe events, licenses and their events and domains, installations and their events, CRM connections, settings, OAuth states, leads and delivery log, automation templates, workflows, events, executions and audit log, onboarding links and profiles, all EFIN tables, audit events, and service orders and their events.
   - Existing rows are backfilled to Monarch (tenant #1). The column is NOT NULL, indexed, and has a foreign key to `tenants`.
   - `product_files` and `download_events` carry `tenant_id` directly, as well as their product link.
2. **New rows need a tenant.** The column default is `require_tenant_id()`. It uses the request's tenant and raises an error when there is none, so nothing is ever filed under a guessed tenant.
   - `tests/tenant-foundation.test.ts` fails if a later migration creates a table without `tenant_id` and a tenant policy, unless the table is on the short platform list.
3. **A row can only point at its own tenant's rows.** Every foreign key between tenant tables (62 of them) has a `(tenant_id, x_id)` twin. Not even the platform can link tenant A's order to tenant B's product.
4. **Per-tenant uniqueness** applies wherever a value is the tenant's own name for something: product slug; customer email, sign-in and Stripe customer; template, workflow and event keys; bureau options; people; EFINs; PTINs. Stripe ids and token hashes stay globally unique.
5. **`tenant_members`** (tenant, user, role owner/admin/staff) is seeded with the current administrators as Monarch owners.
6. **Row-level security scoped to the current tenant:**
   - **Server, tenant work.** Every server request sends `x-tenant-id`. Before each request, `pgrst_pre_request()` checks the tenant exists and switches the service role to `tenant_app`. Its policies return, change and accept only that tenant's rows. All commerce, storefront, webhook, automation, CRM, EFIN, install and update code now uses `tenantDb()`.
   - **Signed-in users.** A restrictive policy on every tenant table limits them to tenants they're members of. They still have no direct access to commerce tables, as before.
   - **Platform access** (service role with no tenant) is used in exactly two places: the `admin_users` lookup and the rate-limit counter. Each use is logged as a `platform_db_access` line. A test fails if any other code uses it.
   - The EFIN functions now run as the caller (`security invoker`), so they're scoped too.
7. **Automation defaults are per tenant.** `findTemplateByKey` and `findWorkflowByKey` run through the tenant client, so they see only the tenant's own rows. Once the old global indexes are dropped (below), each tenant installs its own independent copies under the same keys.

Platform-level tables, with no tenant: `tenants`, `admin_users`, `rate_limit_counters`.

`currentTenantId()` returns Monarch for every request today, since Monarch is the only seller. Phase 2 replaces it with the signed-in member's tenant, and for payments with the tenant of the Stripe account the event came from.

## Verification gate (test project, 2026-10-12)

Each check simulates a server request exactly as PostgREST runs it, inside a transaction that is rolled back. Two throwaway tenants, A and B, each hold a product, customer, order, license and checkout (example.com data only).

| Check | Products | Orders | Customers | Licenses | Checkouts |
|---|---|---|---|---|---|
| Server request runs as `tenant_app` | Pass | Pass | Pass | Pass | Pass |
| A reads B's rows: 0 visible | Pass | Pass | Pass | Pass | Pass |
| A lists: only A's rows | Pass | Pass | Pass | Pass | Pass |
| Signed-in user queries the table directly: no access | Pass | Pass | Pass | Pass | Pass |

| Check | Result |
|---|---|
| Insert without `tenant_id` gets the request's tenant | Pass |
| A inserts a row with B's `tenant_id` | Refused (pass) |
| Platform insert with no tenant | Refused (pass) |
| A's order pointing at B's product, even as platform | Refused (pass) |
| Anon request sending `x-tenant-id` | Stays anon (pass) |
| Service role with no header | Unchanged, platform (pass) |
| Unknown or malformed tenant id | Refused (pass) |
| Template key lookup in A | Finds only A's copy (pass) |
| Signed-in member of A sees B's memberships | 0 visible (pass) |
| Same template key installed in a second tenant | Pass |
| A updates, deletes or moves B's rows | Pass |

**Gate passed: 48/48.** The full `supabase/tests/tenant_isolation.sql` run, after the old global indexes were dropped on the test project, was done in the SQL editor on 2026-10-12.

**End to end on Preview (test project):** the Preview deployment of this branch serves `/shop` normally. `pg_stat_statements` shows PostgREST ran its product query as `tenant_app`, so the request hook switches roles for real API traffic, not only in the SQL simulation.

## Rollout

1. Test project: done, gate passed.
2. Preview: verified (above).
3. **Merge and deploy first.** The new code sends `x-tenant-id` on every request. Until the migration is applied the database ignores that header, so production behaves exactly as today.
4. **Then production, with your approval:** apply the migration in the SQL editor in one go. Order matters: code from before this change doesn't send a tenant, so once the migration is on, its inserts would be refused. Within the migration, turn the request hook on in the same transaction as the `tenant_id` defaults: the default takes the tenant from the hook, so in between, new rows are refused.

**Applied to production on 2026-10-12**, in parts. The hook went on about a minute after the defaults; the database logs show no refused writes in that window. Old global indexes were dropped in the SQL editor afterwards. Verified: the shop loads, admin reads and writes run as `tenant_app`, every Monarch row is visible to it, and the Stripe endpoint is unchanged.
5. Check that the storefront, admin, a test-mode checkout on Preview, and the webhook health card all work.

To roll back the request hook: `alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';`. The columns and backfill can stay.

## Tenant payments (item 7): recommendation

**Recommendation: Stripe Connect, with Standard connected accounts and direct charges.**

- **One platform webhook.** A Connect webhook endpoint on the platform account receives every connected account's events, each with an `account` field. The webhook maps `account` to a tenant (a `tenant_payment_accounts` table, unique on the Stripe account id) and processes the event as that tenant through `tenantClient(tenant)`. An unknown account is recorded and refused, never processed as Monarch.
- **Tenants keep their own Stripe dashboard, payouts, refunds and disputes.** With Standard accounts, the tenant is the merchant of record. The platform never holds their funds, and an application fee can be added later if the business wants one.
- **No customer secrets on the platform.** The alternative, tenants pasting their own API keys and webhook secrets, means storing every tenant's secret keys, one webhook endpoint and signing secret per tenant, and per-tenant key rotation. That's a much larger breach surface and more to support.
- **Monarch stays as it is.** Monarch keeps its own account (`acct_1UOUIFLvYOWPw48g`) as the platform. Its products remain direct sales on the platform account, routed to tenant #1. Nothing about today's live checkout changes.

**Webhook health under this model:** the check stays the same for Monarch's own endpoint. Phase 2 adds a second row for the Connect endpoint: present, enabled, `connect: true`, the same event list, pointing at the same URL. Each tenant's admin then shows "payments connected" from their account's `charges_enabled` and `details_submitted`.

This is a design decision for you; nothing in Step 0 depends on it.

## Noticed while inventorying (not changed)

- Production had no `rate_limit_counters` table or `hit_rate_limit` function, so every rate-limit call returned 404 and was allowed through. Applied to production on 2026-10-12 (see `docs/rate-limit-activation.md`).
- The test project was missing the automation and onboarding migrations; they're applied now so it matches production.
- `app/(app)/clients`, `engagements` and `tasks` query tables that exist in neither project (the older workspace prototype). They aren't tenant data today.
