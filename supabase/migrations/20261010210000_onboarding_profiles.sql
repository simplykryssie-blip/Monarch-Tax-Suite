-- Customer-entered onboarding details and completion marker (one row per license).
-- ADDITIVE ONLY. Requires 20261010200000_automation_center.sql (for the shared updated_at trigger function already in place).
-- NOT APPLIED to production by the pull request that adds it.
-- Holds contact/business details the customer typed and a completion timestamp. No secrets, tokens or lead data.

set local lock_timeout = '10s';

create table if not exists public.onboarding_profiles (
  license_id uuid primary key references public.calculator_licenses (id) on delete cascade,
  contact_name text check (contact_name is null or char_length(contact_name) <= 120),
  business_name text check (business_name is null or char_length(business_name) <= 120),
  business_email text check (business_email is null or char_length(business_email) <= 254),
  phone text check (phone is null or char_length(phone) <= 40),
  ghl_account text check (ghl_account is null or char_length(ghl_account) <= 120),
  completed_at timestamptz,
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace trigger set_updated_at before update on public.onboarding_profiles for each row execute function public.set_updated_at();

alter table public.onboarding_profiles enable row level security;
revoke all on table public.onboarding_profiles from anon, authenticated;
grant select, insert, update, delete on table public.onboarding_profiles to service_role;
