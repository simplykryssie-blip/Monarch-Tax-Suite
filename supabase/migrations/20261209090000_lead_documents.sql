-- Lead documents: leads get their own document section. A PDF from a form a lead completes is saved here, and when the lead
-- becomes a client the documents move to the client's files (and no longer exist here). Additive only: one new table. Nothing is
-- dropped and no existing table or value is changed. Safe to run again.
--
-- lead_docs   one row per document of a lead: its title, the stored file, its type and size, and the form submission it came from.

set local lock_timeout = '10s';

create table if not exists public.lead_docs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  lead_id uuid not null,
  title text not null check (length(title) between 1 and 200),
  file_path text not null check (length(file_path) between 1 and 500),
  file_type text not null check (file_type in ('pdf', 'docx', 'png', 'jpg', 'xlsx', 'csv', 'txt')),
  size_bytes integer check (size_bytes is null or size_bytes between 0 and 26214400),
  status text not null default 'stored' check (status in ('pending', 'stored')),
  form_submission_id uuid,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists lead_docs_path_key on public.lead_docs (file_path);
create unique index if not exists lead_docs_submission_key on public.lead_docs (tenant_id, form_submission_id) where form_submission_id is not null;
create index if not exists lead_docs_lead_idx on public.lead_docs (tenant_id, lead_id, created_at desc);

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['lead_docs'];
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

-- A document points only at a lead of its own tenant, and goes when that lead is deleted.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lead_docs_lead_same_tenant') then
    alter table public.lead_docs add constraint lead_docs_lead_same_tenant foreign key (tenant_id, lead_id) references public.leads (tenant_id, id) on delete cascade;
  end if;
end $$;
