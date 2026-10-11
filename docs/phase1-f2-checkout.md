# Phase 1, step F2: publishing rules and checkout checks

Date: 2026-10-11. Owner decision (2026-10-11): retire pasted `checkout_url` payment links; every purchase goes through checkout started by the server.

## What changed

| Area | Before | Now |
|---|---|---|
| Buying from /shop | A Stripe payment link pasted into the product's `checkout_url` setting | A **Purchase** button. The server starts the Stripe Checkout Session after checking that the product is published and sellable and that Stripe still confirms its price. |
| Terms and Refund Policy | Not recorded | The buyer must tick "I have read and accept…". The policy version (`LEGAL_VERSION` in `lib/legal.ts`) is recorded on the checkout and copied onto the order (`terms_version`, `terms_accepted_at`). Checkout is offered only while the legal pages are published. |
| Webhook | Fulfilled any paid checkout for a catalog product | Fulfils only a session the storefront recorded, for the same product, at the recorded amount and currency. Anything else (old payment links, a wrong amount, a different product) is kept as a paid order marked **Needs review**, with nothing delivered. |
| Abandoned checkouts | Invisible | Orders → **Storefront checkouts** lists every checkout started from the shop: open, abandoned or paid. |
| Unpublishing | Stripe product set inactive (F1) | Also closes the product's open checkouts, so a buyer who opened checkout earlier cannot pay. The webhook check stays as the backstop. |
| `checkout_url` setting | Shown as a buy link | Ignored by the storefront, and refused when a product is saved. |
| Checkout abuse | None | At most 10 checkout starts per visitor per minute. |

### Publishing rules (checked when publishing and again before every checkout)

Every product needs:
- a price, a linked Stripe product and a **Stripe-verified price** that matches the catalog price;
- a description and a product image.

Rules by type:

| Type | Rule |
|---|---|
| Software | Access type must be License, with at least one installation option. |
| Service | Needs `service_deliverable`, `service_owner` and `service_response_time` product settings (decision E4). |
| Course | Not publishable until course delivery is ready (decision E1). |
| Digital download | Not publishable until secure delivery exists (step F3). |
| Membership | Not publishable yet. |
| Recurring billing | Not publishable; checkout handles one-time payments only. |

While a product is published, edits still only need to keep it sellable: price, Stripe product and installation option.

## Rollout order (important)

1. **Migration applied to production on 2026-10-11** (`supabase/migrations/20261013090000_storefront_checkout.sql`), before merge. Verified afterwards: the table exists with row-level security on, both order columns exist, and the existing orders are untouched. The test project has it too.
2. Merge. Then, for the Basic calculator:
   - add an image;
   - check its Stripe price (**Verify Stripe mapping**, or create a price);
   - publish it.
3. **Retire links in circulation:**
   - In **live Stripe → Payment links**, find any link for these products and deactivate it.
   - Replace any copy of that link (emails, posts, QR codes) with the product page: `https://app.monarchtaxsuite.com/shop/monarch-basic-tax-calculator`.
   - Production has no `checkout_url` saved on any product (checked 2026-10-11).
   - Any payment that still arrives through an old link is held as **Needs review**.

## Refund Policy (owner's final decision, 2026-10-11)

- `/refunds` now states the owner's final policy word for word: all sales final, no refunds, exchanges or transfers, and license keys are not transferable.
- Terms section 6 (Transfers) now matches. It previously allowed transfers with written approval.
- `LEGAL_VERSION` is `2026-10-11`, so orders from now on record this text.
- The page keeps its "Draft for review" banner and counsel notes until counsel signs off.
- Both products' own Terms text in production was updated on 2026-10-11, at the owner's request, to the same policy: "All sales are final. Monarch Tax Suite does not offer refunds, exchanges, or transfers. License keys are issued to the purchaser only and may not be transferred to another individual or business." Their other paragraphs were left unchanged.

## Test evidence (`npm test`, 306 passing; new cases in `tests/storefront-checkout.test.ts`)

| Test case | Expected | Actual |
|---|---|---|
| Checkout started by the server | Price, metadata and return pages set by the server; checkout recorded with amount and Terms version | Pass |
| Terms not accepted | Refused, no Stripe session | Pass |
| Draft, unpublished, archived, unknown or update product (forged slug) | Refused with the same message, no session | Pass |
| Stripe price changed, archived, or Stripe unreachable | Refused, no session | Pass |
| Missing or invalid installation choice | Refused | Pass |
| Checkout could not be recorded | Session closed (expired) and refused | Pass |
| Storefront payment at the recorded amount | Fulfilled; Terms version on the order; checkout completed | Pass |
| Pasted payment link | Paid order marked Needs review; no license | Pass |
| Wrong amount or currency | Needs review; no license | Pass |
| Different product than the checkout | Needs review; no license | Pass |
| Stripe expires the session | Checkout shown as abandoned | Pass |
| Unpublish | Only that product's open checkouts are closed | Pass |
| Publishing rules (details, verified price, course, download, membership, recurring, software, service) | As in the table above | Pass |
| `checkout_url` setting | Refused on save | Pass |
| Buy form shown only while the legal pages are published | Guard present in page and action | Pass |
| Refund Policy and Terms carry the final policy; version 2026-10-11 (`legal-pages.test.ts`) | Final text present; old exceptions and transfer clause gone | Pass |
| All earlier suites (F1, webhooks, refunds, updates, onboarding) | Unchanged | Pass |
