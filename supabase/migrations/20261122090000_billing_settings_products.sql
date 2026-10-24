-- Billing, part one: what goes on every invoice (refund policy, terms, sales tax), the tax software and bank products an
-- office uses with the standard fees each one charges, and what an invoice remembers about them.
-- Additive only: two new tables and five new columns on invoices. Nothing is dropped and no existing value is changed;
-- every existing invoice has no tax and no software or bank product. Safe to run again.
--
-- billing_settings   one row per workspace: refund policy and terms (printed as the invoice footer) and the sales tax percent.
-- fee_products       a tax software or a bank product, with its standard fee lines. An invoice picks one of each.
-- invoices.tax_percent, tax_cents   the sales tax charged on the invoice and the percent it was figured at.
-- invoices.payer                    who pays: 'bank_product' (taken out of the refund) or 'self' (out of pocket). Empty = not set.
-- invoices.software_name, bank_name the software and bank product picked, kept as written even if the product changes later.

set local lock_timeout = '10s';

create table if not exists public.billing_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  refund_policy text check (refund_policy is null or length(refund_policy) <= 4000),
  terms text check (terms is null or length(terms) <= 8000),
  tax_percent numeric(6,3) not null default 0 check (tax_percent between 0 and 25),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index if not exists billing_settings_one_per_tenant on public.billing_settings (tenant_id);

create table if not exists public.fee_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  kind text not null check (kind in ('software', 'bank')),
  name text not null check (length(name) between 1 and 80),
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 12),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index if not exists fee_products_active_name_key on public.fee_products (tenant_id, kind, lower(name)) where archived_at is null;

alter table public.invoices add column if not exists tax_percent numeric(6,3) not null default 0 check (tax_percent between 0 and 25);
alter table public.invoices add column if not exists tax_cents integer not null default 0 check (tax_cents between 0 and 100000000);
alter table public.invoices add column if not exists payer text check (payer is null or payer in ('bank_product', 'self'));
alter table public.invoices add column if not exists software_name text check (software_name is null or length(software_name) <= 80);
alter table public.invoices add column if not exists bank_name text check (bank_name is null or length(bank_name) <= 80);

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['billing_settings', 'fee_products'];
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
