-- Phase 6: subscription billing (additive).
--
-- tenant_subscriptions  one row per workspace that is billed: its plan, state (active, suspended, read-only, paused,
--                       cancelled), the Stripe customer and subscription, the renewal date and the retention date after
--                       cancellation. Only the platform (the Stripe webhook and the daily sweep) can write it: a workspace
--                       can read its own row, never change it. A workspace with no row isn't billed here, and Monarch (the
--                       platform's own first tenant) has an 'internal' row: free, never billed.
-- billing_events        Stripe events already handled, so a repeated delivery changes nothing.
--
-- Same tenant rules as every table since Step 0: tenant_id, the two policies, and tenant isolation on reads.

create table if not exists public.tenant_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  plan text not null check (plan in ('ptin', 'ero', 'bureau')),
  status text not null check (status in ('active', 'suspended', 'read_only', 'paused', 'canceled', 'internal')),
  stripe_customer_id text check (stripe_customer_id is null or stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  stripe_subscription_id text check (stripe_subscription_id is null or stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  paused_from_plan text check (paused_from_plan is null or paused_from_plan in ('ptin', 'ero', 'bureau')),
  suspended_at timestamptz,
  canceled_at timestamptz,
  delete_after timestamptz,
  precheck_mark smallint check (precheck_mark is null or precheck_mark in (7, 5, 3)),
  terms_version text check (terms_version is null or length(terms_version) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A paying account is tied to its Stripe subscription; a cancelled one has its retention date.
  check (status in ('internal') or stripe_subscription_id is not null),
  check (status <> 'canceled' or (canceled_at is not null and delete_after is not null))
);
create unique index if not exists tenant_subscriptions_tenant_key on public.tenant_subscriptions (tenant_id);
create unique index if not exists tenant_subscriptions_sub_key on public.tenant_subscriptions (stripe_subscription_id) where stripe_subscription_id is not null;
create index if not exists tenant_subscriptions_customer_idx on public.tenant_subscriptions (stripe_customer_id) where stripe_customer_id is not null;
create index if not exists tenant_subscriptions_status_idx on public.tenant_subscriptions (status);

create table if not exists public.billing_events (
  stripe_event_id text primary key check (stripe_event_id ~ '^evt_[A-Za-z0-9_]+$'),
  tenant_id uuid not null references public.tenants(id),
  type text not null check (length(type) <= 80),
  processed_at timestamptz not null default now()
);
create index if not exists billing_events_tenant_idx on public.billing_events (tenant_id);

create or replace function public.tenant_subscriptions_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
create or replace trigger tenant_subscriptions_touch before update on public.tenant_subscriptions for each row execute function public.tenant_subscriptions_touch();

do $$
declare
  t text;
  tenant_tables text[] := array['tenant_subscriptions', 'billing_events'];
begin
  foreach t in array tenant_tables loop
    execute format('alter table public.%I alter column tenant_id set default public.require_tenant_id()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    -- Workspaces may read their own subscription; only the platform's service access writes.
    execute format('revoke all on table public.%I from tenant_app', t);
    execute format('grant select, insert, update on table public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'tenant_isolation') then
      execute format('create policy tenant_isolation on public.%I as permissive for select to tenant_app using (tenant_id = public.current_tenant_id())', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'tenant_members_only') then
      execute format('create policy tenant_members_only on public.%I as restrictive for all to authenticated using (tenant_id in (select public.my_tenant_ids())) with check (tenant_id in (select public.my_tenant_ids()))', t);
    end if;
  end loop;
end $$;
grant select on table public.tenant_subscriptions to tenant_app;

-- Monarch Tax Suite, the platform's first tenant, is on a free internal plan.
insert into public.tenant_subscriptions (tenant_id, plan, status)
values ('00000000-0000-4000-8000-000000000001', 'bureau', 'internal')
on conflict (tenant_id) do nothing;
