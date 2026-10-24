-- Contacts: first and last name, date of birth, a structured address, a linked spouse, dependents and business details.
-- Additive only: new columns on clients and two new tables. Nothing is dropped and no existing value is changed except that
-- first and last name are filled in from the existing full name (everything before the last space is the first name).
-- Safe to run again.
--
-- clients.first_name, last_name  full_name stays and is kept as "first last" by the app.
-- clients.dob                    date of birth.
-- clients.address_line1 ... zip  the address in parts. The old one-line address stays and is rebuilt from the parts on save.
-- clients.spouse_id              the other client this one is married to. The app sets both sides together.
-- client_dependents              people claimed on a contact's return: name, birth date, relationship, last 4 of SSN.
-- client_businesses              businesses a contact owns: name, kind, EIN, phone, address.
-- client_messages.channel        gains 'portal': a message written to the client's portal.

set local lock_timeout = '10s';

alter table public.clients add column if not exists first_name text check (first_name is null or length(first_name) between 1 and 100);
alter table public.clients add column if not exists last_name text check (last_name is null or length(last_name) between 1 and 100);
alter table public.clients add column if not exists dob date check (dob is null or dob between date '1900-01-01' and date '2100-01-01');
alter table public.clients add column if not exists address_line1 text check (address_line1 is null or length(address_line1) <= 150);
alter table public.clients add column if not exists address_line2 text check (address_line2 is null or length(address_line2) <= 100);
alter table public.clients add column if not exists city text check (city is null or length(city) <= 80);
alter table public.clients add column if not exists state text check (state is null or state ~ '^[A-Z]{2}$');
alter table public.clients add column if not exists zip text check (zip is null or zip ~ '^[0-9]{5}(-[0-9]{4})?$');
alter table public.clients add column if not exists spouse_id uuid;
alter table public.clients drop constraint if exists clients_not_own_spouse;
alter table public.clients add constraint clients_not_own_spouse check (spouse_id is null or spouse_id <> id);

-- Fill in first and last name for clients that already exist.
update public.clients
set first_name = case when position(' ' in btrim(full_name)) > 0 then left(btrim(full_name), length(btrim(full_name)) - length(split_part(reverse(btrim(full_name)), ' ', 1)) - 1) else btrim(full_name) end,
    last_name = case when position(' ' in btrim(full_name)) > 0 then nullif(reverse(split_part(reverse(btrim(full_name)), ' ', 1)), '') else null end
where first_name is null;

create table if not exists public.client_dependents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  client_id uuid not null references public.clients(id) on delete restrict,
  first_name text not null check (length(first_name) between 1 and 100),
  last_name text check (last_name is null or length(last_name) between 1 and 100),
  dob date check (dob is null or dob between date '1900-01-01' and date '2100-01-01'),
  relationship text not null default 'child' check (relationship in ('child', 'stepchild', 'foster_child', 'grandchild', 'sibling', 'parent', 'other_relative', 'other')),
  ssn_last4 text check (ssn_last4 is null or ssn_last4 ~ '^[0-9]{4}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists client_dependents_client_idx on public.client_dependents (tenant_id, client_id);

create table if not exists public.client_businesses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  client_id uuid not null references public.clients(id) on delete restrict,
  name text not null check (length(name) between 1 and 200),
  entity_type text not null default 'sole_proprietor' check (entity_type in ('sole_proprietor', 'llc', 's_corp', 'c_corp', 'partnership', 'nonprofit', 'other')),
  ein text check (ein is null or ein ~ '^[0-9]{2}-[0-9]{7}$'),
  phone text check (phone is null or length(phone) <= 40),
  address text check (address is null or length(address) <= 300),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists client_businesses_client_idx on public.client_businesses (tenant_id, client_id);

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['client_dependents', 'client_businesses'];
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

-- Same-tenant references: a dependent, a business or a spouse link can only point at a client in the same workspace.
do $$
declare
  k record;
begin
  for k in select * from (values
    ('client_dependents', 'client_id', 'clients'),
    ('client_businesses', 'client_id', 'clients'),
    ('clients', 'spouse_id', 'clients')
  ) as v(child, col, parent) loop
    if not exists (select 1 from pg_constraint where conname = k.child || '_' || k.col || '_same_tenant') then
      execute format('alter table public.%I add constraint %I foreign key (tenant_id, %I) references public.%I (tenant_id, id)',
        k.child, k.child || '_' || k.col || '_same_tenant', k.col, k.parent);
    end if;
  end loop;
end $$;

-- A message can be sent to the client's portal.
alter table public.client_messages drop constraint if exists client_messages_channel_check;
alter table public.client_messages add constraint client_messages_channel_check check (channel in ('email', 'sms', 'call', 'other', 'portal'));
