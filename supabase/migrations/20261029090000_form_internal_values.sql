-- Forms: staff-only ("internal") fields. A form can have fields the person filling it in never sees; staff fill
-- them in on the submission afterwards. Submitted answers are locked, so these live in their own table.
--
-- form_internal_values   one staff-entered value per (submission, field key)
--
-- Tenant scoped from day one: tenant_id from the session, row-level security, same-tenant foreign key.

create table if not exists public.form_internal_values (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.require_tenant_id() references public.tenants (id) on delete restrict,
  submission_id uuid not null,
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  value text not null check (length(value) <= 25000),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (submission_id, field_key)
);
create index if not exists form_internal_values_submission_idx on public.form_internal_values (submission_id);

do $$
declare
  t text;
  tenant_tables text[] := array['form_internal_values'];
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

-- Same-tenant reference to the submission.
create unique index if not exists form_submissions_tenant_id_id_key on public.form_submissions (tenant_id, id);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'form_internal_values_submission_tenant_fkey') then
    alter table public.form_internal_values add constraint form_internal_values_submission_tenant_fkey
      foreign key (tenant_id, submission_id) references public.form_submissions (tenant_id, id) on delete cascade;
  end if;
end $$;
