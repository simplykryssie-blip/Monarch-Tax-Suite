-- Phase 5c.2: the portal document center (additive).
--
-- client_docs.shared_with_client  staff choose which of a client's documents the client sees in the portal. Nothing is
--                                 shared by default.
-- client_docs.source              'staff' (uploaded by the office) or 'client' (uploaded in the portal).
-- client_docs.request_id          the request a client upload answers, when it does.
-- portal_doc_requests             "please upload your W-2": staff ask, the client uploads against it, staff see it filled.
-- tenant-documents bucket         now also accepts JPG and PNG, so a client can photograph a form. Uploads are still
--                                 checked by their content (magic bytes) before they count.
--
-- Same tenant rules as every table since Step 0.

create table if not exists public.portal_doc_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  client_id uuid not null,
  return_id uuid,
  title text not null check (length(title) between 1 and 200),
  note text check (note is null or length(note) <= 1000),
  due_on date,
  status text not null default 'open' check (status in ('open', 'received', 'cancelled')),
  requested_by uuid references auth.users(id) on delete set null,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists portal_doc_requests_client_idx on public.portal_doc_requests (tenant_id, client_id, status);
create unique index if not exists portal_doc_requests_tenant_id_id_key on public.portal_doc_requests (tenant_id, id);

alter table public.client_docs add column if not exists shared_with_client boolean not null default false;
alter table public.client_docs add column if not exists source text not null default 'staff';
alter table public.client_docs add column if not exists request_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_docs_source_check') then
    alter table public.client_docs add constraint client_docs_source_check check (source in ('staff', 'client'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'portal_doc_requests_client_same_tenant') then
    alter table public.portal_doc_requests add constraint portal_doc_requests_client_same_tenant foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'portal_doc_requests_return_same_tenant') then
    alter table public.portal_doc_requests add constraint portal_doc_requests_return_same_tenant foreign key (tenant_id, return_id) references public.client_returns (tenant_id, id) on delete set null (return_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'client_docs_request_same_tenant') then
    alter table public.client_docs add constraint client_docs_request_same_tenant foreign key (tenant_id, request_id) references public.portal_doc_requests (tenant_id, id) on delete set null (request_id);
  end if;
end $$;
create index if not exists client_docs_shared_idx on public.client_docs (tenant_id, client_id, created_at desc) where shared_with_client;

create or replace function public.portal_doc_requests_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
create or replace trigger portal_doc_requests_touch before update on public.portal_doc_requests for each row execute function public.portal_doc_requests_touch();

do $$
declare
  t text;
  tenant_tables text[] := array['portal_doc_requests'];
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

update storage.buckets
   set allowed_mime_types = array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png']
 where id = 'tenant-documents';
