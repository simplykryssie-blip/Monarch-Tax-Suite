-- Appointments: the confirmation email and text a client gets when they book can be edited. Until an office edits them the
-- built-in wording is used.
-- Additive only: one new table. Nothing is dropped and no existing value is changed. Safe to run again.
--
-- appointment_messages   one row per workspace: the confirmation email subject and body, and the confirmation text.
--                        Empty = the built-in wording. Placeholders like {{name}} and {{date_time}} are filled in when sent.

set local lock_timeout = '10s';

create table if not exists public.appointment_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  confirm_subject text check (confirm_subject is null or length(confirm_subject) <= 200),
  confirm_body text check (confirm_body is null or length(confirm_body) <= 4000),
  confirm_sms text check (confirm_sms is null or length(confirm_sms) <= 320),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index if not exists appointment_messages_one_per_tenant on public.appointment_messages (tenant_id);

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['appointment_messages'];
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
