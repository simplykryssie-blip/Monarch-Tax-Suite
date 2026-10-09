-- Stripe verification snapshots and duplicate-checkout prevention (additive).
--
-- stripe_verification (jsonb) stores what the server last read from Stripe
-- for a product's mapping or a version's update price (name, amount,
-- currency, active, billing type, mode, issues). It never changes the
-- configured Stripe ids; verified and unverified data stay distinguishable.
--
-- update_checkout_sessions remembers the open Stripe Checkout Session per
-- license and tax year so a customer is sent back to the same session
-- instead of being able to pay twice. Contains no card or personal data.

set local lock_timeout = '10s';

alter table public.products add column if not exists stripe_verification jsonb
  check (stripe_verification is null or jsonb_typeof(stripe_verification) = 'object');
alter table public.product_versions add column if not exists stripe_verification jsonb
  check (stripe_verification is null or jsonb_typeof(stripe_verification) = 'object');

create table if not exists public.update_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.calculator_licenses (id) on delete cascade,
  tax_year integer not null check (tax_year between 2020 and 2100),
  stripe_session_id text not null unique check (stripe_session_id ~ '^cs_[A-Za-z0-9_]+$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists update_checkout_sessions_license_idx on public.update_checkout_sessions (license_id, tax_year, created_at desc);

alter table public.update_checkout_sessions enable row level security;
revoke all on table public.update_checkout_sessions from anon, authenticated;
grant select, insert, update, delete on table public.update_checkout_sessions to service_role;
