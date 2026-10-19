-- Product reviews: a star rating and a written review, live as soon as they are posted, from verified purchasers only
-- (the reviewer proves a paid order for that product with the email and order number). One review per customer per
-- product. An administrator can hide a review (it is kept, with the reason). Belongs to one tenant from day one.

create table if not exists public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  product_id uuid not null references public.products(id) on delete restrict,
  customer_id uuid not null references public.calculator_customers(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  rating integer not null check (rating between 1 and 5),
  body text not null check (length(body) between 10 and 2000),
  display_name text not null check (length(display_name) between 1 and 60),
  hidden_at timestamptz,
  hidden_reason text check (hidden_reason is null or length(hidden_reason) <= 300),
  created_at timestamptz not null default now()
);
create unique index if not exists product_reviews_one_per_customer on public.product_reviews (tenant_id, product_id, customer_id);
create index if not exists product_reviews_product_idx on public.product_reviews (tenant_id, product_id, created_at desc);

do $$
declare
  t text;
  tenant_tables text[] := array['product_reviews'];
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

-- Same-tenant references.
do $$
declare
  k record;
begin
  for k in select * from (values
    ('product_reviews', 'product_id', 'products'),
    ('product_reviews', 'customer_id', 'calculator_customers'),
    ('product_reviews', 'order_id', 'orders')
  ) as v(child, col, parent) loop
    if not exists (select 1 from pg_constraint where conname = k.child || '_' || k.col || '_same_tenant') then
      execute format('alter table public.%I add constraint %I foreign key (tenant_id, %I) references public.%I (tenant_id, id)',
        k.child, k.child || '_' || k.col || '_same_tenant', k.col, k.parent);
    end if;
  end loop;
end $$;
