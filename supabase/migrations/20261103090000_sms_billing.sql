-- Text messaging billing and self-serve setup, per tenant.
--
-- Pricing (lib/sms/pricing.ts): text credits are bought in packs by card; a number is set up with a one-time card
-- payment; each month the number renews from credits. Tenant #1 pays Twilio directly and uses none of this.
--
-- sms_checkouts        every card checkout a tenant starts (a credit pack, or number setup), with the exact amount
--                      expected. A payment is honoured only when Stripe confirms it paid that amount for that tenant.
-- sms_credit_ledger    credits are only ever: bought (purchase), spent on a text (send), returned when a text the
--                      tenant sent is refused (send_reversal), taken for the monthly number (renewal), or forfeited
--                      30 days after a missed renewal (forfeit). No transfers, no refunds, no manual credits:
--                      tenants can read the ledger but not write it; the functions below are the only writers.
-- tenant_sms_accounts  gains the number type, the guided registration answers and the Twilio ids it produced, the
--                      setup payment and provisioning state, and the renewal schedule.
--
-- Every new table belongs to one tenant from day one.

-- ---------------------------------------------------------------- checkouts

create table if not exists public.sms_checkouts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  stripe_session_id text check (stripe_session_id is null or stripe_session_id ~ '^cs_(test|live)_[A-Za-z0-9]{10,200}$'),
  purpose text not null check (purpose in ('credits', 'setup')),
  number_type text check (number_type is null or number_type in ('toll_free', 'local')),
  packs integer check (packs is null or packs between 1 and 20),
  credits integer check (credits is null or credits between 1 and 100000),
  amount_cents integer not null check (amount_cents between 1 and 1000000),
  currency text not null default 'usd' check (currency = 'usd'),
  status text not null default 'open' check (status in ('open', 'paid', 'expired')),
  paid_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((purpose = 'credits' and packs is not null and credits is not null) or (purpose = 'setup' and number_type is not null))
);
create unique index if not exists sms_checkouts_session_key on public.sms_checkouts (stripe_session_id) where stripe_session_id is not null;
create index if not exists sms_checkouts_recent_idx on public.sms_checkouts (tenant_id, created_at desc);

do $$
declare
  t text;
  tenant_tables text[] := array['sms_checkouts'];
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
create unique index if not exists sms_checkouts_tenant_id_id_key on public.sms_checkouts (tenant_id, id);

-- ---------------------------------------------------------------- the texting account: setup and renewal

alter table public.tenant_sms_accounts drop constraint if exists tenant_sms_accounts_status_check;
alter table public.tenant_sms_accounts add constraint tenant_sms_accounts_status_check check (status in ('setting_up', 'active', 'paused', 'released', 'suspended'));
alter table public.tenant_sms_accounts add column if not exists number_type text check (number_type is null or number_type in ('toll_free', 'local'));
-- The guided registration answers (business details, opt-in, sample messages). No secrets.
alter table public.tenant_sms_accounts add column if not exists registration jsonb not null default '{}'::jsonb check (jsonb_typeof(registration) = 'object');
-- Twilio ids the registration produced, step by step, so a half-finished registration carries on where it stopped.
alter table public.tenant_sms_accounts add column if not exists registration_sids jsonb not null default '{}'::jsonb check (jsonb_typeof(registration_sids) = 'object');
alter table public.tenant_sms_accounts add column if not exists registration_error text check (registration_error is null or length(registration_error) <= 500);
alter table public.tenant_sms_accounts add column if not exists chosen_number text check (chosen_number is null or chosen_number ~ '^\+[1-9][0-9]{7,14}$');
alter table public.tenant_sms_accounts add column if not exists setup_paid_at timestamptz;
alter table public.tenant_sms_accounts add column if not exists provision_status text not null default 'none' check (provision_status in ('none', 'provisioning', 'done', 'error'));
alter table public.tenant_sms_accounts add column if not exists provision_error text check (provision_error is null or length(provision_error) <= 500);
alter table public.tenant_sms_accounts add column if not exists renews_on date;
alter table public.tenant_sms_accounts add column if not exists renewal_failed_at timestamptz;
alter table public.tenant_sms_accounts add column if not exists renewal_attempts integer not null default 0 check (renewal_attempts between 0 and 3);
alter table public.tenant_sms_accounts add column if not exists released_at timestamptz;
alter table public.tenant_sms_accounts add column if not exists forfeited_at timestamptz;

-- ---------------------------------------------------------------- the credit ledger: read-only to tenants

