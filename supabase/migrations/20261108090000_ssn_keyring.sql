-- Phase 5.0: encrypted full Social Security numbers (additive).
--
-- tenant_data_keys  one row per tenant: that tenant's data key, wrapped (encrypted) by a platform master key. Rotating the
--                   master key re-wraps these rows; the Social Security numbers themselves are not touched.
--                   master_version says which master key wrapped it.
-- client_ssn        one row per client: the full number, encrypted with the tenant's data key and bound to the tenant
--                   and client. Kept apart from `clients` so no client list or export can ever select it.
--
-- Same tenant rules as every table since Step 0: tenant_id with the required default, the two policies, and a
-- same-tenant foreign key from client_ssn to clients.

create table if not exists public.tenant_data_keys (
  tenant_id uuid not null primary key references public.tenants(id),
  master_version integer not null check (master_version between 1 and 1000),
  wrapped_key text not null check (length(wrapped_key) between 20 and 400),
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

create table if not exists public.client_ssn (
  tenant_id uuid not null references public.tenants(id),
  client_id uuid not null,
  ciphertext text not null check (ciphertext like 's1:%' and length(ciphertext) between 20 and 400),
  sealed_by uuid references auth.users(id) on delete set null,
  sealed_at timestamptz not null default now(),
  primary key (tenant_id, client_id)
);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_ssn_client_id_same_tenant') then
    alter table public.client_ssn add constraint client_ssn_client_id_same_tenant
      foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete cascade;
  end if;
end $$;

do $$
declare
  t text;
  tenant_tables text[] := array['tenant_data_keys', 'client_ssn'];
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
