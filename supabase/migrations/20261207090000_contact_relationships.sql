-- Family relationships between people: "Ana is Bo's parent". Additive only: one new table. Nothing is dropped and no existing
-- table or value is changed. The spouse link, typed-in spouse and dependents already on a client are untouched; this adds the
-- other family connections. Safe to run again.
--
-- contact_relationships   one row says person A is person B's <kind> (spouse, parent, son, daughter, grandchild, grandparent,
--                         aunt, uncle, sibling, other with a note). Each person is a client or a lead. Both people see it: on B's
--                         page it reads "Parent: A", on A's page "Child: B".

set local lock_timeout = '10s';

create table if not exists public.contact_relationships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  a_client_id uuid,
  a_lead_id uuid,
  b_client_id uuid,
  b_lead_id uuid,
  kind text not null check (kind in ('spouse', 'parent', 'son', 'daughter', 'grandchild', 'grandparent', 'aunt', 'uncle', 'sibling', 'other')),
  note text check (note is null or length(note) <= 200),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((a_client_id is not null and a_lead_id is null) or (a_client_id is null and a_lead_id is not null)),
  check ((b_client_id is not null and b_lead_id is null) or (b_client_id is null and b_lead_id is not null)),
  check (coalesce(a_client_id, a_lead_id) <> coalesce(b_client_id, b_lead_id)),
  check (kind <> 'other' or (note is not null and length(btrim(note)) > 0))
);
create unique index if not exists contact_relationships_one_per_pair on public.contact_relationships (tenant_id, coalesce(a_client_id, a_lead_id), coalesce(b_client_id, b_lead_id), kind);
create index if not exists contact_relationships_a_idx on public.contact_relationships (coalesce(a_client_id, a_lead_id));
create index if not exists contact_relationships_b_idx on public.contact_relationships (coalesce(b_client_id, b_lead_id));

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['contact_relationships'];
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

-- Each side points only at a client or lead of its own tenant, and the row goes when either person goes.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contact_relationships_a_client_same_tenant') then
    alter table public.contact_relationships add constraint contact_relationships_a_client_same_tenant foreign key (tenant_id, a_client_id) references public.clients (tenant_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contact_relationships_a_lead_same_tenant') then
    alter table public.contact_relationships add constraint contact_relationships_a_lead_same_tenant foreign key (tenant_id, a_lead_id) references public.leads (tenant_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contact_relationships_b_client_same_tenant') then
    alter table public.contact_relationships add constraint contact_relationships_b_client_same_tenant foreign key (tenant_id, b_client_id) references public.clients (tenant_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contact_relationships_b_lead_same_tenant') then
    alter table public.contact_relationships add constraint contact_relationships_b_lead_same_tenant foreign key (tenant_id, b_lead_id) references public.leads (tenant_id, id) on delete cascade;
  end if;
end $$;
