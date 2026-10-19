-- Product files: code bundles and other deliverables sold with a product (additive).
--
-- Files are STORED AND DELIVERED, NEVER EXECUTED. They live in a private bucket that accepts only
-- application/octet-stream, so even an .html or .js file is never rendered or run by a browser opening its URL.
-- Buyers receive a short-lived signed URL that forces a download, and only while their license for that product is
-- active and its order is paid. No storage.objects policies are created: only the server (service role) can upload,
-- sign or delete, after its own checks.
--
-- product_files: one row per uploaded file. "pending" until the server confirms the upload landed.
-- download_events: every download handed out, per license (no file contents, no IP address: a keyed hash only).

set local lock_timeout = '10s';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-files', 'product-files', false, 52428800, array['application/octet-stream'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.product_files (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  storage_path text not null unique check (storage_path ~ '^products/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  file_name text not null check (length(file_name) between 4 and 120 and file_name ~* '\.(zip|html|js|css)$'),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 52428800),
  status text not null default 'pending' check (status in ('pending', 'ready', 'removed')),
  created_by uuid,
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  removed_at timestamptz
);
create index if not exists product_files_product_idx on public.product_files (product_id, status, created_at);

create table if not exists public.download_events (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.calculator_licenses (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  product_file_id uuid not null references public.product_files (id) on delete restrict,
  file_name text not null,
  client_hash text check (client_hash is null or length(client_hash) <= 128),
  created_at timestamptz not null default now()
);
create index if not exists download_events_license_idx on public.download_events (license_id, created_at desc);
create index if not exists download_events_file_idx on public.download_events (product_file_id);

alter table public.product_files enable row level security;
alter table public.download_events enable row level security;
revoke all on table public.product_files from anon, authenticated;
revoke all on table public.download_events from anon, authenticated;
grant select, insert, update, delete on table public.product_files to service_role;
grant select, insert, update, delete on table public.download_events to service_role;
