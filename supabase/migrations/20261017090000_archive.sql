-- Platform: archive instead of delete, for every tenant.
--
-- archived_at / archived_by / archive_reason   on customers, orders, licenses, products, service orders, documents,
--                                              workflows and forms (firms, people, offices, EFINs, credentials and
--                                              sending addresses already have archived_at). The columns live on the
--                                              shared tables, so every tenant, including new ones, has them.
-- archive_log                                  one tenant-scoped, append-only history of every archive, restore,
--                                              automatic restore and hard delete: who, when, what and why.
--
-- Products, documents, workflows and forms already had an "archived" status. For those four, the status stays the
-- source of truth (the storefront, sending, the workflow engine and public forms already respect it) and a trigger
-- keeps archived_at in step with it, whichever code path changes the status.
-- Additive only: no rows are removed and no existing column changes meaning.

do $$
declare
  t text;
begin
  foreach t in array array['calculator_customers', 'orders', 'calculator_licenses', 'products', 'service_orders', 'documents', 'automation_workflows', 'forms'] loop
    execute format('alter table public.%I add column if not exists archived_at timestamptz', t);
    execute format('alter table public.%I add column if not exists archived_by uuid', t);
    execute format('alter table public.%I add column if not exists archive_reason text', t);
    if not exists (select 1 from pg_constraint where conname = t || '_archive_reason_len' and conrelid = ('public.' || t)::regclass) then
      execute format('alter table public.%I add constraint %I check (archive_reason is null or length(archive_reason) <= 500)', t, t || '_archive_reason_len');
    end if;
    execute format('create index if not exists %I on public.%I (tenant_id) where archived_at is not null', t || '_archived_idx', t);
  end loop;
end $$;

-- Rows already archived by status keep their history: their archive time is their last update.
update public.products set archived_at = coalesce(updated_at, created_at) where status = 'archived' and archived_at is null;
update public.documents set archived_at = coalesce(updated_at, created_at) where status = 'archived' and archived_at is null;
update public.automation_workflows set archived_at = coalesce(updated_at, created_at) where status = 'archived' and archived_at is null;
update public.forms set archived_at = coalesce(updated_at, created_at) where status = 'archived' and archived_at is null;

-- For the four tables with an "archived" status: archived_at follows the status.
create or replace function public.archive_follows_status() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status = 'archived' then
    if new.archived_at is null then new.archived_at := now(); end if;
  elsif new.archived_at is not null then
    new.archived_at := null;
    new.archived_by := null;
    new.archive_reason := null;
  end if;
  return new;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['products', 'documents', 'automation_workflows', 'forms'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_archive_follows_status', t);
    execute format('create trigger %I before insert or update of status, archived_at on public.%I for each row execute function public.archive_follows_status()', t || '_archive_follows_status', t);
  end loop;
end $$;

-- One history for every tenant.
create table if not exists public.archive_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  entity text not null check (entity in ('customer', 'order', 'license', 'product', 'service_order', 'document', 'workflow', 'form')),
  record_id uuid not null,
  action text not null check (action in ('archived', 'restored', 'auto_restored', 'deleted')),
  actor_id uuid,
  label text not null check (length(label) between 1 and 200),
  reason text check (reason is null or length(reason) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists archive_log_record_idx on public.archive_log (tenant_id, entity, record_id, created_at desc);
create index if not exists archive_log_recent_idx on public.archive_log (tenant_id, created_at desc);

-- The history can only grow.
create or replace function public.archive_log_append_only() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'ARCHIVE_LOG_KEPT: the archive history cannot be changed or deleted';
end $$;
drop trigger if exists archive_log_append_only on public.archive_log;
create trigger archive_log_append_only before update or delete on public.archive_log for each row execute function public.archive_log_append_only();

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['archive_log'];
begin
  foreach t in array tenant_tables loop
  execute format('alter table public.%I alter column tenant_id set default public.require_tenant_id()', t);
  execute format('create index if not exists %I on public.%I (tenant_id)', t || '_tenant_idx', t);
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on table public.%I from anon, authenticated', t);
  execute format('grant select, insert on table public.%I to service_role, tenant_app', t);
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'tenant_isolation') then
    execute format('create policy tenant_isolation on public.%I as permissive for all to tenant_app using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id())', t);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'tenant_members_only') then
    execute format('create policy tenant_members_only on public.%I as restrictive for all to authenticated using (tenant_id in (select public.my_tenant_ids())) with check (tenant_id in (select public.my_tenant_ids()))', t);
  end if;
  end loop;
end $$;
