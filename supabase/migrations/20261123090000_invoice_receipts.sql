-- Billing, part two: how each payment was received. Every payment recorded by hand or applied from a bank statement gets a
-- line saying how it was paid (cash, check, Zelle, a bank product payout ...), the reference, the date and the amount.
-- Payments made online through Stripe already have their own record and are not copied here.
-- Additive only: one new table. Nothing is dropped and no existing value is changed. Safe to run again.
--
-- invoice_receipts   one row per payment received outside Stripe.

set local lock_timeout = '10s';

create table if not exists public.invoice_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  invoice_id uuid not null,
  client_id uuid not null,
  amount_cents integer not null check (amount_cents between 1 and 100000000),
  method text not null check (method in ('cash', 'check', 'card', 'bank_transfer', 'cash_app', 'zelle', 'venmo', 'bank_product', 'other')),
  reference text check (reference is null or length(reference) <= 80),
  received_on date not null default current_date,
  source text not null default 'manual' check (source in ('manual', 'bank_import')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists invoice_receipts_invoice_idx on public.invoice_receipts (tenant_id, invoice_id);

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['invoice_receipts'];
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

-- Same-tenant references: a receipt belongs to an invoice and a client of the same workspace.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_receipts_invoice_id_same_tenant') then
    alter table public.invoice_receipts add constraint invoice_receipts_invoice_id_same_tenant foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoice_receipts_client_id_same_tenant') then
    alter table public.invoice_receipts add constraint invoice_receipts_client_id_same_tenant foreign key (tenant_id, client_id) references public.clients (tenant_id, id);
  end if;
end $$;
