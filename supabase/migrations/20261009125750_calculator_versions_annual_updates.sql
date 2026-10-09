-- Version-aware licensing: one-time calculator purchase plus optional, paid,
-- one-time annual tax-year updates. No subscriptions or recurring billing.
--
-- * product_versions: tax-year versions per product (status, release date,
--   one-time update price, Stripe one-time price id).
-- * product_version_changes: release notes and included maintenance fixes.
-- * calculator_licenses: original_tax_year / licensed_tax_year.
-- * orders: order_type ('purchase' | 'annual_update'), license_id, tax_year,
--   previous_tax_year. installation_type becomes optional (updates have none).
--
-- Additive except for relaxing orders.installation_type NOT NULL, replaced by a
-- check that still requires it for purchases. Safe to re-run.

set local lock_timeout = '10s';

create table if not exists public.product_versions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  tax_year integer not null check (tax_year between 2020 and 2100),
  label text not null check (char_length(label) between 2 and 80),
  status text not null default 'draft' check (status in ('draft','available','retired')),
  release_date date,
  update_price_cents integer not null default 5000 check (update_price_cents > 0),
  stripe_update_price_id text check (stripe_update_price_id is null or stripe_update_price_id ~ '^price_[A-Za-z0-9]+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, tax_year)
);

create table if not exists public.product_version_changes (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.product_versions (id) on delete cascade,
  kind text not null check (kind in ('release','maintenance')),
  summary text not null check (char_length(summary) between 3 and 1000),
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists product_version_changes_version_id_idx on public.product_version_changes (version_id, created_at);

alter table public.calculator_licenses
  add column if not exists original_tax_year integer check (original_tax_year between 2020 and 2100),
  add column if not exists licensed_tax_year integer check (licensed_tax_year between 2020 and 2100);

alter table public.orders
  add column if not exists order_type text not null default 'purchase' check (order_type in ('purchase','annual_update')),
  add column if not exists license_id uuid references public.calculator_licenses (id) on delete restrict,
  add column if not exists tax_year integer check (tax_year between 2020 and 2100),
  add column if not exists previous_tax_year integer check (previous_tax_year between 2020 and 2100);
alter table public.orders alter column installation_type drop not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_type_fields_check' and conrelid = 'public.orders'::regclass) then
    alter table public.orders add constraint orders_type_fields_check check (
      (order_type = 'purchase' and installation_type is not null and license_id is null)
      or (order_type = 'annual_update' and license_id is not null and tax_year is not null)
    );
  end if;
end $$;
create index if not exists orders_license_id_idx on public.orders (license_id) where license_id is not null;

create or replace trigger set_updated_at before update on public.product_versions
  for each row execute function public.set_updated_at();

do $$
declare
  t text;
begin
  foreach t in array array['product_versions','product_version_changes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;

-- Seed: the 2026 version is the one currently deployed (calculator code updated
-- for tax year 2026 on 2026-10-09). Annual update price $50 per the approved
-- pricing. No Stripe price is linked until one exists.
insert into public.product_versions (product_id, tax_year, label, status, release_date, update_price_cents)
select id, 2026, '2026 Tax Year', 'available', date '2026-10-09', 5000
from public.products where slug = 'monarch-basic-tax-calculator'
on conflict (product_id, tax_year) do nothing;

-- Existing licenses without a version were issued for the 2026 calculator.
update public.calculator_licenses
set original_tax_year = coalesce(original_tax_year, 2026), licensed_tax_year = coalesce(licensed_tax_year, 2026)
where licensed_tax_year is null and product_id in (select id from public.products where slug = 'monarch-basic-tax-calculator');

-- Compatibility check (rolled back): purchase + update order chain.
do $$
declare
  c uuid; p uuid; o uuid; l uuid; u uuid; v uuid;
begin
  begin
    select id into p from public.products where slug = 'monarch-basic-tax-calculator';
    select id into v from public.product_versions where product_id = p and tax_year = 2026;
    insert into public.calculator_customers (email, full_name) values ('migration-check@invalid.local', 'Migration check') returning id into c;
    insert into public.orders (customer_id, product_id, amount_cents, currency, payment_status, provider_payment_intent_id, installation_type, verification_method)
      values (c, p, 7500, 'usd', 'paid', 'pi_migrationcheck0002', 'self_service', 'admin_manual') returning id into o;
    insert into public.calculator_licenses (customer_id, order_id, product_id, status, original_tax_year, licensed_tax_year)
      values (c, o, p, 'active', 2026, 2026) returning id into l;
    insert into public.orders (order_type, customer_id, product_id, license_id, tax_year, previous_tax_year, amount_cents, currency, payment_status, provider_payment_intent_id, installation_type, verification_method)
      values ('annual_update', c, p, l, 2027, 2026, 5000, 'usd', 'paid', 'pi_migrationcheck0003', null, 'stripe_webhook') returning id into u;
    update public.calculator_licenses set licensed_tax_year = 2027 where id = l;
    insert into public.product_version_changes (version_id, kind, summary) values (v, 'maintenance', 'Migration check');
    raise exception 'monarch_compat_ok';
  exception when others then
    if sqlerrm <> 'monarch_compat_ok' then
      raise exception 'Version migration compatibility check failed: %', sqlerrm;
    end if;
  end;
end $$;
