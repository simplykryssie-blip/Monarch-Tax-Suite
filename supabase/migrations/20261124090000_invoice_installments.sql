-- Billing, part three: payment plans. An invoice can be split into scheduled payments (installments). Only the schedule is
-- stored: a due date and an amount for each. Which ones are paid is worked out from what the invoice has been paid.
-- Additive only: one new table. Nothing is dropped and no existing value is changed. Safe to run again.
--
-- invoice_installments   one row per scheduled payment on an invoice.

set local lock_timeout = '10s';

create table if not exists public.invoice_installments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  invoice_id uuid not null,
  position integer not null check (position between 1 and 12),
  due_on date not null,
  amount_cents integer not null check (amount_cents between 50 and 100000000),
  created_at timestamptz not null default now()
);
create unique index if not exists invoice_installments_position_key on public.invoice_installments (tenant_id, invoice_id, position);

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['invoice_installments'];
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

-- Same-tenant reference: a scheduled payment belongs to an invoice of the same workspace.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_installments_invoice_id_same_tenant') then
    alter table public.invoice_installments add constraint invoice_installments_invoice_id_same_tenant foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id);
  end if;
end $$;
