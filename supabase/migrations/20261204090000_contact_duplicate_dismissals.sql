-- "Not a duplicate": remembers that two contacts were looked at and are different people, so the Possible duplicates
-- list stops offering them. Additive only: one new table. Nothing is dropped and no existing table or value is changed.
-- Safe to run again.
--
-- contact_duplicate_dismissals   one row per pair marked "not a duplicate": the two contact keys (client-<id>, lead-<id>
--                                or customer-<id>, smaller key first), who marked it, and when. Deleting the row (Undo)
--                                puts the pair back on the list.

set local lock_timeout = '10s';

create table if not exists public.contact_duplicate_dismissals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  key_a text not null check (length(key_a) between 10 and 60),
  key_b text not null check (length(key_b) between 10 and 60),
  dismissed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (key_a < key_b)
);
create unique index if not exists contact_duplicate_dismissals_pair on public.contact_duplicate_dismissals (tenant_id, key_a, key_b);

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['contact_duplicate_dismissals'];
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
