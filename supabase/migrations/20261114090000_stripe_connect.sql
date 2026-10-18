-- Phase 5c-pay: online invoice payments through Stripe Connect (additive).
--
-- The platform's Stripe account is Verexa HQ's. Each office connects its OWN Stripe account (Standard account, direct
-- charges): a client's payment is created on the office's account and lands there, so the platform never holds or
-- moves the office's money. Verexa's own revenue (SMS credits, number fees) stays on Verexa's account, unchanged.
--
-- payment_connections  which Stripe account an office has connected (one per office), and whether it can take charges.
-- invoice_payments     one Checkout Session per attempt to pay an invoice online. At most one is open per invoice. A
--                      paid session is applied to the invoice once, by portal_apply_payment (one statement, atomic).
-- portal_apply_payment marks an open payment paid and adds its amount to the invoice (capped at the total; the invoice
--                      becomes paid when covered). Returns the invoice row only the first time; a repeat returns nothing.
--
-- Same tenant rules as every table since Step 0.

create table if not exists public.payment_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  stripe_account_id text not null check (stripe_account_id ~ '^acct_[A-Za-z0-9]{6,64}$'),
  livemode boolean not null,
  status text not null default 'connected' check (status in ('connected', 'disconnected')),
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  connected_by uuid references auth.users(id) on delete set null,
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists payment_connections_tenant_key on public.payment_connections (tenant_id);
-- One Stripe account belongs to one office at a time.
create unique index if not exists payment_connections_account_key on public.payment_connections (stripe_account_id) where status = 'connected';
create index if not exists payment_connections_account_idx on public.payment_connections (stripe_account_id);

create table if not exists public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  invoice_id uuid not null,
  client_id uuid not null,
  stripe_account_id text not null check (stripe_account_id ~ '^acct_[A-Za-z0-9]{6,64}$'),
  stripe_session_id text check (stripe_session_id is null or stripe_session_id ~ '^cs_[A-Za-z0-9_]{6,200}$'),
  payment_intent_id text check (payment_intent_id is null or length(payment_intent_id) <= 100),
  amount_cents integer not null check (amount_cents between 50 and 100000000),
  status text not null default 'open' check (status in ('open', 'paid', 'expired', 'failed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  closed_at timestamptz
);
create unique index if not exists invoice_payments_session_key on public.invoice_payments (stripe_session_id) where stripe_session_id is not null;
create unique index if not exists invoice_payments_one_open on public.invoice_payments (tenant_id, invoice_id) where status = 'open';
create index if not exists invoice_payments_invoice_idx on public.invoice_payments (tenant_id, invoice_id, created_at desc);
create unique index if not exists invoice_payments_tenant_id_id_key on public.invoice_payments (tenant_id, id);

create or replace function public.payment_connections_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
create or replace trigger payment_connections_touch before update on public.payment_connections for each row execute function public.payment_connections_touch();

do $$
declare
  t text;
  tenant_tables text[] := array['payment_connections', 'invoice_payments'];
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

  -- A payment can only point at its own tenant's invoice and client.
  if not exists (select 1 from pg_constraint where conname = 'invoice_payments_invoice_id_same_tenant') then
    alter table public.invoice_payments add constraint invoice_payments_invoice_id_same_tenant foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoice_payments_client_id_same_tenant') then
    alter table public.invoice_payments add constraint invoice_payments_client_id_same_tenant foreign key (tenant_id, client_id) references public.clients (tenant_id, id);
  end if;
end $$;

create or replace function public.portal_apply_payment(p_payment uuid, p_payment_intent text default null)
returns setof public.invoices
language sql set search_path = public as $$
  with p as (
    update public.invoice_payments
       set status = 'paid', paid_at = now(), closed_at = now(), payment_intent_id = coalesce(p_payment_intent, payment_intent_id)
     where id = p_payment and status = 'open'
    returning tenant_id, invoice_id, amount_cents
  )
  update public.invoices i
     set paid_cents = least(i.total_cents, i.paid_cents + p.amount_cents),
         status = case when least(i.total_cents, i.paid_cents + p.amount_cents) >= i.total_cents then 'paid' else i.status end,
         paid_on = case when least(i.total_cents, i.paid_cents + p.amount_cents) >= i.total_cents then current_date else i.paid_on end
    from p
   where i.id = p.invoice_id and i.tenant_id = p.tenant_id and i.status <> 'void'
  returning i.*;
$$;
revoke all on function public.portal_apply_payment(uuid, text) from public, anon, authenticated;
grant execute on function public.portal_apply_payment(uuid, text) to service_role, tenant_app;
