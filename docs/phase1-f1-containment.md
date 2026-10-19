# Phase 1, step F1: containing active risks (M4, M3)

Date: 2026-10-11. Production project `ftthniovwzxztkwtregz`. Production data was only read; nothing was changed or deleted.

## What production shows

### M4: the $75 "paid" order on a draft product (order #1005)
- Order #1005 is **not a storefront sale**. It was recorded by an administrator through **Reconcile purchase** on 2026-10-09 (`verification_method = admin_manual`), for a payment taken in Monarch's previous Stripe account. Its notes say so.
- Both catalog products are `draft` and neither has a checkout URL, so the storefront has never had a live purchase path.
- The real gap was in code: Stripe products stayed **active** unless archived, and the webhook fulfilled any matching paid checkout **without checking publish status**. An old payment link, or a checkout opened before a product was unpublished, could therefore still create a license.
- Remediation for #1005: none needed. It records a real historical payment and is kept as is.

### M3: the "duplicate" welcome/setup emails
The Automation Center ran three setup emails (template "Onboarding: welcome and setup link"), all from the workflow **Setup email requested again**:

| When (UTC) | License | Requested by | Result |
|---|---|---|---|
| 2026-10-10 22:15 | test license (internal) | administrator | no run (default workflows were installed at 22:20) |
| 2026-10-10 22:36 | test license (internal) | administrator | sent |
| 2026-10-10 22:40 | test license (internal) | customer form "send me a new link" | sent |
| 2026-10-11 00:08 | license for order #1005 | administrator | sent |

- Each email answered a separate request (the audit log has one entry per request). None came from a replayed event or a retried job: event keys, one-run-per-event and the provider idempotency key all held.
- The real gap: resend requests were keyed by the click time, so a **double-click, or an administrator and the customer asking at the same moment, would send two emails**. The 3-per-hour limit did not prevent that.
- Delivery could not be confirmed. The Resend account connected to this session does not have these message ids, so production sends through a different Resend account. Check them there: `01a127f5-9ee6-7213-9e71-92490fda960f`, `01a127f9-e15e-76dd-b141-4c7d62f74b9b`, `01a1284a-7fcd-7e6f-8557-f32e9704b9a8`.

## What changed

| Area | Change |
|---|---|
| Stripe availability | Only a **published** product is active in Stripe. Every status change (publish, unpublish, archive, Save & publish) now sets the Stripe product active or inactive and reports the result. A Stripe failure is shown as a warning and never undoes the status change. "Update Stripe product info" sends the same flag. |
| Webhook, purchases | Publish status is checked **again when the payment arrives** (checkout completed, async success, `payment_intent.succeeded`). A paid order for a draft, unpublished or archived product is recorded with a `Review:` note: no license, no installation, no onboarding email. |
| Webhook, annual updates | An update paid after the update product was unpublished is flagged `Review:` and not applied. |
| Update checkout (/update) | No checkout starts unless the Annual Tax-Year Update product is published. |
| Storefront | Annual update products are never listed in /shop (they are sold only through /update; a /shop purchase of one is never fulfilled). |
| Orders list | Orders flagged `Review:` show **Needs review** with the reason. |
| Setup resends | Keyed by the license's newest setup link, so concurrent requests produce one email. After that email goes out (with a new link), the next request is a genuine new one. A request whose email failed before a link was made does not block the next one. The administrator sees "already requested, no second copy was sent". |

### Before deploying
- **Publish the products you mean to sell.** Both products are drafts. After this change their Stripe products go inactive on the next status change or sync, and any payment for a draft is held for review. Publish the Annual Tax-Year Update product before the first 2027 update goes on sale.
- The existing Stripe products are not changed by the deploy itself. To make a draft inactive in Stripe now, open the product and use **Update Stripe product info**.
- Still to verify in Stripe test mode: that a payment link for an inactive product refuses payment.

## Test evidence (`npm test`, 287 passing)

| Test case | Expected | Actual |
|---|---|---|
| Payment for a draft product (`commerce.test.ts`, "M4: a payment for a draft product…") | Order kept as paid with `Review:` note; no license, installation or email; replays deliver nothing | Pass |
| Product unpublished after checkout opened, then archived ("M4: a product unpublished…") | Not fulfilled when payment arrives; `Review:` note names the status | Pass |
| Published product ("M4: a published product is still fulfilled normally") | Fulfilled as before | Pass |
| Stripe active flag follows every status change (`product-management.test.ts`) | Active only while published; unlinked products skipped | Pass |
| Stripe deactivation fails | Failure recorded; status change stands | Pass |
| Update product unpublished or archived (`stripe-verify.test.ts`) | No update checkout starts | Pass |
| Update paid after update product unpublished | `Review:` note; license not upgraded | Pass |
| Annual update product, published (`product-management.test.ts`) | Purchasable, but not listed in /shop | Pass |
| Double-click / admin + customer at once (`onboarding.test.ts`, "M3: …") | One setup email | Pass |
| Resend after an email that failed before a link was made | The next request still sends | Pass |
| Existing suites (duplicate webhooks, retries, throttle, refunds) | Unchanged behaviour | Pass |

## Not in F1 (later steps)
- Manual **Reconcile purchase** and **internal license** still accept draft products. These are administrator records of real or complimentary access, not sales; whether to restrict them is a B2 decision.
- Event-level dedupe for every workflow and the per-workflow review is step 7 (Section C).
- A "needs review" item in the attention count belongs to M5.
