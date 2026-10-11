# Phase 1, step F3c: tracked service orders

Decisions applied:
- **E2:** services are fulfilled manually and are trackable, with no scheduling or calendar.
- **E4:** no service is sold until its deliverable, owner and response time are defined. Enforced at publishing since F2.

This is the last Phase 1 build item.

## What happens

1. **A buyer pays for a published service** through storefront checkout. The signed webhook creates **one service order** per order; Stripe redeliveries never create a second.
2. **The service order snapshots what was promised:** deliverable, owner and response time, copied from the product settings `service_deliverable`, `service_owner` and `service_response_time`. Later product edits never change it. Its first next step is "Contact the customer to confirm the details and start the work."
3. **Automation sends two emails** (new event `service.order_created`, workflow *Service order created*):
   - the customer gets what they'll receive, who is handling it, when to expect a response, and the next step;
   - the team (`AUTOMATION_ADMIN_EMAIL`, or the support address) gets a new-order notice.
4. **The owner works it in Admin → My Store → Service orders.**
   - Statuses: New → In progress ⇄ Waiting on customer → Delivered.
   - "Waiting on customer" requires a next step saying what the customer must do.
   - A delivered order can be reopened for a correction. Canceled is final.
   - Every change and note goes in the history. Open orders are listed first, each with its owner and next step.
5. **Marking it Delivered** sends the customer a completion notice (event `service.order_delivered`).
6. **A full refund or a dispute cancels an open service order.** A delivered one is left as it is.

A service gets no license. Software and the built-in calculator are unchanged.

## Tenant foundation (Phase 2 brief, rule 3)

Every new table carries `tenant_id` from day one. This migration creates the **`tenants`** table and seeds Monarch Tax Suite as tenant #1, with the fixed id `00000000-0000-4000-8000-000000000001` (also in `lib/tenants.ts`).

`service_orders` and `service_order_events` both carry `tenant_id`, and the admin list is scoped to the tenant. Phase 2 Step 0 then adds `tenant_id` to the existing tables and backfills them to that same row. Row-level security is on, with service role only, as for every commerce table; tenant-scoped policies come with Step 0.

## Rollout

1. Apply `supabase/migrations/20261013110000_service_orders.sql` to production. It's already on the test project. Until then, the Service orders page shows a setup notice, and a payment for a service product would return 500 so Stripe retries it; no service products exist yet.
2. Merge.
3. **Automation → Install defaults** adds the three new templates and two new workflows. It only adds what's missing and never overwrites your edits.
4. To sell a service: create a **Service** product with the three service settings, an image and a verified Stripe price, then publish.

## Test evidence (`npm test`, 335 passing; new cases in `tests/service-orders.test.ts`)

| Test case | Expected | Actual |
|---|---|---|
| Paid service, delivered twice by Stripe | One service order: tenant #1, snapshot of deliverable, owner and response time, first next step, one history entry, one automation event; no license | Pass |
| Product edited after purchase | Service order unchanged | Pass |
| Unpublished service paid | No service order; payment held for review | Pass |
| Refund, dispute | Open order canceled; delivered order untouched | Pass |
| Status changes | Allowed paths only; waiting on customer needs a next step; Delivered sets the date and clears the next step; reopen clears the date; Canceled is final; empty update refused; every change recorded with tenant #1 | Pass |
| Note only | Recorded in history | Pass |
| Emails (real engine and default workflows) | Customer: what, who, when and next step; team: new-order notice; delivered: completion notice | Pass |
| All earlier suites | Unchanged | Pass |
