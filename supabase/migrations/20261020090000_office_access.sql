-- Phase 3, PR 1b: the ERO office area (additive).
--
-- office_members  the people who sign in to an office: its ERO(s) and their preparers (PTIN holders). An office is a
--                 firm in My Service Bureau (an organizations row). A member starts as an invite (a one-time link, kept
--                 only as a hash) and becomes active when they set a password and turn on two-step sign-in. The ERO
--                 decides what each preparer can reach (permissions: feature key -> true/false). Bureau administrators
--                 are the existing admin accounts and oversee every office; they are not rows here.
-- office_events   append-only history of every invite, acceptance, permission change, suspension and sign-in step.
--
-- Same tenant rules as every table since Step 0: tenant_id with the required default, the two policies, and
-- same-tenant foreign keys. Within a tenant, the app keeps each member to their own office.

create table if not exists public.office_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  role text not null check (role in ('ero', 'preparer')),
  email text not null check (length(email) between 3 and 254),
  full_name text not null check (length(full_name) between 1 and 200),
  user_id uuid references auth.users(id) on delete set null,
  status text not null default 'invited' check (status in ('invited', 'active', 'suspended')),
  permissions jsonb not null default '{}'::jsonb check (jsonb_typeof(permissions) = 'object'),
  invite_token_hash text check (invite_token_hash is null or invite_token_hash ~ '^[0-9a-f]{64}$'),
  invite_expires_at timestamptz,
  invited_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists office_members_email_key on public.office_members (tenant_id, organization_id, lower(email));
-- One sign-in belongs to one office.
create unique index if not exists office_members_user_key on public.office_members (user_id) where user_id is not null;
create unique index if not exists office_members_invite_key on public.office_members (invite_token_hash) where invite_token_hash is not null;
create index if not exists office_members_office_idx on public.office_members (tenant_id, organization_id);

create table if not exists public.office_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  organization_id uuid references public.organizations(id) on delete set null,
  member_id uuid references public.office_members(id) on delete set null,
  action text not null check (length(action) between 1 and 60),
  actor_id uuid references auth.users(id) on delete set null,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists office_events_recent_idx on public.office_events (tenant_id, organization_id, created_at desc);

-- The history can only grow.
create or replace function public.office_events_append_only() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'OFFICE_HISTORY_KEPT: the office history cannot be changed or deleted';
end $$;
create or replace trigger office_events_append_only before update or delete on public.office_events for each row execute function public.office_events_append_only();

create or replace function public.office_members_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
create or replace trigger office_members_touch before update on public.office_members for each row execute function public.office_members_touch();

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['office_members', 'office_events'];
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

-- Same-tenant references.
create unique index if not exists office_members_tenant_id_id_key on public.office_members (tenant_id, id);
do $$
declare
  k record;
begin
  for k in select * from (values
    ('office_members', 'organization_id', 'organizations'),
    ('office_events', 'organization_id', 'organizations'),
    ('office_events', 'member_id', 'office_members')
  ) as v(child, col, parent) loop
    if not exists (select 1 from pg_constraint where conname = k.child || '_' || k.col || '_same_tenant') then
      execute format('alter table public.%I add constraint %I foreign key (tenant_id, %I) references public.%I (tenant_id, id)',
        k.child, k.child || '_' || k.col || '_same_tenant', k.col, k.parent);
    end if;
  end loop;
end $$;
