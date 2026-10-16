-- CRM Round 2, remaining corrections.
--
-- 1. Each tenant gets its own PRIVATE storage bucket, tenant-{tenant_id}, for its images (email images, form logos and
--    header images, product images). No bucket is public and no storage.objects policies are created: only the server
--    (service role) reads or writes, and it picks the bucket from the request's tenant, so one tenant's images can never
--    be read from another tenant's bucket. Images that must show outside the app (in an email, on a public form or the
--    shop) are streamed by the app at /media/{tenant}/images/..., which only reads image files from that tenant's bucket.
--    A bucket is made for every existing tenant now, and for each new tenant when it is created.
-- 2. tenant_images: the account's image library (images uploaded for use in emails).
-- 3. storage_cleanup: the queue of stored files to delete. When a person deletes a file (or a record with files) it
--    leaves the app at once and its files are queued with purge_after = now + 24 hours; the scheduler deletes them
--    then, and they can't be recovered after that. Files the system removes at once but couldn't (storage down) are
--    queued with purge_after = now. Either way no orphaned file is left in storage.
-- 4. client_messages: messages sent from a client's profile record how they went (sent / failed) and to whom.
-- Both new tables belong to one tenant from day one.

-- ---------------------------------------------------------------- 1. one private bucket per tenant

create or replace function public.tenant_bucket_id(p_tenant uuid) returns text
language sql immutable as $$ select 'tenant-' || p_tenant::text $$;

create or replace function public.ensure_tenant_bucket(p_tenant uuid) returns text
language plpgsql security definer set search_path = public, storage as $$
declare
  b text := public.tenant_bucket_id(p_tenant);
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (b, b, false, 4194304, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update set public = false;
  return b;
end $$;
revoke all on function public.ensure_tenant_bucket(uuid) from public, anon, authenticated;

do $$
declare
  t uuid;
begin
  for t in select id from public.tenants loop
    perform public.ensure_tenant_bucket(t);
  end loop;
end $$;

create or replace function public.tenants_make_bucket() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_tenant_bucket(new.id);
  return new;
end $$;
create or replace trigger tenants_make_bucket after insert on public.tenants for each row execute function public.tenants_make_bucket();

-- New product images go to the tenant's bucket under images/products/...; older ones stay readable at their old path
-- until they are moved.
alter table public.product_images drop constraint if exists product_images_storage_path_check;
alter table public.product_images add constraint product_images_storage_path_check
  check (storage_path ~ '^(images/)?products/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$');

-- ---------------------------------------------------------------- 2. the image library

create table if not exists public.tenant_images (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  storage_path text not null check (storage_path ~ '^images/[a-z0-9/-]+\.(jpg|png|webp)$'),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 4194304),
  width integer,
  height integer,
  file_name text not null check (length(file_name) between 1 and 200),
  alt_text text check (alt_text is null or length(alt_text) <= 200),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists tenant_images_path_key on public.tenant_images (tenant_id, storage_path);
create index if not exists tenant_images_recent_idx on public.tenant_images (tenant_id, created_at desc);

-- ---------------------------------------------------------------- 3. files still to remove

create table if not exists public.storage_cleanup (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  bucket text not null check (length(bucket) between 1 and 100),
  path text not null check (length(path) between 1 and 1024),
  purge_after timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text check (last_error is null or length(last_error) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists storage_cleanup_object_key on public.storage_cleanup (tenant_id, bucket, path);
create index if not exists storage_cleanup_due_idx on public.storage_cleanup (tenant_id, purge_after);

do $$
declare
  t text;
  tenant_tables text[] := array['tenant_images', 'storage_cleanup'];
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

create unique index if not exists tenant_images_tenant_id_id_key on public.tenant_images (tenant_id, id);
create unique index if not exists storage_cleanup_tenant_id_id_key on public.storage_cleanup (tenant_id, id);

-- ---------------------------------------------------------------- 4. sending from a client's profile

alter table public.client_messages add column if not exists status text not null default 'logged';
alter table public.client_messages add column if not exists sent_to text;
alter table public.client_messages add column if not exists provider_id text;
alter table public.client_messages add column if not exists error text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_messages_status_check') then
    alter table public.client_messages add constraint client_messages_status_check check (status in ('logged', 'sent', 'failed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'client_messages_sent_to_check') then
    alter table public.client_messages add constraint client_messages_sent_to_check check (sent_to is null or length(sent_to) <= 254);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'client_messages_error_check') then
    alter table public.client_messages add constraint client_messages_error_check check (error is null or length(error) <= 300);
  end if;
end $$;

notify pgrst, 'reload schema';
