# Phase 7: Tenant-Aware Platform (ERO and Service Bureau)

**Goal:** an ERO or a Service Bureau can sign up, pay, sign in and work in their own account, seeing only their own data and only what their plan includes. Today only the independent PTIN holder has that. This phase is what lets Verexa HQ open to other businesses.

## What is true today (from the code)
- The main admin app always acts as Monarch: `currentTenantId()` returns Monarch's id (62 uses in 42 files), `requireAdmin()` guards about 100 files, and `admin_users` is a single platform-administrator list.
- Tiers exist (`tenants.tier`: ptin, ero, bureau; `lib/tier.ts`; the menu follows the tier), but only Monarch uses the full admin. PTIN holders use `/practice` (their own tenant). EROs and preparers who belong to a bureau use `/office` inside the bureau's tenant.
- Billing (Phase 6) gates only the PTIN workspace. Outbound messages stop for late accounts everywhere.
- Offices (EROs in a bureau) share the bureau's tenant. Tax Avenue Pro and Doucet Financial are service bureaus with several offices each.

## Owner decisions needed first
1. **Where do these three kinds of people sign in and land?** Proposal: one sign-in, then routed by membership: platform administrator → platform admin; bureau owner/staff → the full workspace (today's admin, scoped to their tenant); ERO owner → the ERO workspace; office staff of a bureau → `/office`; PTIN holder → `/practice`; client → `/portal`.
2. **Does an independent ERO (not part of a bureau) get one office of their own inside their own tenant?** Proposal: yes. An ERO account is a tenant with one office; a Service Bureau is a tenant with many.
3. **What does an ERO get that a PTIN doesn't, and a bureau that an ERO doesn't?** Proposal (confirm): PTIN = own clients, prep, documents, website, campaigns, billing. ERO = adds the ERO dashboard (EFIN and PTIN tracking, e-file status, compliance, team of preparers). Bureau = adds multiple offices, bureau-wide fees and statements, leads, automation and operations tools.
4. **Is the store (products, licences, orders, the calculator) Monarch-only?** Proposal: yes for now (the multi-tenant store is a follow-up). Other tenants never see those sections.
5. **Self-serve for ERO ($199) and Service Bureau ($299), or assisted onboarding first?** Proposal: open self-serve for all three once this phase passes testing, with a short onboarding checklist.

## Piece 1: Make the admin tenant-aware
- Replace the Monarch-only `currentTenantId()` in request paths with the tenant of the signed-in user (from their membership). Keep a single place that resolves "who is this and which tenant". Background jobs and webhooks keep passing the tenant they act for.
- Platform administrators (`admin_users`) stay a separate role for Verexa HQ staff; a bureau owner is a tenant member, never a platform administrator. Check that nothing grants one by accident.
- Audit all 62 uses and the ~100 admin entry points. List, for each, whether it is tenant data (scope it) or platform data (restrict it to platform administrators). Nothing in the main app may read or write across tenants.
- Sections follow the tier from `lib/tier.ts`, enforced on the server (pages and actions), not only hidden in the menu.
- Monarch-only sections (store, products, licences, installations, orders, customers of the calculator) are available to the Monarch tenant and platform administrators only.

## Piece 2: Sign-in routing and accounts
- One sign-in page and one routing function covering all roles (decision 1). A person who belongs to more than one tenant picks one; remember the choice.
- Owner invites staff into their own tenant with roles and permissions (extend the existing office-team model to the tenant level).
- Two-step sign-in is the account's choice as today; recommend it at setup for ERO and Bureau owners (they hold client SSNs).
- Tenant creation for ERO and Bureau through the existing signup and the billing webhook (Phase 6), creating the tenant with the right tier and its first office.

## Piece 3: Onboarding for a new account
- First sign-in checklist per tier: firm profile (legal name, address, phone), connect a sending domain and address, brand (logo, colours), add the first office (ERO/Bureau), invite staff, optional: texting setup and website.
- Starter data: fee schedule template, starter automations and email templates, a sample client the owner can delete.
- Empty states that explain what to do next.

## Piece 4: Billing across all areas
- Apply the Phase 6 gate (suspended / read-only / paused / cancelled) to the admin and office areas, not only `/practice`.
- Billing page for ERO and Bureau owners; plan changes between tiers (upgrade and downgrade) with the data kept. Downgrade rules must say what becomes hidden (not deleted).
- Bureau accounts: decide how extra offices are priced, if at all (owner decision).

## Piece 5: Platform admin (Verexa HQ staff)
- A tenants list: name, tier, status, plan, renewal, last active, owner email.
- Actions, all audited: suspend, restore, resend the owner invite, extend a grace period, see billing events.
- Support access to a tenant only with an audited reason and a time limit. No standing access to client data.

## Piece 6: Tax Avenue Pro and Doucet Financial (after the above passes Preview)
- Read the old CRM's schema first (owner provides code or an export; no credentials in chat). Write a field-by-field mapping to offices, clients, returns, documents, leads, invoices.
- Build the import and rehearse it on the test project with fake or scrambled data. Production run one firm at a time, with counts reconciled against the old system, only on the owner's explicit go.
- Their sending domains, texting numbers and websites move last.

## Rules
- Tenant-scoped everything; RLS on every new table; `tenant_id` from day one.
- No disruption to Monarch's data or its store. Monarch stays a tenant on its internal plan.
- Isolation gate on the test project with at least three tenants (PTIN, ERO, Bureau with two offices): the same checks for every table that a new area touches, plus "a user of tenant A cannot reach tenant B's pages or actions" tested on the app itself, not only the database.
- Test with fake data only. Mobile friendly (390px). Each piece tested on Preview before merge; production migrations need owner approval per piece.

## Exit gate
Luna signs up and works as an independent PTIN, an ERO and a Service Bureau with two offices on Preview with Stripe test cards, and tries to reach another tenant's data from each (it must fail). Then a security review of tenant isolation across the whole app before the first outside customer is let in.

## Suggested order
1. Resolve who/which tenant, tier enforcement on the server, Monarch-only sections locked (Piece 1).
2. Sign-in routing and staff roles (Piece 2).
3. Billing gate across areas, plan changes (Piece 4).
4. Onboarding and starter data (Piece 3).
5. Platform admin (Piece 5).
6. Import for the two bureaus (Piece 6).

## Not in this phase
The multi-tenant store (tenants selling with their own Stripe account), the 90-day deletion job, the owner SSN reveal screen and the wildcard DNS (all separate approvals), and the `remove_lead_storage` migration.