alter table public.sms_credit_ledger drop constraint if exists sms_credit_ledger_kind_check;
alter table public.sms_credit_ledger add constraint sms_credit_ledger_kind_check check (kind in ('purchase', 'send', 'send_reversal', 'renewal', 'forfeit'));
revoke insert, update, delete on table public.sms_credit_ledger from tenant_app, authenticated, anon;
grant select on table public.sms_credit_ledger to tenant_app;
create unique index if not exists sms_credit_ledger_reversal_once on public.sms_credit_ledger (tenant_id, reference) where kind = 'send_reversal';
create unique index if not exists sms_credit_ledger_renewal_once on public.sms_credit_ledger (tenant_id, reference) where kind = 'renewal';
create unique index if not exists sms_credit_ledger_forfeit_once on public.sms_credit_ledger (tenant_id, reference) where kind = 'forfeit';

-- The only writers. Each acts for the request's tenant (require_tenant_id) and nobody else; they run with the owner's
-- rights only so that tenants themselves can't write the ledger. One lock per tenant keeps balances exact.

create or replace function public.sms_lock_and_balance(t uuid) returns bigint
language plpgsql security definer set search_path = public as $$
declare have bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('sms_credits:' || t::text, 0));
  select coalesce(sum(delta), 0) into have from public.sms_credit_ledger where tenant_id = t;
  return have;
end $$;
revoke all on function public.sms_lock_and_balance(uuid) from public, anon, authenticated, tenant_app;

drop function if exists public.spend_sms_credits(integer, text);
create or replace function public.spend_sms_credits(p_segments integer, p_reference text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.require_tenant_id();
begin
  if p_segments is null or p_segments < 1 or p_segments > 100 then raise exception 'segments must be between 1 and 100'; end if;
  if public.sms_lock_and_balance(t) < p_segments then return false; end if;
  insert into public.sms_credit_ledger (tenant_id, delta, kind, reference) values (t, -p_segments, 'send', left(p_reference, 200));
  return true;
end $$;

-- A text the tenant sent that the carrier refused gives back exactly what it took, once.
create or replace function public.reverse_sms_send(p_reference text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.require_tenant_id();
  spent integer;
begin
  perform public.sms_lock_and_balance(t);
  select -delta into spent from public.sms_credit_ledger where tenant_id = t and kind = 'send' and reference = p_reference;
  if spent is null then return 0; end if;
  insert into public.sms_credit_ledger (tenant_id, delta, kind, reference, note) values (t, spent, 'send_reversal', p_reference, 'Text not sent')
    on conflict do nothing;
  return spent;
end $$;

-- Credits a paid credit-pack checkout, once. The app calls it only after Stripe confirmed the payment; the checkout row
-- (made when the tenant started it) decides how many credits, never the caller.
create or replace function public.credit_sms_purchase(p_session_id text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.require_tenant_id();
  c public.sms_checkouts%rowtype;
begin
  select * into c from public.sms_checkouts where tenant_id = t and stripe_session_id = p_session_id and purpose = 'credits';
  if not found then raise exception 'SMS_CHECKOUT_NOT_FOUND'; end if;
  perform public.sms_lock_and_balance(t);
  update public.sms_checkouts set status = 'paid', paid_at = coalesce(paid_at, now()) where id = c.id;
  insert into public.sms_credit_ledger (tenant_id, delta, kind, reference, note)
    values (t, c.credits, 'purchase', p_session_id, c.credits || ' text credits') on conflict do nothing;
  return c.credits;
end $$;

-- Takes the month's number fee from credits if the balance covers it. One charge per period.
create or replace function public.charge_sms_renewal(p_credits integer, p_period text, p_note text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.require_tenant_id();
begin
  if p_credits is null or p_credits < 1 or p_credits > 10000 then raise exception 'renewal credits out of range'; end if;
  if exists (select 1 from public.sms_credit_ledger where tenant_id = t and kind = 'renewal' and reference = p_period) then return true; end if;
  if public.sms_lock_and_balance(t) < p_credits then return false; end if;
  insert into public.sms_credit_ledger (tenant_id, delta, kind, reference, note) values (t, -p_credits, 'renewal', p_period, left(p_note, 300));
  return true;
end $$;

-- 30 days after a missed renewal, whatever is left is forfeited. Returns how many credits.
create or replace function public.forfeit_sms_credits(p_reference text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.require_tenant_id();
  have bigint;
begin
  have := public.sms_lock_and_balance(t);
  if have <= 0 then return 0; end if;
  insert into public.sms_credit_ledger (tenant_id, delta, kind, reference, note) values (t, -have, 'forfeit', p_reference, 'Forfeited: no renewal for 30 days')
    on conflict do nothing;
  return have;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.spend_sms_credits(integer, text)', 'public.reverse_sms_send(text)', 'public.credit_sms_purchase(text)', 'public.charge_sms_renewal(integer, text, text)', 'public.forfeit_sms_credits(text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role, tenant_app', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
