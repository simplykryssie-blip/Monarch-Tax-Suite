# Monarch commerce CRM: products, orders, licenses, installations

The admin workspace at `/` (Products, Customers, Orders, Licenses, Installations)
reads and writes the Monarch Supabase project only. The public storefront
(monarchtaxsuite.com) and the public calculator (`/basic-calculator`) are not
changed by this module.

## Architecture

- `lib/commerce/` — framework-free domain logic (catalog lifecycle, Stripe
  fulfillment, reconciliation, license keys, installation workflow) behind a
  `CommerceRepo` interface. `supabase-repo.ts` is the production store.
- `lib/admin.ts` — `requireAdmin()` (Supabase session + `admin_users` lookup with
  the service role) and the server-only service-role and Stripe clients.
- `app/(admin)/` — admin pages and server actions. Every page and action calls
  `requireAdmin()` itself; layouts are not relied on for authorization.
- `app/api/stripe/webhook/route.ts` — signature-verified Stripe webhook.

## Security model

- RLS is enabled on every commerce table and `anon`/`authenticated` have no
  grants. Only server code using the service role touches these tables.
- License keys (`MTS-XXXXX-XXXXX-XXXXX-XXXXX`) are shown once when issued; only a
  SHA-256 hash and a display prefix are stored.
- Paid access is granted only by a signature-verified Stripe event, or by an
  administrator reconciling a payment they verified (live Stripe lookup when
  `STRIPE_SECRET_KEY` is set; otherwise an explicit attestation is required and
  recorded as `admin_manual`).
- Webhook processing is idempotent: `stripe_events` records each event id, and
  unique keys on payment intent, order → license and order → installation
  prevent duplicates even across different events for the same payment.

## Setup

1. **Database.** (Applied to Monarch on 2026-10-09 as version 20261009044133.) `supabase/migrations/20261009044133_monarch_commerce_licensing.sql`
   to the Monarch project (`ftthniovwzxztkwtregz`) — Supabase SQL editor or
   `supabase db push`. It is re-runnable, extends the existing `calculator_*`
   tables without dropping anything, and aborts (changing nothing) if an
   existing table is incompatible. It seeds `info@monarchtaxsuite.com` as the
   administrator and the Basic Tax Calculator product as a draft.
2. **Environment (Vercel, server-only):**
   - `SUPABASE_SERVICE_ROLE_KEY` (already provided by the Supabase integration)
   - `STRIPE_SECRET_KEY` — use a test-mode key first
   - `STRIPE_WEBHOOK_SECRET` — from the webhook endpoint below
