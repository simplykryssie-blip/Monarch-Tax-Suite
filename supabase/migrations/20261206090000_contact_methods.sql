-- Contact information with depth: more than one email and phone per person, each with a label. Additive only: one new table.
-- Nothing is dropped and no existing table or value is changed; the email and phone already on a client or lead stay as the
-- primary ones, and everything that uses them keeps working. Safe to run again.
--
-- contact_methods   one row per EXTRA email or phone of a client or a lead: its kind, a label (personal, work, mobile...),
--                   and the value. Making one primary swaps it with the client's or lead's main email or phone.

set local lock_timeout = '10s';

create table if not exists public.contact_methods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  client_id uuid,
  lead_id uuid,
  kind text not null check (kind in ('email', 'phone')),
  label text not null default 'other' check (label in ('personal', 'work', 'mobile', 'home', 'other')),
  value text not null check (length(value) between 3 and 254),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((client_id is not null and lead_id is null) or (client_id is null and lead_id is not null))
);
create unique index if not exists contact_methods_client_value on public.contact_methods (tenant_id, client_id, kind, value) where client_id is not null;
create unique index if not exists contact_methods_lead_value on public.contact_methods (tenant_id, lead_id, kind, value) where lead_id is not null;
create index if not exists contact_methods_client_idx on public.contact_methods (client_id) where client_id is not null;
create index if not exists contact_methods_lead_idx on public.contact_methods (lead_id) where lead_id is not null;

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['contact_methods'];
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

-- A row points only at a client or lead of its own tenant, and goes when that person goes.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contact_methods_client_same_tenant') then
    alter table public.contact_methods add constraint contact_methods_client_same_tenant foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contact_methods_lead_same_tenant') then
    alter table public.contact_methods add constraint contact_methods_lead_same_tenant foreign key (tenant_id, lead_id) references public.leads (tenant_id, id) on delete cascade;
  end if;
end $$;
