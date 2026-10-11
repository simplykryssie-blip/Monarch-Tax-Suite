-- Service orders, and the first piece of the tenant foundation (additive).
--
-- tenants: the platform's sellers. Seeded with Monarch Tax Suite (the owner's bureau) as tenant #1, with a fixed id
-- the app also knows (lib/tenants.ts). Phase 2 Step 0 adds tenant_id to the existing tables and backfills them to
-- this row; tables created from now on carry tenant_id from day one, as these do.
--
-- service_orders: one per paid order for a service product (decision E2: manual, trackable fulfillment; no
-- scheduling). It snapshots the deliverable, owner and response time defined on the product (decision E4) at
-- purchase, so later product edits never rewrite what the buyer was promised.
-- service_order_events: every status change and note.

set local lock_timeout = '10s';

create table if not exists public.tenants (
  id uuid primary key,
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  name text not null check (length(name) between 2 and 120),
  created_at timestamptz not null default now()
);
insert into public.tenants (id, slug, name)
values ('00000000-0000-4000-8000-000000000001', 'monarch-tax-suite', 'Monarch Tax Suite')
on conflict (id) do nothing;

create table if not exists public.service_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  order_id uuid not null unique references public.orders (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  customer_id uuid not null references public.calculator_customers (id) on delete restrict,
  status text not null default 'new' check (status in ('new', 'in_progress', 'waiting_on_customer', 'delivered', 'canceled')),
  deliverable text not null check (length(deliverable) between 1 and 500),
  owner text not null check (length(owner) between 1 and 120),
  response_time text not null check (length(response_time) between 1 and 120),
  next_step text check (next_step is null or length(next_step) <= 500),
  delivered_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists service_orders_tenant_status_idx on public.service_orders (tenant_id, status, created_at desc);

create table if not exists public.service_order_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  service_order_id uuid not null references public.service_orders (id) on delete cascade,
  from_status text,
  to_status text,
  note text check (note is null or length(note) <= 2000),
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists service_order_events_order_idx on public.service_order_events (service_order_id, created_at);

alter table public.tenants enable row level security;
alter table public.service_orders enable row level security;
alter table public.service_order_events enable row level security;
revoke all on table public.tenants from anon, authenticated;
revoke all on table public.service_orders from anon, authenticated;
revoke all on table public.service_order_events from anon, authenticated;
grant select, insert, update, delete on table public.tenants to service_role;
grant select, insert, update, delete on table public.service_orders to service_role;
grant select, insert, update, delete on table public.service_order_events to service_role;
