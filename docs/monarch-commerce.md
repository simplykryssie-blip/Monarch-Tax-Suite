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

## Buyer-specific GoHighLevel lead delivery

Migration `20261009134819_crm_lead_integration` (applied to Monarch on
2026-10-09) adds `crm_oauth_states`, `crm_connections`, `crm_lead_settings`,
`calculator_leads` and three service-role-only SQL functions. RLS is on, and
anon/authenticated have no grants.

**How it works**
- **Buyer portal `/portal`.** The buyer signs in with their license key, the
  same proof of ownership as `/update`. The session is a signed HttpOnly cookie
  bound to the license and its key: it lasts 8 hours and ends if the key is
  rotated or the license revoked. From the portal the buyer can:
  - connect GoHighLevel through HighLevel's official OAuth location chooser and
    pick their sub-account;
  - test the connection, reconnect or change location, and disconnect;
  - set lead capture (business name, source, tags, estimate note, update
    existing contacts);
  - see delivery history and retry failed leads.
- **Tenant isolation.** Each license has at most one live connection, and
  OAuth state is single-use, expires in 10 minutes, and is bound to both the
  license and the browser (cookie). Only sub-account (Location) tokens are
  accepted, and the location is read back before the portal shows
  "Connected". Lead submissions can only reach the license named in a signed
  embed token, using that license's saved connection. No browser-supplied
  license, customer or location id is trusted.
- **Secrets.** HighLevel access and refresh tokens are encrypted with
  AES-256-GCM. The key is derived from `MONARCH_ENCRYPTION_KEY`, and the
  ciphertext is bound to its license and location. Tokens never reach the
  browser or logs. Refresh tokens are used under a database lock, so
  concurrent requests never spend one twice. A failed refresh marks the
  connection "Reauthorization required".
- **Lead form.** It appears in `/embed/calculator` only when the license is
  active, the buyer turned lead capture on, and the connection works. Fields
  are first name, last name, email and/or phone, plus required consent naming
  the buyer's business. A hidden honeypot field catches bots. Rate limits:
  5 per visitor IP (stored only as a keyed hash) per 10 minutes and 300 per
  license per hour. It is not a tax return intake: no SSNs and no income
  figures. With the buyer's opt-in, a note records the tax year, filing status
  and estimated refund or amount owed, and the form discloses this.
- **Contacts and duplicates.**
  - **Default:** look for a duplicate contact by email, then by phone. If one
    exists it is left unchanged; otherwise a contact is created.
  - **"Update existing" on:** HighLevel upsert, which follows the location's
    "Allow Duplicate Contact" setting.
  - **Tags** use the add-tags endpoint, because upsert would overwrite existing
    tags.
  - **Retries** reuse the contact already found or created.
- **Delivery and retries.** Leads are delivered right after the visitor's
  response. On 429, 5xx or network failure they retry with backoff (1m, 5m,
  15m, 1h, 4h, 12h, 24h; 8 attempts), then are marked "Delivery failed".
  Expired authorization holds leads until the buyer reconnects. Disconnecting
  deletes stored credentials, turns the form off, and marks pending leads
  failed. Statuses: Lead received, Sent successfully, Retry pending,
  Reauthorization required, Delivery failed.
- **Retention.** Contact details are deleted once delivered, and after 30 days
  if never delivered. Until then the buyer can view their own undelivered
  leads in the portal. Lead history (status and masked email) is deleted after
  365 days. A daily cron (`/api/cron/crm`, needs `CRON_SECRET`) runs retries
  and purges. Retries also run whenever a new lead arrives, when the buyer
  opens the portal, and on "Retry".
- **Platforms.** Delivery is server-side, so it is the same on every platform
  that can show the iframe embed (see the platform table). The form appears
  only on authorized domains.

**Setup required (not done yet)**
1. In the HighLevel Marketplace (marketplace.gohighlevel.com, developer
   account), create an app:
   - Distribution: Sub-Account.
   - Scopes: `contacts.readonly`, `contacts.write`, `locations.readonly`.
   - Redirect URL:
     `https://monarch-tax-suite.vercel.app/api/integrations/crm/callback`
     (or your custom domain + the same path).
   - Copy the Client ID and Client Secret.
2. In Vercel (project monarch-tax-suite → Settings → Environment Variables,
   Production, "Sensitive"):
   - `HIGHLEVEL_CLIENT_ID`, `HIGHLEVEL_CLIENT_SECRET`;
   - `MONARCH_ENCRYPTION_KEY` (generate with `openssl rand -base64 32`; keep a
     secure copy, because losing it means every buyer must reconnect);
   - `CRON_SECRET` (any long random string);
   - optional `HIGHLEVEL_REDIRECT_URI` if you use a custom domain.

   Then redeploy.
3. Test with two HighLevel test sub-accounts before inviting buyers.
