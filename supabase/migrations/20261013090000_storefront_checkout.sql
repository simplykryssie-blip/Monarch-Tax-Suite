-- Server-started storefront checkout (additive).
--
-- storefront_checkouts records every Stripe Checkout Session the storefront creates: the product, the price and
-- amount verified at that moment, and the Terms / Refund Policy version the buyer accepted. The webhook fulfils a
-- purchase only when its session is one of these rows and the amount paid matches. Open rows that never complete
-- are the abandoned checkouts. Contains no card or personal data.
--
-- orders.terms_version / terms_accepted_at copy that acceptance onto the order.

set local lock_timeout = '10s';

create table if not exists public.storefront_checkouts (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  stripe_session_id text not null unique check (stripe_session_id ~ '^cs_[A-Za-z0-9_]+$'),
  stripe_price_id text not null check (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  installation_type text check (installation_type is null or installation_type in ('self_service', 'done_for_you')),
  terms_version text not null check (length(terms_version) between 1 and 40),
  terms_accepted_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'completed', 'expired')),
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists storefront_checkouts_product_idx on public.storefront_checkouts (product_id, status, created_at desc);

alter table public.storefront_checkouts enable row level security;
revoke all on table public.storefront_checkouts from anon, authenticated;
grant select, insert, update, delete on table public.storefront_checkouts to service_role;

alter table public.orders add column if not exists terms_version text check (terms_version is null or length(terms_version) between 1 and 40);
alter table public.orders add column if not exists terms_accepted_at timestamptz;
