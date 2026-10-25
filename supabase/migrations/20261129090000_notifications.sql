-- Notifications: the bell. Something happened that the office should know about (an appointment booked, a document
-- signed, a client upload, a message, a form submitted, an invoice paid). Additive only: one new table. Nothing is
-- dropped and no existing value is changed. Safe to run again.
--
-- notifications   one row per event: what happened, where to click, which client it was about, and who has read it.
--                 read_by    the people who have read it (each person's read state is their own).
--                 owner_id   the owner of the client it was about, when there is one; staff see their own clients' items,
--                            workspace owners see all.
--                 actor_id   the person who did it, when it was staff: they are not told about their own action.
--                 dedupe_key one row per real event, even if the event is reported twice.

set local lock_timeout = '10s';

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  kind text not null check (length(kind) between 1 and 60),
  title text not null check (length(title) between 1 and 200),
  detail text check (detail is null or length(detail) <= 300),
  href text not null check (href like '/%' and length(href) <= 300),
  client_id uuid,
  owner_id uuid references auth.users(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  dedupe_key text check (dedupe_key is null or length(dedupe_key) <= 200),
  read_by uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create unique index if not exists notifications_dedupe_key on public.notifications (tenant_id, dedupe_key) where dedupe_key is not null;
create index if not exists notifications_recent_idx on public.notifications (tenant_id, created_at desc);

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['notifications'];
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

-- A notification about a client points at a client of the same workspace; it goes when the client does.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_client_id_same_tenant') then
    alter table public.notifications add constraint notifications_client_id_same_tenant foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete cascade;
  end if;
end $$;
