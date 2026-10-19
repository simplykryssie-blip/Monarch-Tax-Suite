# Phase 6, Piece 1 and 4: rebrand audit

The platform is **Verexa HQ** (`support@verexahq.com`, `verexahq.com`). **Monarch Tax Suite** is tenant #1: a customer of the platform with its own storefront, calculators, emails and data. This is the list of what changed and what stays.

## Changed (the platform is speaking)
- `lib/platform-brand.ts`: new `PLATFORM_SUPPORT_EMAIL` and `PLATFORM_DOMAIN`; every platform default points at them.
- `support@monarchtaxsuite.com` → `support@verexahq.com`: legal page contact (`components/legal/legal-page.tsx`), the platform's default support address (`lib/automation/server.ts`; `MONARCH_SUPPORT_EMAIL` still overrides it), the shop and product "contact us" links.
- Sample support address in the email-variable preview is now a neutral example, and the variable descriptions no longer name Monarch.
- Default email look (a caller that passes no brand) is the platform's (`VEREXA HQ`).
- Link previews and tab titles: `lib/site-meta.ts` uses the platform name, image and domain by default. The fallback site address is `https://verexahq.com` (the `NEXT_PUBLIC_APP_URL` setting still wins).
- Operator messages: "Monarch administrator" → "platform administrator"; "Monarch Supabase project / commerce tables" → neutral; the "cannot start" page says Verexa HQ.
- EFIN pages and renewal emails say "Verexa HQ does not read live IRS status".
- Fee schedule: "Monarch's template" → "the starter template" (every office sees this screen).
- Fallback names when an office has no profile name: statements, compliance exports, office emails, the WISP page now say "Your office" / "Verexa HQ" instead of "Monarch Tax Suite".
- Small wording: product category "Monarch product" → "Product"; image manager and catalog hints.

## Stays (Monarch's own data and products)
- Tenant #1's brand in `TENANT_BRANDS` (name, logo mark), its firm profile (including its profile email, set by an early migration), its brand row and sender domains.
- The Monarch Basic Tax Calculator, its licences, install/setup/update/integration pages (`/shop`, `/downloads`, `/install`, `/update`, `/integrations`, `/setup`, `/embed/calculator`) and every customer message about them ("contact Monarch Tax Suite", "your Monarch license").
- Default automation templates for calculator purchases (`lib/automation/defaults.ts`) and the GoHighLevel lead integration (`lib/crm/*`: source "Monarch Tax Calculator", the webhook header names, the "Monarch Connection Test" contact).
- `/shop/<product>` link previews keep Monarch's name and image (`MONARCH_SHARE_BRAND`).
- Environment variable names (`MONARCH_*`), the `monarch-*` CSS class names, the `MONARCH_TENANT_ID` constant and code comments. Renaming these gains nothing and risks breaking deployments.
- Old tests, docs and migrations that describe history.

## Open for the next pieces
- `/terms`, `/privacy`, `/refunds` still describe Monarch's calculator business; they are rewritten in the policies piece (placeholder text, unpublished).
- Tenant-aware storefront titles (a second tenant's shop would still say "| Monarch Tax Suite" in the tab) belong to the multi-tenant store follow-up.

## Piece 4 cleanups
- **Resend:** `verexahq.com` is Verified, sending and receiving enabled. Separately, `mkbfinancialgroup.com` shows status **failed** in Resend; that is Monarch's own sending domain, so its DNS records need re-checking by the owner.
- **Stripe statement name "Monarch Tax Suit":** not set anywhere in the code. It is the account's statement descriptor in the Stripe dashboard (Settings → Business → Public details). Owner-side.
- **Supabase project name "Monarch Tax Calculator":** renaming is a dashboard action (Project settings → General); the connector can't rename. Owner-side, safe at any time (the project id and URL do not change).

## Owner-side cutover (separate approval, not part of this PR)
DNS for `verexahq.com`, adding it to the Vercel project, `NEXT_PUBLIC_APP_URL`, Supabase auth redirect URLs, Stripe webhook endpoints (platform and Connect), GoHighLevel and Stripe Connect OAuth redirect addresses, the Resend webhook, and `MONARCH_EMAIL_FROM` / `MONARCH_SUPPORT_EMAIL`.
