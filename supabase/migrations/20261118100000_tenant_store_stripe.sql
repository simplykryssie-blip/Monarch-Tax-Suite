-- A workspace's own storefront Stripe keys (additive).
--
-- tenant_store_stripe  one row per workspace that sells through the storefront: its Stripe secret key and webhook signing
--                      secret, stored only as AES-256-GCM ciphertext (the master key lives in the environment, never in the
--                      database; each value is bound to this workspace and field). The last four characters of each are
--                      kept in clear so the owner can tell which key is saved; the keys themselves are never shown.
--
-- Until now these were two server-wide environment variables that only Monarch used. Same tenant rules as every table
-- since Step 0: tenant_id, the two policies, and tenant isolation on reads. Safe to run again.

set local lock_timeout = '10s';

create table if not exists public.tenant_store_stripe (
  tenant_id uuid not null primary key references public.tenants (id),
  secret_key_enc text not null check (secret_key_enc like 'v1:%'),
  secret_key_hint text not null check (secret_key_hint ~ '^[A-Za-z0-9]{4}$'),
  mode text not null check (mode in ('test', 'live')),
  webhook_secret_enc text check (webhook_secret_enc is null or webhook_secret_enc like 'v1:%'),
  webhook_secret_hint text check (webhook_secret_hint is null or webhook_secret_hint ~ '^[A-Za-z0-9+/=_-]{4}$'),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((webhook_secret_enc is null) = (webhook_secret_hint is null))
);

create or replace function public.tenant_store_stripe_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
create or replace trigger tenant_store_stripe_touch before update on public.tenant_store_stripe for each row execute function public.tenant_store_stripe_touch();

do $$
declare
  t text;
  tenant_tables text[] := array['tenant_store_stripe'];
begin
  foreach t in array tenant_tables loop
    execute format('alter table public.%I alter column tenant_id set default public.require_tenant_id()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to tenant_app, service_role', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'tenant_isolation') then
      execute format('create policy tenant_isolation on public.%I as permissive for all to tenant_app using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id())', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'tenant_members_only') then
      execute format('create policy tenant_members_only on public.%I as restrictive for all to authenticated using (tenant_id in (select public.my_tenant_ids())) with check (tenant_id in (select public.my_tenant_ids()))', t);
    end if;
  end loop;
end $$;
