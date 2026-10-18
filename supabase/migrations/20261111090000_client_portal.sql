-- Phase 5c.1: client portal sign-in (additive).
--
-- portal_members  the people who sign in to the client portal. One row says "this email is the portal login for this
--                 client of this office". A person who is a client of two offices has one sign-in (one auth user) and
--                 two rows, one per office. Staff invite them by email with a one-time link (same pattern as PTIN
--                 holders); there is no self-signup. Portal sign-ins are never tenant_members, so they can never reach
--                 a staff page or a staff table: the portal reads through the server, always filtered to the one
--                 client the row names.
--
-- Same tenant rules as every table since Step 0: tenant_id with the required default, the two policies, and
-- same-tenant foreign keys.

create table if not exists public.portal_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  client_id uuid not null,
  email text not null check (length(email) between 3 and 254 and email = lower(email)),
  full_name text not null check (length(full_name) between 1 and 200),
  user_id uuid references auth.users(id) on delete set null,
  status text not null default 'invited' check (status in ('invited', 'active', 'suspended')),
  invite_token_hash text check (invite_token_hash is null or invite_token_hash ~ '^[0-9a-f]{64}$'),
  invite_expires_at timestamptz,
  invited_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- A client has one portal login; an office can't invite the same address twice.
create unique index if not exists portal_members_client_key on public.portal_members (tenant_id, client_id);
create unique index if not exists portal_members_email_key on public.portal_members (tenant_id, lower(email));
-- A sign-in can belong to many offices, but only once to each.
create unique index if not exists portal_members_user_key on public.portal_members (tenant_id, user_id) where user_id is not null;
create index if not exists portal_members_user_idx on public.portal_members (user_id) where user_id is not null;
create unique index if not exists portal_members_invite_key on public.portal_members (invite_token_hash) where invite_token_hash is not null;
create unique index if not exists portal_members_tenant_id_id_key on public.portal_members (tenant_id, id);

create or replace function public.portal_members_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
create or replace trigger portal_members_touch before update on public.portal_members for each row execute function public.portal_members_touch();

do $$
declare
  t text;
  tenant_tables text[] := array['portal_members'];
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

-- Same-tenant reference to the client.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'portal_members_client_same_tenant') then
    alter table public.portal_members add constraint portal_members_client_same_tenant foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete cascade;
  end if;
end $$;
