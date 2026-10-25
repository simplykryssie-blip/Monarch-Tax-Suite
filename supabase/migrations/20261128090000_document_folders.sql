-- Documents: folders (with sub-folders) to keep library documents in.
-- Additive only: one new column on documents and one new table. Nothing is dropped and no existing value is changed;
-- every existing document stays where it is, outside any folder. Safe to run again.
--
-- documents.folder_id   the folder a document is kept in, or none.
-- document_folders      a folder, optionally inside another folder.

set local lock_timeout = '10s';

create table if not exists public.document_folders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null check (length(name) between 1 and 80),
  parent_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint document_folders_not_own_parent check (parent_id is null or parent_id <> id)
);
create unique index if not exists document_folders_tenant_id_id_key on public.document_folders (tenant_id, id);
create unique index if not exists document_folders_name_key on public.document_folders (tenant_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

alter table public.documents add column if not exists folder_id uuid;

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['document_folders'];
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

-- Same-tenant references: a folder sits inside a folder of the same workspace, and a document in a folder of the same workspace.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'document_folders_parent_id_same_tenant') then
    alter table public.document_folders add constraint document_folders_parent_id_same_tenant foreign key (tenant_id, parent_id) references public.document_folders (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'documents_folder_id_same_tenant') then
    alter table public.documents add constraint documents_folder_id_same_tenant foreign key (tenant_id, folder_id) references public.document_folders (tenant_id, id);
  end if;
end $$;
