# Phase 6: signup and billing

Self-serve signup and subscription billing on Verexa HQ's own Stripe account (not Connect, not the storefront). Built for all three plans; **self-serve signup is open for PTIN holders only** for now, because ERO and Service Bureau customers need a tenant-aware admin that does not exist yet (the main admin always acts as Monarch). ERO ($199) and Service Bureau ($299) are shown on the signup page as "contact us".

## The rules (the owner's, in `lib/billing/access.ts` and `plans.ts`)
- PTIN $99 / ERO $199 / Service Bureau $299 per month. No trial: the card is required and charged at signup.
- Before each renewal, at **7, 5 and 3 days out**, the card is checked (expiry before the renewal date, none on file) and any unpaid invoice is retried; a bad card gets a warning email.
- A renewal that fails → **suspended** (grace period, 7 days): everything works except messages and automations, and a banner asks for payment. Each day the unpaid invoice is retried.
- Day 7 → **read-only** (14 days): look and export, change nothing.
- Day 21 → **cancelled**; the subscription is cancelled in Stripe, and the **90-day retention clock** starts (`delete_after`). The deletion job itself is separate and needs its own approval (Piece 5).
- **Pause plan $27/month**: the subscription moves to the pause price from the next renewal (no charge or credit today); access is clients and contacts only; the data is not deleted. Resume moves it back.
- A cancelled workspace can **reactivate** within the 90 days by paying again; a payment made for another workspace, or for one that isn't cancelled, changes nothing.
- Monarch is on a free `internal` plan. A workspace with no subscription row isn't billed here (nothing changes for existing accounts).
- The day counts are the defaults in force until the owner changes them (one place: `access.ts`). Whether cancelling takes effect at once or at the end of the paid period is set in the Stripe portal (the setup script uses "at period end"). [To confirm]

## How it works
1. `/signup`: choose a plan, give name/email/workspace, agree to the four policies, pass the bot check (Cloudflare Turnstile). Rate limits per network (6/hour) and per email (3/hour). The answer is the same whether or not the email has an account.
2. An email link (signed, 24 hours, nothing stored) confirms the address and leads to the payment page: Stripe Checkout, subscription mode, card required.
3. Stripe's `checkout.session.completed` webhook makes the workspace (idempotent: a repeated event finds what it already made), records the subscription, and emails the owner the usual one-time link to set a password.
4. Other events: `invoice.paid` (back to normal), `invoice.payment_failed` on a renewal (suspend), `customer.subscription.updated/deleted` (sync, cancel). Each Stripe event is handled once (`billing_events`).
5. The daily `/api/automation/run` sweep moves late accounts along and does the pre-renewal checks. The five-minute tick skips messages/automations for suspended, read-only, paused and cancelled workspaces.
6. Billing page in the workspace (`/practice/billing`): plan, status, next payment, Stripe's portal (card, invoices, cancel), pause/resume, reactivate. A banner on every page explains the state. The gate lives in `requirePractice()`, so every page and action in the workspace (clients, prep, website, campaigns) obeys it.

## Data
`supabase/migrations/20261117090000_billing.sql`: `tenant_subscriptions` (one row per workspace) and `billing_events`. Both carry `tenant_id` and the tenant policies. The tenant role can **read its own subscription and nothing else**; only the platform's service access writes (the webhook and the sweep), so a workspace can never change its own plan or status. Gate: `supabase/tests/phase6_isolation.sql` (21 checks, all pass on the test project).

## Owner setup (nothing is charged until all of this is done)
1. In Stripe (test mode first), with the Verexa HQ platform account: `STRIPE_BILLING_SECRET_KEY=sk_test_… node scripts/billing-setup.mjs` creates the four prices (found by lookup key) and the customer-portal settings.
2. Add a webhook endpoint `<site>/api/stripe/billing-webhook` for `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`.
3. Vercel settings: `STRIPE_BILLING_SECRET_KEY` (or the existing `STRIPE_CONNECT_SECRET_KEY` is used), `STRIPE_BILLING_WEBHOOK_SECRET`, and for production `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`.
4. Production signup stays **closed** until the policies are approved (`PLATFORM_LEGAL_APPROVED`, see `lib/platform-legal.ts`) and the bot check is set up. On a Preview it is open with Stripe test cards (4242 4242 4242 4242).
5. Emails come from the platform's sending address (`MONARCH_EMAIL_FROM`, to be set to a verexahq.com address at cutover). Outside production only `AUTOMATION_TEST_RECIPIENTS` receive them.

## Not built (by design)
- ERO and Service Bureau self-serve signup (needs the tenant-aware admin) and plan changes between tiers (the portal's plan switching is switched off).
- The 90-day deletion job (Piece 5, dry-run first, own approval).
- A platform-admin list of subscriptions (the data is in `tenant_subscriptions`).
