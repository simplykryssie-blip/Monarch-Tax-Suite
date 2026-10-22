# Part 1 — Platform vs tenant classification (owner decisions recorded 2026-10-22)

Prepared 2026-10-22 from a read-only pass over the code at `bd01830` (default branch). Nothing has been moved, renamed or built. Per the owner brief, nothing is reclassified silently: every row below is a proposal until Krystal marks it.

Legend: **P** = platform (Verexa HQ owns it; belongs behind admin.verexahq.com). **T** = tenant (each workspace owns its own, Monarch included). **C** = coupled today (platform and Monarch-the-tenant share one thing); needs a decision.

## A. Headline findings

1. **Monarch's whole workspace is gated by the platform-admin list.** Every Monarch page (Leads, Store, Automation, Forms, Campaigns, Settings, Website, Service Bureau) calls `requireAdmin`, which checks the `admin_users` table. There is one row: info@monarchtaxsuite.com. So "Monarch owner" and "platform admin" are the same login by construction, not by habit. The Admin tab (`requirePlatformAdmin`) uses the same list. Separation means Monarch's owner must stop being in `admin_users` and instead sign in to Monarch as an ordinary tenant member.
2. **The admin app is hard-wired to tenant #1.** `currentTenantId()` always returns Monarch's id. Every Monarch page, store, webhook and cron job acts for Monarch only.
3. **All platform emails go out through Monarch's sender.** Billing sends the welcome email, payment-failed, reminders and cancellation through `sendOfficeEmail(MONARCH_TENANT_ID, …)`. If Monarch's sending setup changes, platform email changes with it.
4. **The platform sender address is stored as Monarch's.** `MONARCH_EMAIL_FROM` / `MONARCH_EMAIL_REPLY_TO` are used only as tenant #1's fallback sender (`platformSender()` returns nothing for any other tenant).
5. **One Twilio account is both things.** The Twilio account in the environment is documented in code as "tenant #1's account and the parent of every tenant subaccount." Monarch texts from the parent; tenants get subaccounts under it.
6. **Monarch's own store Stripe account lives in global environment variables.** `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` are Monarch's storefront account, not Verexa's billing or Connect accounts, but they are held as platform-wide variables.
7. **Naming carries the coupling.** The platform master encryption key is `MONARCH_ENCRYPTION_KEY`, the support contact is `MONARCH_SUPPORT_EMAIL`, and the test-recipient guard and admin email are in the `AUTOMATION_*` family.

## B. Environment settings

