-- Phase 4, Piece 0: sign-in for independent PTIN holders (additive).
--
-- practice_members  the people who sign in to a ptin-tier tenant (an independent PTIN holder's own workspace). The
--                   platform administrator creates the tenant and invites its owner; the owner becomes active when they
--                   set a password and turn on two-step sign-in. One sign-in belongs to one workspace. (An ERO's
--                   preparers are office_members, a different path.)
-- audit_events      a generic, append-only history of workspace actions, keyed by tenant. Phase 4 writes to it first;
--                   later phases use it too. Nothing can change or delete a row.
--
-- Same tenant rules as every table since Step 0: tenant_id with the required default, the two policies, and
-- same-tenant foreign keys.

create table if not exists public.practice_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  role text not null default 'owner' check (role in ('owner')),
  email text not null check (length(email) between 3 and 254),
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
create unique index if not exists practice_members_email_key on public.practice_members (tenant_id, lower(email));
-- One sign-in belongs to one workspace.
create unique index if not exists practice_members_user_key on public.practice_members (user_id) where user_id is not null;
create unique index if not exists practice_members_invite_key on public.practice_members (invite_token_hash) where invite_token_hash is not null;

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (length(action) between 1 and 80),
  subject_type text check (subject_type is null or length(subject_type) between 1 and 60),
  subject_id uuid,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists audit_events_recent_idx on public.audit_events (tenant_id, created_at desc);
create index if not exists audit_events_subject_idx on public.audit_events (tenant_id, subject_type, subject_id);

create or replace function public.audit_events_append_only() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'AUDIT_HISTORY_KEPT: the audit history cannot be changed or deleted';
end $$;
create or replace trigger audit_events_append_only before update or delete on public.audit_events for each row execute function public.audit_events_append_only();

create or replace function public.practice_members_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
create or replace trigger practice_members_touch before update on public.practice_members for each row execute function public.practice_members_touch();

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['practice_members', 'audit_events'];
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
