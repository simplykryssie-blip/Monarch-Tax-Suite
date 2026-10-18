-- Phase 5.0: the office's business calendar (additive).
--
-- business_hours    one row per tenant: the weekly open hours (day number 0 = Sunday to 6 -> {open, close} or null for
--                   closed). The office's time zone is the one on its firm profile.
-- business_closures days the office is closed, one row each. The eleven US federal holidays are written for the
--                   current year and the next two the first time an office opens the setting (source 'federal', with
--                   a stable key and year so they are never written twice and an office's edits are never overwritten);
--                   the office can switch each off, change its dates (a range, so Christmas can be December 23 to 26)
--                   and add closures of its own (source 'custom').
--
-- Same tenant rules as every table since Step 0.

create table if not exists public.business_hours (
  tenant_id uuid not null primary key references public.tenants(id),
  week jsonb not null check (jsonb_typeof(week) = 'object'),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_closures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  source text not null check (source in ('federal', 'custom')),
  holiday_key text check (holiday_key is null or length(holiday_key) between 2 and 40),
  holiday_year integer check (holiday_year is null or holiday_year between 2000 and 2100),
  name text not null check (length(name) between 1 and 80),
  start_date date not null,
  end_date date not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date and end_date - start_date < 62),
  check ((source = 'federal') = (holiday_key is not null and holiday_year is not null))
);
create unique index if not exists business_closures_holiday_key on public.business_closures (tenant_id, holiday_key, holiday_year) where holiday_key is not null;
create index if not exists business_closures_range_idx on public.business_closures (tenant_id, start_date, end_date);

create or replace function public.business_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
create or replace trigger business_hours_touch before update on public.business_hours for each row execute function public.business_touch();
create or replace trigger business_closures_touch before update on public.business_closures for each row execute function public.business_touch();

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['business_hours', 'business_closures'];
begin
  foreach t in array tenant_tables loop
    execute format('alter table public.%I alter column tenant_id set default public.require_tenant_id()', t);
    execute format('create index if not exists %I on public.%I (tenant_id)', t || '_tenant_idx', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role, tenant_app', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'tenant_isolation') then
      execute format('create policy tenant_isolation on public.%I as permissive for all to tenant_app using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id())', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'tenant_members_only') then
      execute format('create policy tenant_members_only on public.%I as restrictive for all to authenticated using (tenant_id in (select public.my_tenant_ids())) with check (tenant_id in (select public.my_tenant_ids()))', t);
    end if;
  end loop;
end $$;
