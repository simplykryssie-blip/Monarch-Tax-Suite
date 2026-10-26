-- Pipelines: a type you write yourself, a colour, published or not, and folders (with sub-folders) to keep them in.
-- Additive only: four new columns on pipelines and one new table. Nothing is dropped and no existing value is changed;
-- every existing pipeline stays published. Safe to run again.
--
-- pipelines.type_label   what the pipeline is for, in the office's own words ("Bookkeeping"). Empty for the tax-return pipeline.
-- pipelines.color        the colour shown on its card.
-- pipelines.published    only a published pipeline is offered on the Work board, the Add popup and in workflows.
-- pipelines.folder_id    the folder it is kept in, or none.
-- pipeline_folders       a folder, optionally inside another folder.

set local lock_timeout = '10s';

create table if not exists public.pipeline_folders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null check (length(name) between 1 and 80),
  parent_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint pipeline_folders_not_own_parent check (parent_id is null or parent_id <> id)
);
create unique index if not exists pipeline_folders_tenant_id_id_key on public.pipeline_folders (tenant_id, id);
create unique index if not exists pipeline_folders_name_key on public.pipeline_folders (tenant_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

alter table public.pipelines add column if not exists type_label text check (type_label is null or length(type_label) between 1 and 40);
alter table public.pipelines add column if not exists color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$');
alter table public.pipelines add column if not exists published boolean not null default true;
alter table public.pipelines add column if not exists folder_id uuid;

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['pipeline_folders'];
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

-- Same-tenant references: a folder sits inside a folder of the same workspace, and a pipeline in a folder of the same workspace.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pipeline_folders_parent_id_same_tenant') then
    alter table public.pipeline_folders add constraint pipeline_folders_parent_id_same_tenant foreign key (tenant_id, parent_id) references public.pipeline_folders (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pipelines_folder_id_same_tenant') then
    alter table public.pipelines add constraint pipelines_folder_id_same_tenant foreign key (tenant_id, folder_id) references public.pipeline_folders (tenant_id, id);
  end if;
end $$;
