# Platform-as-Monarch audit (flag only; nothing here is changed yet)

Owner principle: the platform is **Verexa HQ**. Monarch is a tenant and never presents as the platform owner.

Found where the platform speaks as Monarch (user-visible text, URLs, addresses):

- **Support address** `support@monarchtaxsuite.com`: `components/legal/legal-page.tsx` (SUPPORT_EMAIL), `lib/automation/template.ts`, `lib/automation/server.ts` (default), `app/integrations/page.tsx`, `app/shop/page.tsx`, `app/shop/[slug]/thank-you/page.tsx`, `components/storefront/product-view.tsx`.
- **Platform web address** `app.monarchtaxsuite.com`: `lib/site-meta.ts` (SITE_URL fallback, also used for the share image), `lib/efin/renewals.ts`, and the Vercel production domain itself.
- **Legal pages** (`/terms`, `/privacy`, `/refunds`) name "Monarch Tax Suite" as the party: `app/terms`, `app/privacy`, `app/refunds`, `components/legal/legal-page.tsx`.
- **Product and store copy** (Monarch's own store is legitimately Monarch's; the platform shell around it is not): `app/shop/**`, `app/downloads`, `app/update/**`, `app/install/[token]`, `app/setup/**`, `app/integrations/**`, `app/embed/calculator`, `app/preview/product`, `components/update`, `components/integrations`.
- **Statements** sent to offices say Monarch: `app/office/(area)/statement/download/route.ts`, `app/(admin)/fees/offices/[id]/statement/route.ts`.
- **Startup error page** `lib/supabase/proxy.ts`, `lib/supabase/config.ts`.
- **Stripe**: the one live key is Monarch's account. Decided: Verexa's revenue (SMS credits, number setup and renewals) moves to the Verexa HQ account; Monarch's store keeps a store-only key. Statement descriptors and checkout product names need checking when that moves.
- **Environment variable names** `MONARCH_*` are internal and need no change.
- **Email**: the sending domain for platform mail should be verexahq.com (it is verified in Resend).

Rule for new work (5.0, 5a onward): no new user-visible "Monarch" outside Monarch's own tenant pages. Checked for 5.0 and 5a: the only matches are code comments and an internal key-derivation label.
