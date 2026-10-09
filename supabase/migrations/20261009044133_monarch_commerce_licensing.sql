-- Monarch Tax Suite: product catalog, orders, Stripe fulfillment, administrator
-- access, and the CRM fields the existing licensing tables were missing.
--
-- Builds on 20261008224443_create_monarch_calculator_licensing_foundation and
-- keeps its tables, column names, check constraints and data unchanged. This
-- migration only ADDS tables, nullable/defaulted columns, indexes, triggers and
-- grants. Safe to re-run (IF NOT EXISTS everywhere). It aborts, changing
-- nothing, if the existing tables do not have the shape the application maps to.
--
-- Column mapping used by lib/commerce/supabase-repo.ts:
--   calculator_licenses.license_key_hash         <- license key hash
--   calculator_installations.domain / notes      <- installation location / internal notes
--   calculator_installations.platform 'ghl'      <- GoHighLevel
--   calculator_authorized_domains.verification_status verified/rejected <- authorized/removed
--   calculator_license_events.details / source   <- event detail / actor kind
--
-- Access model: RLS on every table, no anon/authenticated grants. The CRM uses
-- the service role from server code only, after checking admin_users.

-- ---------------------------------------------------------------------------
-- Preflight: the foundation tables must exist with the columns we map to.
-- ---------------------------------------------------------------------------
-- Fail fast instead of queueing behind live traffic (e.g. Auth) for a lock.
set local lock_timeout = '10s';

do $$
declare
  missing text;
begin
  select string_agg(t.tbl || '.' || t.col, ', ') into missing
  from (values
    ('calculator_customers', 'id'), ('calculator_customers', 'email'), ('calculator_customers', 'full_name'), ('calculator_customers', 'stripe_customer_id'),
    ('calculator_licenses', 'id'), ('calculator_licenses', 'customer_id'), ('calculator_licenses', 'license_key_hash'), ('calculator_licenses', 'status'), ('calculator_licenses', 'revoked_at'),
    ('calculator_authorized_domains', 'license_id'), ('calculator_authorized_domains', 'domain'), ('calculator_authorized_domains', 'verification_status'), ('calculator_authorized_domains', 'verified_at'),
    ('calculator_installations', 'license_id'), ('calculator_installations', 'installation_type'), ('calculator_installations', 'platform'), ('calculator_installations', 'domain'), ('calculator_installations', 'status'), ('calculator_installations', 'notes'),
    ('calculator_license_events', 'license_id'), ('calculator_license_events', 'event_type'), ('calculator_license_events', 'source'), ('calculator_license_events', 'details')
  ) as t(tbl, col)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = t.tbl and c.column_name = t.col
  );
  if missing is not null then
    raise exception 'Monarch licensing foundation is missing expected columns: %. Apply 20261008224443 first or review the schema.', missing;
  end if;
end $$;

