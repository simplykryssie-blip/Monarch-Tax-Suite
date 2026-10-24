-- Work for a client that is not a tax return: tax planning, bookkeeping, payroll, business services, resolution, or anything
-- else the office offers. Each piece of work sits in one of the office's own pipelines and moves through its stages.
-- Additive only: one new table. Tax returns stay where they are. Nothing is dropped and no existing value is changed. Safe to run again.
--
-- client_work.pipeline_id   which pipeline (service) the work belongs to; the pipeline's name is the service.
-- client_work.stage_id      the stage it is in now, one of that pipeline's stage ids.
-- client_work.title         an optional label, such as "October books".

set local lock_timeout = '10s';

create table if not exists public.client_work (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  client_id uuid not null references public.clients(id) on delete restrict,
  pipeline_id uuid not null,
  stage_id text not null check (length(stage_id) between 1 and 80),
  title text check (title is null or length(title) between 1 and 200),
  due_on date check (due_on is null or due_on between date '2000-01-01' and date '2100-01-01'),
  assignee_id uuid references auth.users(id) on delete set null,
  notes text check (notes is null or length(notes) <= 4000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists client_work_client_idx on public.client_work (tenant_id, client_id);
create index if not exists client_work_pipeline_idx on public.client_work (tenant_id, pipeline_id) where archived_at is null;

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['client_work'];
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

-- Same-tenant references: work can only point at a client and a pipeline in the same workspace.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_work_client_id_same_tenant') then
    alter table public.client_work add constraint client_work_client_id_same_tenant foreign key (tenant_id, client_id) references public.clients (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'client_work_pipeline_id_same_tenant') then
    alter table public.client_work add constraint client_work_pipeline_id_same_tenant foreign key (tenant_id, pipeline_id) references public.pipelines (tenant_id, id);
  end if;
end $$;