3. **Stripe webhook.** Endpoint `https://<domain>/api/stripe/webhook`, events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`,
   `payment_intent.succeeded`, `payment_intent.payment_failed`,
   `payment_intent.canceled`, `charge.refunded`, `charge.dispute.created`.
   Checkouts are matched to catalog products by Stripe product id. Set checkout
   metadata `installation_type=done_for_you` to record a Done For You purchase;
   otherwise self-service is recorded and can be changed on the installation.

## Tests

`npm test` runs `tests/*.test.ts` with Node's built-in runner against an
in-memory store that enforces the same unique constraints as the migration.

## Multi-platform installation

The calculator installs the same way everywhere: an `<iframe>` pointing at
`/embed/calculator?id=<embed id>`. The embed id is public (it is in page HTML);
the license key is never used in browser code.

- **Licensing is platform-neutral.** `proxy.ts` looks up the embed id and sets
  `Content-Security-Policy: frame-ancestors https://<authorized domains>`, so
  browsers render the calculator only on the license's authorized domains (and
  their www/apex variants). Inactive, unknown or domain-less licenses get
  `frame-ancestors 'none'`. The page also re-checks the Referer host.
- **`GET /api/license/validate?id=<embed id>&domain=<host>`** returns
  `{ valid: true }` or `{ valid: false, reason }` for any embedding method. It
  returns no customer or license details. The only failure reasons are
  `domain_not_authorized` and `unavailable` (an unknown id, an inactive license
  and a license with no domains look the same). Requests are rate limited per
  client address (60/min) and per embed id (600/min) with durable Postgres
  counters (migration `20261009200000_rate_limit_counters`, **not yet
  applied**); until it is applied the limiter fails open. Over the limit the
  response is `429` with `Retry-After`. Opening `/embed/calculator` directly in
  a browser tab is refused (`Sec-Fetch-Dest: document`); it renders only in a
  frame on an authorized domain.
- **Customer intake:** from an installation, an administrator creates a
  one-time link (`/install/<token>`, 14 days, only its hash is stored). The
  customer picks a platform, gives the page URL, domain and Self-Service / Done
  For You. Self-service customers with an active license get their domain
  authorized and their platform instructions + embed code immediately; Done For
  You requests stay "Requested" for the team. Installations are never marked
  Active automatically.
- **Checkout metadata** (optional): `installation_type`, `platform`
  (`gohighlevel|shopify|wix|jotform|custom_html|other`), `platform_other`,
  `website_url`, `domain`.

| Platform | Method | Status |
|---|---|---|
| GoHighLevel | Custom Code element with iframe | Generic embed — not yet verified on a live funnel |
| Shopify | Custom Liquid section with iframe | Awaiting compatibility testing (no native app) |
| Wix | Embed a Site (URL) | Awaiting testing; "Embed HTML" nests a Wix frame and is expected to be blocked by domain binding |
| Jotform | Iframe Embed widget (URL) | Awaiting testing; shared Jotform domains weaken domain binding; results are not form fields |
| Custom HTML | iframe | Generic embed — browser enforcement tested in Chromium; first live install pending |
| Other | iframe or URL | Generic embed, confirmed per installation |

Database values: `calculator_installations.platform` keeps the original
`ghl`/`website` values (`website` = custom HTML) and adds `shopify`, `wix`
(migration `20261009122229`).

## One-time purchase and paid annual tax-year updates

No subscriptions and no automatic charges anywhere. Checkout Sessions are
created only in `mode: "payment"`, and update prices are rejected unless they
are active, one-time, USD prices matching the version's configured price.

- **Versions** (`product_versions`, migration `20261009125750`): one row per
  tax year with status (draft / available / retired), release date, one-time
  update price ($50 default) and the Stripe one-time price id. A version can
  only be made available if the deployed calculator code contains that tax year
  (`lib/calculator/years.ts`); a CRM label alone never delivers code.
- **Licenses** record `original_tax_year` and `licensed_tax_year`. A purchase
  licenses the newest available version. The embed shows only tax years up to
  the licensed year, so releasing a new year does not upgrade anyone, and
  skipping an update keeps the current version. Retiring a version stops sales
  but never removes access.
- **Bug fixes / corrections** are recorded per version as "maintenance"
  changes. They ship in the deployed code for that tax year and are never
  charged.
- **Update purchase:** the customer enters their license key at `/update`
  (the key proves ownership; only its hash is stored), sees their version, the
  newest version and the one-time price, and is sent to Stripe Checkout. The
  session carries `purpose=annual_update`, `license_id`, `tax_year` set
  server-side. The signed webhook records a separate `annual_update` order
  linked to the license (never a second full purchase) and raises
  `licensed_tax_year`. Idempotent per event and payment intent.
- **Failed / pending** update payments change nothing. A **full refund or
  dispute of an update** reverts only that update (`version_reverted` event);
  the base license stays active. A full refund of the original purchase still
  revokes the license; a dispute of the purchase still suspends it.
- Payments whose amount does not match the version price are recorded with a
  "Review:" note and not applied automatically.

**Stripe setup still required** (not done: no Stripe key is configured):
1. In Stripe, confirm the calculator product `prod_VMBCU4J5IZb61R` and its
   approved one-time price.
2. Create a product "Monarch Basic Tax Calculator — Annual Tax-Year Update"
   with a one-time $50.00 USD price for each released tax year.
3. Paste that price id into the version in the CRM (Products → calculator →
   versions).
4. Add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in Vercel and subscribe
   the webhook to the events listed under Setup.

## Product management, images and preview

Migration `20261009132816_product_management_images` (applied to Monarch on
2026-10-09) adds product content fields (category, features, terms,
disclaimer, payment type, settings), Stripe sync tracking, the
`product_images` table and the `product-images` Storage bucket. Existing
product ids, Stripe ids and prices were preserved.

- **Products list** (`/products`): search by name, identifier or Stripe ID;
  filter by status and category; thumbnail, price, status, last updated; Edit,
  Preview and Duplicate.
- **Editor** (`/products/[id]`): all fields with a live desktop/mobile
  storefront preview, an unsaved-changes warning, the same validation as the
  server, and Save draft / Save & publish. Archive keeps orders, licenses and
  installations. Duplicate creates a draft without Stripe links.
- **Images:** JPG, PNG or WebP up to 4 MB (the hosting request limit is
  4.5 MB), at most 8 per product, with one primary image. The type is verified
  from the file bytes. Files are stored in Supabase Storage at
  `products/<product id>/<random uuid>.<ext>`, and the database holds only the
  path and metadata. The bucket is public-read. There are no `storage.objects`
  policies, so only server actions (service role, after `requireAdmin`) can
  upload, replace or delete.
- **Preview** (`/preview/product/[id]`): administrators only, `noindex`, with
  the purchase button disabled. It never publishes, creates orders or charges.
- **Storefront** (`/shop`, `/shop/[slug]`): published products only. Drafts,
  unpublished and archived products return 404. The purchase button uses the
  product setting `checkout_url` (https only) or falls back to a contact link.
- **Stripe sync is explicit.** Saving never calls Stripe. The Stripe panel
  has separate buttons:
  - **Update Stripe product info:** name, description, primary image and
    active flag. Prices are not touched.
  - **Create Stripe product:** refused if a product is already linked.
  - **Create Stripe price:** creates a new price and leaves the old one as it
    is; refused when the linked price already charges the catalog amount.

  Each result is recorded (`stripe_sync_status`, `stripe_synced_at`,
  `stripe_sync_error`) and shown. Idempotency keys prevent duplicates on
  double-submit. Orders are never rewritten.
- Products in category `software_update` are never fulfilled as a new
  license by the webhook. Annual updates go through `/update`.

## Calculator leads: direct to the buyer's own CRM (Monarch stores none)

Monarch sells, licenses and updates the calculator. It does not run a CRM,
lead inbox, email service, customer portal or lead history.

**Flow.** When a licensed calculator's buyer turns on the optional lead form,
a visitor's submission goes `browser → POST /api/leads → buyer's destination`
within the same request.
- **Processed:** first and last name, email and/or phone, consent, and
  (optional, disclosed on the form) tax year, filing status and estimated
  refund or amount owed.
- **Where and for how long:** in memory of one Vercel serverless invocation
  (iad1), for the duration of the request (at most about 30 s). It is never
  written to the database or to logs; request bodies are not logged.
- **If delivery fails:** the visitor sees "Nothing was saved, please try
  again". Their typed details stay in their own browser form. A retry reuses
  the same submission id: it is the webhook's `Idempotency-Key`, and
  HighLevel's duplicate check finds the contact created on the first attempt.
  There are no background retries.

**Destinations (buyer-owned, one per license).**
- **Webhook (available now).** Any HTTPS endpoint that accepts JSON: a CRM's
  inbound webhook, Zapier, Make, n8n, GoHighLevel workflow "Inbound Webhook",
  or the buyer's own server.
  - Body: `{event:"calculator.lead", id, submitted_at, source, website, tags,
    contact:{first_name,last_name,email,phone}, estimate|null, consent}`.
  - **Full calculator estimate.** The licensed embed serves the full 2026
    refund calculator (the one demonstrated to customers). When the form is on
    and "include estimate" is enabled, the body's `estimate` is the results
    computed on Monarch's server from the visitor's entries (the entries
    themselves are never forwarded or stored): `headline` (e.g. "Estimated
    Refund: $2,880"), `result` (`refund`|`owed`), `amount`,
    `estimated_federal_tax`, `withholding_plus_refundable_credits`, a
    `breakdown` object (income tax after child credit, self-employment tax,
    additional Medicare tax, EITC, refundable ACTC, Schedule 1-A deductions,
    standard deduction, AGI, taxable income; whole dollars), and `text`, a
    ready-to-email plain-text summary.
  - **Emailing results from GoHighLevel.** Create a workflow with the
    "Inbound Webhook" trigger, send one test lead, map `contact.*` and
    `estimate.*` fields, then add a "Send Email" action (to the visitor, to
    staff, or both) using the mapped values or `estimate.text`. Monarch does
    not send email itself.
  - Headers: `Idempotency-Key`, `X-Monarch-Timestamp`, and
    `X-Monarch-Signature: v1=HMAC_SHA256(secret, "<timestamp>.<body>")`.
  - Only public HTTPS hosts on port 443 are allowed (private and internal IPs
    are blocked after DNS resolution), redirects are not followed, and there
    is a 10 s timeout.
  - Tested with automated tests (signature, payload, isolation, failures). Not
    yet tested against a live Zapier, Make, n8n or GoHighLevel webhook.
- **GoHighLevel (OAuth, optional).** Off until a HighLevel Marketplace app is
  configured. The buyer authorizes their own sub-account.
  - By default an existing contact is found and left unchanged, else one is
    created; tags are added; an optional note is added.
  - Tokens are encrypted and refreshed under a DB lock.
  - Not tested against a real HighLevel account.

**Buyer setup without a portal.** At `/integrations` the buyer enters their
license key; each action re-checks it, and there is no account, session or
dashboard. From there they can:
- see their destination status;
- connect GoHighLevel or save a webhook (its signing secret is shown once);
- test or disconnect;
- configure the form (business name shown in the consent text, source, tags,
  estimate summary).

**What Monarch stores.**
- `crm_connections`: destination type, HighLevel location, webhook host.
  Credentials (tokens, webhook URL, signing secret) are stored as AES-256-GCM
  ciphertext bound to the license; the key is in `MONARCH_ENCRYPTION_KEY`.
- `crm_lead_settings`: form settings.
- `crm_oauth_states`: single-use, 10-minute OAuth states.
- `lead_delivery_log`: license, outcome, reason code, HTTP status and
  duration, with no personal data. A keyed IP hash is kept for rate limiting
  (5 per visitor per 10 min, 300 per license per hour) and cleared after
  24 h; rows are deleted after 30 days. This cleanup runs during normal
  requests, so no scheduled job exists.

All four tables have RLS on and service-role access only.

**Migrations.**
- `20261009174017_crm_direct_delivery`: applied.
- `20261009180000_remove_lead_storage`: drops the empty `calculator_leads`
  table, with a safeguard that refuses if any row exists. Pending the
  owner's confirmation; the app no longer uses that table.

**Setup and cost (no paid services added).**
- `MONARCH_ENCRYPTION_KEY` in Vercel (free; generate with
  `openssl rand -base64 32`). This is required for any lead destination.
- Optional, for GoHighLevel OAuth:
  - a HighLevel Marketplace developer app (Sub-Account distribution);
  - scopes `contacts.readonly contacts.write locations.readonly`;
  - redirect `https://monarch-tax-suite.vercel.app/api/integrations/crm/callback`;
  - `HIGHLEVEL_CLIENT_ID` / `HIGHLEVEL_CLIENT_SECRET` in Vercel.

  Monarch does not need its own HighLevel subscription for this; each buyer
  uses their own account. Whether a non-agency developer account can publish
  the app for other agencies is set by HighLevel's Marketplace rules; verify
  before relying on it.

## Stripe verification and annual update prices

Migration `20261009185026_stripe_verification` (applied, additive) adds
`stripe_verification` snapshots on `products` and `product_versions`, and the
`update_checkout_sessions` table.

- **Verify with Stripe** (Products → product → Stripe):
  - reads the configured Stripe product and price on the server;
  - records what Stripe reports (name, amount, currency, active,
    one-time/recurring, live/test mode) or the exact problems found. Problems
    include: not found, wrong product, wrong mode, archived, subscription,
    amount differs, invalid key, no permission, Stripe unreachable.

  Configured ids are never changed by verification. The panel shows whether
  the key is configured and its mode (live/test) without revealing it.
- **Annual version prices** (Products → calculator → versions):
  1. Add a draft version: tax year, label, release date, price.
  2. **Check Stripe price** verifies the linked price, or lists active
     one-time USD prices with the same amount on the single catalog product
     of category "annual software update" (`prod_VPRuMH3pwJVMiY`). It never
     links anything by itself.
  3. If exactly one matches, confirm to **link** it. If several match, review
     them and link the right one; nothing is guessed. If none matches, confirm
     to **create** one new price on that same product (never a new product),
     with an idempotency key per version and amount.
  4. **Publish** requires a Stripe-verified linked price that still matches
     the catalog price, plus a confirmation checkbox. Editing a version's price
     clears its verification.
- **Update checkout:**
  - The browser sends only the license key. The license, version, price and
    metadata are set by the server.
  - The linked price is re-verified live (product, active, one-time, USD,
    amount, mode) before every checkout; if Stripe cannot confirm it, checkout
    is refused.
  - An open session for the same license and tax year is reused; a completed
    one refuses a new charge. Concurrent clicks share a Stripe idempotency
    key.
  - Only active licenses may buy updates.
- **Webhook guards for updates:** the update is not applied, and the order
  gets a "Review: …" note for the admin, if:
  - the paid line item is not the Annual Update product;
  - a second, separate payment for an update the license already paid for
    (refund);
  - the amount, currency or tax year is wrong;
  - the license has been revoked.

## Webhook event mode guard

The webhook refuses (HTTP 400, nothing recorded) any signature-verified event
whose `livemode` does not match the mode of `STRIPE_SECRET_KEY`, and refuses
everything if the key's mode cannot be determined. A test-mode event therefore
cannot create an order or license on a live deployment, even if a test signing
secret is configured there by mistake. Use separate environments for test and
live (test key + test signing secret together, live key + live signing secret
together).

## Delivering a license to a customer (manual, secure)

Automatic license email is not built: the project has no email provider, and
Monarch-paid email delivery was intentionally removed. Until the owner approves
one, deliver licenses by hand:

1. A paid order appears under Orders with a pending license and installation.
2. Open the license → **Issue key**. The full key is shown **once** on that
   screen; only its hash is stored. Copy it straight into your reply to the
   customer. Re-issuing rotates the key and invalidates the old one.
3. Add the customer's domain under the license (Authorized domains).
4. Send the customer their key (for `/update` and `/integrations`), the embed
   snippet and the platform instructions from the installation page. The embed
   id is public; the key is never used in browser code.
5. Send it through a channel you control (your own email to the checkout
   address). Never paste keys into order notes, tickets or chat logs.

## Internal (complimentary) licenses: your own sites and partners

A license normally comes from a real Stripe payment. For the owner's own
GoHighLevel account or a partner, use **Orders → New internal license (no
payment)**. It is deliberately not a sale:

- It creates the customer, a **$0** order, a pending license and an installation
  request. The order has no payment reference (so no Stripe event can ever match,
  refund or dispute it), is marked "Internal · no payment" in the Orders list,
  and records who created it and why in its notes.
- Internal orders are **not** counted in the dashboard's paid orders or revenue.
- It does **not** issue a key or authorize a domain by itself. On the license page
  you press **Issue key** (shown once; copy it then) and authorize the domain,
  exactly as for a purchased license.
- Repeating the form for the same customer and product reuses the same order and
  license; it never creates a duplicate.
- A real customer who paid must still be recorded with **Reconcile a past purchase**
  using the real Stripe payment ID. Never use an internal license for a customer
  who paid, and never enter a made-up payment ID.

## Launch status and evidence

See [launch-checklist.md](launch-checklist.md).