create or replace function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Administrators
-- ---------------------------------------------------------------------------
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Product catalog
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 2 and 120),
  description text,
  product_type text not null check (product_type in ('software','digital_download','course','membership','service')),
  access_type text not null check (access_type in ('license','instant_download','course_access','manual')),
  installation_options text[] not null default '{}' check (installation_options <@ array['self_service','done_for_you']::text[]),
  price_cents integer check (price_cents is null or price_cents >= 0),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  stripe_product_id text unique,
  stripe_price_id text,
  status text not null default 'draft' check (status in ('draft','published','unpublished','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Customers: add CRM account status and case-insensitive email uniqueness.
-- ---------------------------------------------------------------------------
alter table public.calculator_customers
  add column if not exists status text not null default 'active' check (status in ('active','inactive','blocked'));
create unique index if not exists calculator_customers_email_key on public.calculator_customers (lower(email));

-- ---------------------------------------------------------------------------
-- Orders and Stripe webhook ledger
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated by default as identity (start with 1001) unique,
  customer_id uuid not null references public.calculator_customers (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  amount_cents integer not null check (amount_cents >= 0),
  amount_refunded_cents integer not null default 0 check (amount_refunded_cents >= 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  payment_status text not null check (payment_status in ('pending','paid','failed','refunded','partially_refunded','canceled','disputed')),
  provider text not null default 'stripe' check (provider = 'stripe'),
  provider_payment_intent_id text unique,
  provider_checkout_session_id text unique,
  installation_type text not null check (installation_type in ('self_service','done_for_you')),
  verification_method text not null check (verification_method in ('stripe_webhook','stripe_api','admin_manual')),
  verified_by uuid references auth.users (id) on delete set null,
  verified_at timestamptz not null default now(),
  notes text,
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_customer_id_idx on public.orders (customer_id);

create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  status text not null check (status in ('processing','processed','ignored','failed')),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Licenses: link to order/product and track key issuance and activation.
-- (license_key_hash, status, revoked_at already exist.)
-- ---------------------------------------------------------------------------
alter table public.calculator_licenses
  add column if not exists order_id uuid references public.orders (id) on delete restrict,
  add column if not exists product_id uuid references public.products (id) on delete restrict,
  add column if not exists key_prefix text,
  add column if not exists max_domains integer not null default 1 check (max_domains between 1 and 100),
  add column if not exists issued_at timestamptz,
  add column if not exists activated_at timestamptz,
  add column if not exists revoke_reason text;
create unique index if not exists calculator_licenses_order_id_key on public.calculator_licenses (order_id);

-- License events: record which administrator acted.
alter table public.calculator_license_events
  add column if not exists actor_id uuid references auth.users (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Installations: link to customer/order/product, plus status history.
-- ---------------------------------------------------------------------------
alter table public.calculator_installations
  add column if not exists customer_id uuid references public.calculator_customers (id) on delete restrict,
  add column if not exists order_id uuid references public.orders (id) on delete restrict,
  add column if not exists product_id uuid references public.products (id) on delete restrict;
create unique index if not exists calculator_installations_order_id_key on public.calculator_installations (order_id);
create index if not exists calculator_installations_customer_id_idx on public.calculator_installations (customer_id);

create table if not exists public.installation_events (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.calculator_installations (id) on delete cascade,
  from_status text,
  to_status text,
  note text,
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists installation_events_installation_id_idx on public.installation_events (installation_id, created_at);

-- updated_at maintenance
do $$
declare
  t text;
begin
  foreach t in array array['products','orders','calculator_customers','calculator_licenses','calculator_installations'] loop
    execute format('create or replace trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Least privilege: RLS on, no browser-role access, service role only.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['admin_users','products','orders','stripe_events','calculator_customers','calculator_licenses','calculator_authorized_domains','calculator_license_events','calculator_installations','installation_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;
revoke all on sequence public.orders_order_number_seq from anon, authenticated;
grant usage, select on sequence public.orders_order_number_seq to service_role;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- The pre-existing SECURITY DEFINER event-trigger function must not be
-- executable by browser roles (the event trigger itself keeps working).
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'rls_auto_enable') then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Seed: the administrator account (only if it already exists in Auth) and the
-- Basic Tax Calculator as an unpublished draft. Price and Stripe product come
-- from the verified Stripe order (prod_VMBCU4J5IZb61R, $75.00 USD).
-- ---------------------------------------------------------------------------
insert into public.admin_users (user_id)
select id from auth.users where lower(email) = 'info@monarchtaxsuite.com'
on conflict do nothing;

insert into public.products (slug, name, description, product_type, access_type, installation_options, price_cents, currency, stripe_product_id, status)
values (
  'monarch-basic-tax-calculator',
  'Monarch Basic Tax Calculator',
  'Embeddable federal income tax estimator (tax years 2025 and 2026) for tax professionals'' websites, funnels and forms. Licensed per domain, with self-service or Done For You installation.',
  'software',
  'license',
  array['self_service','done_for_you'],
  7500,
  'usd',
  'prod_VMBCU4J5IZb61R',
  'draft'
)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Compatibility check: write the exact rows the application writes, inside a
-- sub-transaction that is always rolled back. Any mismatch aborts everything.
-- ---------------------------------------------------------------------------
do $$
declare
  c uuid; p uuid; o uuid; l uuid; i uuid;
begin
  begin
    select id into p from public.products where slug = 'monarch-basic-tax-calculator';
    insert into public.calculator_customers (email, full_name, status, stripe_customer_id) values ('migration-check@invalid.local', 'Migration check', 'active', null) returning id into c;
    insert into public.orders (customer_id, product_id, amount_cents, currency, payment_status, provider_payment_intent_id, installation_type, verification_method)
      values (c, p, 0, 'usd', 'paid', 'pi_migrationcheck0000', 'done_for_you', 'admin_manual') returning id into o;
    insert into public.calculator_licenses (customer_id, order_id, product_id, license_key_hash, key_prefix, status, max_domains, issued_at, activated_at, revoked_at, revoke_reason)
      values (c, o, p, null, null, 'pending', 1, null, null, null, null) returning id into l;
    update public.calculator_licenses set status = 'active', license_key_hash = repeat('0', 64), key_prefix = 'MTS-00000', issued_at = now(), activated_at = now() where id = l;
    update public.calculator_licenses set status = 'suspended' where id = l;
    update public.calculator_licenses set status = 'revoked', revoked_at = now(), revoke_reason = 'check' where id = l;
    insert into public.calculator_authorized_domains (license_id, domain, verification_status, verified_at) values (l, 'example.com', 'verified', now())
      on conflict (license_id, domain) do update set verification_status = 'rejected';
    insert into public.calculator_license_events (license_id, event_type, details, actor_id, source) values (l, 'created', '{}'::jsonb, null, 'stripe');
    insert into public.calculator_installations (customer_id, order_id, license_id, product_id, installation_type, platform, domain, status, notes)
      values (c, o, l, p, 'done_for_you', 'ghl', 'check', 'requested', null) returning id into i;
    update public.calculator_installations set status = 'in_progress', platform = 'other' where id = i;
    insert into public.installation_events (installation_id, from_status, to_status, note) values (i, 'requested', 'in_progress', 'check');
    insert into public.stripe_events (id, type, status) values ('evt_migrationcheck', 'check', 'processed');
    raise exception 'monarch_compat_ok';
  exception when others then
    if sqlerrm <> 'monarch_compat_ok' then
      raise exception 'Monarch commerce compatibility check failed: %', sqlerrm;
    end if;
  end;
end $$;