| Setting | What it is | Proposed | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Database access | P | Infrastructure |
| `MONARCH_ENCRYPTION_KEY` (+ `_CURRENT`) | Master key that wraps every tenant's data keys, license and link secrets | P | Name says Monarch; it protects all tenants. Rename candidate (value must not change) |
| `CRON_SECRET` | Authorizes the scheduler endpoints | P | |
| `STRIPE_BILLING_SECRET_KEY`, `STRIPE_BILLING_WEBHOOK_SECRET` | Verexa's own subscription billing account | P | |
| `STRIPE_CONNECT_SECRET_KEY`, `STRIPE_CONNECT_CLIENT_ID`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `STRIPE_CONNECT_REDIRECT_BASE` | Verexa's Connect platform; tenants link their own Stripe through it | P | Each tenant's linked account is tenant data (T) |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Signup bot check | P | |
| `PLATFORM_LEGAL_APPROVED` | Switch that publishes platform legal pages and opens signup | P | |
| `RESEND_API_KEY` / `RESEND_SECRET_KEY`, `RESEND_WEBHOOK_SECRET` | The one Resend account that hosts every tenant's verified sending domains | P | Each tenant's domains/addresses are T |
| `HIGHLEVEL_CLIENT_ID`, `HIGHLEVEL_CLIENT_SECRET`, `HIGHLEVEL_VERSION_ID`, `HIGHLEVEL_REDIRECT_URI`, `HIGHLEVEL_CONNECT_ENABLED` | Verexa's GoHighLevel marketplace app | P | Each tenant's connection is T |
| `TWILIO_PRIMARY_CUSTOMER_PROFILE_SID` | Primary business profile all number registrations link to | P | |
| `VERCEL_API_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID` | Lets the app attach tenants' custom website domains | P | |
| `PLATFORM_SITE_DOMAIN`, `APP_HOSTS`, `NEXT_PUBLIC_APP_URL` | Routing: which hosts are the app, which are tenant sites | P | `admin.verexahq.com` will need adding here |
| `AUTOMATION_TEST_RECIPIENTS` | Non-production send guard | P | |
| `MONARCH_SUPPORT_EMAIL`, `AUTOMATION_ADMIN_EMAIL` | Platform support/admin contact | P | Name implies Monarch |
| `MONARCH_EMAIL_FROM`, `MONARCH_EMAIL_REPLY_TO` | Platform "from" address, but only Monarch uses it | **C** | See decision 3 |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_API_KEY*`, `TWILIO_FROM_NUMBER`, `TWILIO_MESSAGING_SERVICE_SID` | The Twilio account that is both Monarch's sender and the parent of tenant subaccounts | **C** | See decision 4 |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Monarch's own storefront Stripe account | T (held in env) | See decision 5 |
| `VERCEL_ENV`, `NODE_ENV`, `VERCEL_URL`, `VERCEL_BRANCH_URL` | Runtime context | n/a | Not settings |

## C. Screens and routes

| Screen / route | Today | Proposed | Notes |
|---|---|---|---|
| `/admin/workspaces` | Admin tab | P | Move to admin.verexahq.com |
| `/admin/billing-setup` | Admin tab | P | |
| `/admin/integrations` | Admin tab; read-only status of platform connections | P | |
| Platform legal / signup switch (`PLATFORM_LEGAL_APPROVED`) | Env only, no screen | P | Brief lists it under admin; today it has no screen (decision 6) |
| `/settings/integrations` ("Calculator setup links") | Settings | T | Monarch's own product; bureau tier |
| `/settings/payments` | Settings | T | Tenant connects own Stripe via platform Connect |
| `/settings/email` | Settings | T | Tenant's own domains and addresses |
| `/settings/sms` | Settings | T | Tenant's own number/credits |
| `/settings/branding`, `/firm`, `/business-hours`, `/import`, `/package-attributes`, `/archive` | Settings | T | |
| `/bureau/settings` (Software & banking), `/bureau/settings/history` | Settings | T | Bureau tier |
| Store (Products, Licenses, Installations, Orders, Customers, WISP Generator) and `/integrations` public "Set up your calculator" page | My Store | T (Monarch's own business) | Titled "Monarch Tax Suite"; stays Monarch's |
| `/efin/*`, `/fees`, `/offices`, `/compliance` (Service Bureau) | My Service Bureau | T (bureau tier) | `/offices` ("Office access") manages the bureau's own EROs, not platform tenants. Confirm with Krystal |

## D. Webhooks and background jobs

| Endpoint | Purpose | Proposed |
|---|---|---|
| `/api/stripe/billing-webhook` | Verexa subscription events | P |
| `/api/stripe/connect-webhook` | Tenants' connected-account payments | P (platform endpoint, tenant-scoped data) |
| `/api/stripe/webhook` | Monarch storefront events | T (Monarch) |
| `/api/campaigns/resend-webhook` | Delivery/open/click events for all tenants | P |
| `/api/sms/inbound`, `/api/sms/status` | Twilio events | P endpoint, tenant-scoped data |
| `/api/automation/run`, `/api/automation/tick` | Scheduler (billing sweep, automations, reminders) | P |

## E. Identity and data

| Item | Proposed | Notes |
|---|---|---|
| `admin_users` table | P | Becomes the list for info@verexahq.com only |
| info@monarchtaxsuite.com | T | Must become a normal Monarch tenant member before it leaves `admin_users` |
| `tenant_data_keys`, key versions | P | |
| Per-tenant rows (`email_domains`, `email_senders`, `crm_connections`, `tenant_sms_accounts`, `payment_connections`, `tenant_brands`) | T | Monarch's own rows stay Monarch's |

## F. Decisions needed from Krystal

1. **Monarch sign-in.** Confirm Monarch's owner becomes an ordinary tenant member (so the Monarch workspace stops depending on `admin_users`), with info@verexahq.com as the only admin. This is a code change to every Monarch page's access check.
2. **admin.verexahq.com and the new login.** Needs a Vercel domain, a DNS record, and creating info@verexahq.com as its own sign-in. Each is a production action I will ask about separately.
3. **Platform email sender.** Platform emails (welcome, payment failed, reminders, cancellation) should come from a platform sender, not through Monarch. Proposal: a platform "system mail" sender separate from Monarch's own tenant sender, and `MONARCH_EMAIL_FROM` becomes Monarch's tenant setting. Which address should system mail come from (today it is support@verexahq.com on the Resend side)?
4. **Twilio.** Keep one parent account (platform) and give Monarch its own subaccount like any tenant, or keep Monarch on the parent. The first matches "Monarch is an ordinary tenant" but means Monarch's number and registration move under a subaccount.
5. **Monarch's store Stripe keys.** Move them from global environment variables into Monarch's own tenant settings (the way Connect works for tenants), or leave them as variables for now. Moving them is a build item.
6. **Platform legal switch.** Today `PLATFORM_LEGAL_APPROVED` is only an environment variable. Do you want a read-only status screen in Admin (like Integrations), or keep it as a deploy-time switch?
7. **Renames.** Rename `MONARCH_ENCRYPTION_KEY`, `MONARCH_SUPPORT_EMAIL` (value unchanged, new name) in a later step, or leave the names alone. Renaming touches Vercel settings on both environments.
8. **Office access.** Confirm `/offices` is the bureau's own office management (tenant), not a platform tool.

## G. Owner decisions (Krystal, 2026-10-22) — all eight as recommended

1. Monarch's owner becomes an ordinary tenant member; **info@verexahq.com is the only platform admin**.
2. Production setup (the admin.verexahq.com domain and DNS, and creating the info@verexahq.com sign-in) is **approved in principle; each step is asked again separately before it is executed**.
3. Platform system mail sender: **support@verexahq.com**.
4. Twilio: **Monarch gets its own subaccount**, like any tenant.
5. Monarch's store Stripe keys move into **Monarch's own tenant settings during the Part 1 build**.
6. The legal switch gets a **read-only status screen in Admin**.
7. The `MONARCH_` renames happen **later, during the move**, not as their own step.
8. `/offices` is a **tenant tool**.

Status: classification approved. No build has started. The Part 1 build order and its per-step approvals are proposed separately.
