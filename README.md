# Full Service CRM

> **Monarch admin CRM:** products, orders, Stripe fulfillment, licenses and installations are documented in [docs/monarch-commerce.md](docs/monarch-commerce.md). The workspace pages described below are legacy and not linked from the Monarch admin.

A CRM and tax-workflow foundation for tax professionals: client management and case (engagement) tracking today, with bookkeeping, payroll, and business services designed to attach later without a schema redesign.

This is a standalone frontend backed by the existing **Verexa Tax Office v2** Supabase project. It is intentionally separate from the VerexaHQ app — same database, different product, no "Service" package concept required to open a case.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind CSS
- Supabase (`@supabase/ssr`) for auth and data. The project is chosen by `NEXT_PUBLIC_SUPABASE_URL` (Monarch's own project in production; a separate throwaway project for testing, see `docs/stripe-test-runbook.md`)
- No component library dependency — a small hand-built set of UI primitives in `components/ui/`

## Getting started

1. Copy `.env.local.example` to `.env.local` (already pre-filled with the shared project's public URL and publishable key).
2. `npm install`
3. `npm run dev` and open [http://localhost:3000](http://localhost:3000).

You'll be redirected to `/login`. No shared development credentials are published in this repository. Create your own local test user in a non-production Supabase project (or ask the project owner to provision one) and never commit passwords, tokens, or keys. Real secrets belong only in `.env.local` (git-ignored) or the Vercel environment settings.

## What's here

- **Auth** — Supabase email/password, session handled via `proxy.ts` (Next.js 16 renamed `middleware.ts` to `proxy.ts`; functionality is the same).
- **Dashboard** — open case count, tasks due this week, recent clients.
- **Clients** — list, search, create, detail view with cases/notes/contact info.
- **Cases** (`engagements` table) — create a case for a client with no service/template required, track it through the existing status pipeline, tasks, notes, and tax-return-specific details when relevant.
- **Tasks** — open/completed views, mark done from anywhere they appear.
- **Settings** — read-only workspace + branding view, to confirm multi-tenant scoping is working.

## Database notes

- `lib/supabase/database.types.ts` is a hand-written TypeScript type file covering only the tables this app touches (not a full Supabase-generated file — the type generator wasn't available in the build environment). Regenerate/extend it if you add new tables or columns.
- One additive migration was applied to the shared database: `engagements.case_type` (text, default `'other'`, checked against `tax_return | bookkeeping | payroll | business_service | other`). It's a new column only — nothing VerexaHQ reads was changed.

## Not built yet

Bookkeeping, payroll, and business-service modules (no database tables exist for them yet), client portal auth, e-signatures, billing/invoicing UI, document upload/storage, and production deployment. The `clients` table was deliberately designed to be module-agnostic, so these can attach later without reworking what's here.
