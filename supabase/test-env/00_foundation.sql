-- TEST ENVIRONMENT ONLY. Do not run against the production Monarch project.
--
-- This is the original foundation migration "20261008224443
-- create_monarch_calculator_licensing_foundation", recovered verbatim from the
-- production migration history (supabase_migrations.schema_migrations). It was
-- never committed to this repository. Production already has it applied; this
-- copy exists so an isolated test project can be built from scratch:
--   00_foundation.sql, then supabase/migrations/*.sql in filename order.

create extension if not exists pgcrypto;

create table public.calculator_customers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email text not null,
  full_name text,
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calculator_customers_email_nonempty check (length(trim(email)) > 0)
);

create table public.calculator_licenses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.calculator_customers(id) on delete restrict,
  license_key_hash text unique,
  product_code text not null default 'monarch_tax_calculator',
  status text not null default 'pending'
    check (status in ('pending','active','past_due','suspended','expired','revoked')),
  billing_type text not null default 'one_time'
    check (billing_type in ('one_time','subscription')),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  starts_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index calculator_licenses_customer_idx
  on public.calculator_licenses(customer_id);
create index calculator_licenses_status_idx
  on public.calculator_licenses(status);

create table public.calculator_authorized_domains (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.calculator_licenses(id) on delete cascade,
  domain text not null,
  verification_status text not null default 'pending'
    check (verification_status in ('pending','verified','rejected')),
  verification_token_hash text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (license_id, domain)
);

create index calculator_authorized_domains_domain_idx
  on public.calculator_authorized_domains(domain);

create table public.calculator_installations (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.calculator_licenses(id) on delete cascade,
  installation_type text not null
    check (installation_type in ('self_service','done_for_you')),
  platform text not null
    check (platform in ('ghl','website','jotform','other')),
  domain text,
  status text not null default 'requested'
    check (status in ('requested','in_progress','active','blocked','removed')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index calculator_installations_license_idx
  on public.calculator_installations(license_id);

create table public.calculator_license_events (
  id uuid primary key default gen_random_uuid(),
  license_id uuid references public.calculator_licenses(id) on delete set null,
  customer_id uuid references public.calculator_customers(id) on delete set null,
  event_type text not null,
  source text not null default 'system'
    check (source in ('stripe','admin','system','customer')),
  stripe_event_id text unique,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index calculator_license_events_license_idx
  on public.calculator_license_events(license_id);
create index calculator_license_events_created_idx
  on public.calculator_license_events(created_at desc);

-- These tables are backend-managed. Do not expose customer/license data directly
-- to anonymous or authenticated browser clients; Edge Functions will enforce access.
alter table public.calculator_customers enable row level security;
alter table public.calculator_licenses enable row level security;
alter table public.calculator_authorized_domains enable row level security;
alter table public.calculator_installations enable row level security;
alter table public.calculator_license_events enable row level security;

revoke all on public.calculator_customers from anon, authenticated;
revoke all on public.calculator_licenses from anon, authenticated;
revoke all on public.calculator_authorized_domains from anon, authenticated;
revoke all on public.calculator_installations from anon, authenticated;
revoke all on public.calculator_license_events from anon, authenticated;
