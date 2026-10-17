-- Phase 4, Piece 1: the return-prep and assignment layer, built once (additive).
--
-- It sits on the workspace tables (clients, client_returns) and is used by both the independent PTIN holder's
-- workspace and the office area, so there is one implementation of "a return with an assignee and a prep status".
--
-- clients.owner_id           the preparer who owns the client; people see their own clients (backfilled from created_by).
-- clients.organization_id    the office a client belongs to, when an office's team entered them (null = the account's own).
-- client_returns.assignee_id the preparer working the return (backfilled from the client's owner).
-- client_returns.prep_status not_started -> in_prep -> ready_for_review -> handed_off.
-- client_returns.organization_id  as for clients.
-- return_checklist_items     the intake checklist on a return.
-- return_handoffs            a record that an export of a return was emailed to an ERO. The export is a file, never a
--                            shared row: nothing here references another tenant.
--
-- Same tenant rules as every table since Step 0.

alter table public.clients add column if not exists owner_id uuid references auth.users(id) on delete set null;
alter table public.clients add column if not exists organization_id uuid;
alter table public.client_returns add column if not exists assignee_id uuid references auth.users(id) on delete set null;
alter table public.client_returns add column if not exists organization_id uuid;
alter table public.client_returns add column if not exists prep_status text not null default 'not_started';
alter table public.client_returns add column if not exists handed_off_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'client_returns_prep_status_check') then
    alter table public.client_returns add constraint client_returns_prep_status_check check (prep_status in ('not_started', 'in_prep', 'ready_for_review', 'handed_off'));
  end if;
end $$;

update public.clients set owner_id = created_by where owner_id is null and created_by is not null;
update public.client_returns r set assignee_id = c.owner_id from public.clients c where r.client_id = c.id and r.tenant_id = c.tenant_id and r.assignee_id is null and c.owner_id is not null;

create index if not exists clients_owner_idx on public.clients (tenant_id, owner_id) where archived_at is null;
create index if not exists client_returns_assignee_idx on public.client_returns (tenant_id, assignee_id, prep_status) where archived_at is null;

create table if not exists public.return_checklist_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  return_id uuid not null references public.client_returns(id) on delete cascade,
  label text not null check (length(label) between 1 and 200),
  position integer not null default 0,
  done_at timestamptz,
  done_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists return_checklist_return_idx on public.return_checklist_items (tenant_id, return_id, position);

create table if not exists public.return_handoffs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  return_id uuid not null references public.client_returns(id) on delete restrict,
  to_email text not null check (length(to_email) between 3 and 254),
  file_name text not null check (length(file_name) between 1 and 200),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('sent', 'failed')),
  error text check (error is null or length(error) <= 300),
  sent_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists return_handoffs_return_idx on public.return_handoffs (tenant_id, return_id, created_at desc);

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['return_checklist_items', 'return_handoffs'];
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
create unique index if not exists organizations_tenant_id_id_key on public.organizations (tenant_id, id);
do $$
declare
  k record;
begin
  for k in select * from (values
    ('clients', 'organization_id', 'organizations'),
    ('client_returns', 'organization_id', 'organizations'),
    ('return_checklist_items', 'return_id', 'client_returns'),
    ('return_handoffs', 'return_id', 'client_returns')
  ) as v(child, col, parent) loop
    if not exists (select 1 from pg_constraint where conname = k.child || '_' || k.col || '_same_tenant') then
      execute format('alter table public.%I add constraint %I foreign key (tenant_id, %I) references public.%I (tenant_id, id)',
        k.child, k.child || '_' || k.col || '_same_tenant', k.col, k.parent);
    end if;
  end loop;
end $$;
