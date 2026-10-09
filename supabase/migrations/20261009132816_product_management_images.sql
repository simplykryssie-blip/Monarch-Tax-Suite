-- Product management: categories, storefront content, payment type, explicit
-- Stripe sync tracking, and product images in Supabase Storage.
--
-- Additive only. Existing product rows, ids, Stripe ids, prices and statuses
-- are preserved. Safe to re-run.

set local lock_timeout = '10s';

alter table public.products
  add column if not exists category text not null default 'other'
    check (category in ('tax_software','service_bureau','digital_product','course','software_update','other')),
  add column if not exists features text[] not null default '{}',
  add column if not exists terms text check (terms is null or char_length(terms) <= 5000),
  add column if not exists disclaimer text check (disclaimer is null or char_length(disclaimer) <= 5000),
  add column if not exists payment_type text not null default 'one_time' check (payment_type in ('one_time','recurring')),
  add column if not exists billing_interval text check (billing_interval in ('month','year')),
  add column if not exists metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  add column if not exists stripe_price_cents integer check (stripe_price_cents is null or stripe_price_cents >= 0),
  add column if not exists stripe_sync_status text check (stripe_sync_status in ('synced','failed')),
  add column if not exists stripe_synced_at timestamptz,
  add column if not exists stripe_sync_error text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_recurring_interval_check' and conrelid = 'public.products'::regclass) then
    alter table public.products add constraint products_recurring_interval_check
      check ((payment_type = 'recurring') = (billing_interval is not null));
  end if;
end $$;

-- Categorize the two existing products (only while still at the default).
update public.products set category = 'tax_software'
  where slug = 'monarch-basic-tax-calculator' and category = 'other';
update public.products set category = 'software_update'
  where slug = 'monarch-basic-tax-calculator-yearly-update' and category = 'other';

-- Product images: files live in Storage; rows hold path + metadata.
create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  storage_path text not null unique check (storage_path ~ '^products/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 5242880),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  alt_text text check (alt_text is null or char_length(alt_text) <= 200),
  is_primary boolean not null default false,
  sort_order integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists product_images_product_id_idx on public.product_images (product_id, sort_order);
create unique index if not exists product_images_one_primary on public.product_images (product_id) where is_primary;

alter table public.product_images enable row level security;
revoke all on table public.product_images from anon, authenticated;
grant select, insert, update, delete on table public.product_images to service_role;

-- Storage bucket. Public read so storefront pages can show images by URL;
-- object paths are random UUIDs. No storage.objects policies are created, so
-- anon/authenticated cannot upload, replace or delete: only the server (service
-- role) writes, after its administrator check. Size and type are also enforced
-- by the bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 4194304, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Compatibility check (rolled back).
do $$
declare
  p uuid;
begin
  begin
    select id into p from public.products where slug = 'monarch-basic-tax-calculator';
    insert into public.product_images (product_id, storage_path, content_type, size_bytes, is_primary)
      values (p, 'products/' || p || '/00000000-0000-0000-0000-000000000000.png', 'image/png', 100, true);
    update public.products set features = array['a'], metadata = '{"k":"v"}'::jsonb where id = p;
    raise exception 'monarch_compat_ok';
  exception when others then
    if sqlerrm <> 'monarch_compat_ok' then
      raise exception 'Product management compatibility check failed: %', sqlerrm;
    end if;
  end;
end $$;
