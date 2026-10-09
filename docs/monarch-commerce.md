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
  returns no customer or license details. (Not rate-limited yet.)
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
