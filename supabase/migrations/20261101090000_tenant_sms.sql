-- Part B follow-up: text messaging per tenant.
--
-- Each tax office sends from its own Twilio account. Tenant #1 (Monarch) uses the owner's own account, set in Vercel,
-- and needs no row here. Every other tenant gets a Twilio subaccount under the owner's account:
--
-- tenant_sms_accounts  one per tenant: its subaccount, the API key it sends with (the secret encrypted by the app with
--                      MONARCH_ENCRYPTION_KEY; never stored in plain text), its number or messaging service, and its
--                      carrier registration status (A2P 10DLC). Texts are refused until registration is approved.
-- sms_credit_ledger    prepaid text credits. Twilio bills every subaccount to the owner's account, so a tenant buys
--                      credits and each text spends one credit per message segment. The balance is the sum of the
--                      ledger; spend_sms_credits takes credits only when the balance covers them, one request at a time.
-- client_messages      gains `segments`, what each text cost.
--
-- Both tables belong to one tenant from day one.

create table if not exists public.tenant_sms_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  subaccount_sid text check (subaccount_sid is null or subaccount_sid ~ '^AC[0-9a-fA-F]{32}$'),
  api_key_sid text check (api_key_sid is null or api_key_sid ~ '^SK[0-9a-fA-F]{32}$'),
  api_key_secret_encrypted text check (api_key_secret_encrypted is null or length(api_key_secret_encrypted) <= 500),
  from_number text check (from_number is null or from_number ~ '^\+[1-9][0-9]{7,14}$'),
  phone_number_sid text check (phone_number_sid is null or phone_number_sid ~ '^PN[0-9a-fA-F]{32}$'),
  messaging_service_sid text check (messaging_service_sid is null or messaging_service_sid ~ '^MG[0-9a-fA-F]{32}$'),
  registration_status text not null default 'not_started' check (registration_status in ('not_started', 'submitted', 'approved', 'rejected')),
  status text not null default 'setting_up' check (status in ('setting_up', 'active', 'suspended')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists tenant_sms_accounts_one_per_tenant on public.tenant_sms_accounts (tenant_id);
create unique index if not exists tenant_sms_accounts_subaccount_key on public.tenant_sms_accounts (subaccount_sid) where subaccount_sid is not null;

create table if not exists public.sms_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  delta integer not null check (delta <> 0 and abs(delta) <= 1000000),
  kind text not null check (kind in ('purchase', 'grant', 'send', 'refund')),
  reference text check (reference is null or length(reference) <= 200),
  note text check (note is null or length(note) <= 300),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists sms_credit_ledger_recent_idx on public.sms_credit_ledger (tenant_id, created_at desc);
-- A purchase (for example a payment id) is credited once.
create unique index if not exists sms_credit_ledger_purchase_once on public.sms_credit_ledger (tenant_id, reference) where kind = 'purchase';

create or replace trigger tenant_sms_accounts_touch before update on public.tenant_sms_accounts for each row execute function public.round2_touch();

do $$
declare
  t text;
  tenant_tables text[] := array['tenant_sms_accounts', 'sms_credit_ledger'];
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

create unique index if not exists tenant_sms_accounts_tenant_id_id_key on public.tenant_sms_accounts (tenant_id, id);
create unique index if not exists sms_credit_ledger_tenant_id_id_key on public.sms_credit_ledger (tenant_id, id);

-- Spends credits for the request's tenant only if its balance covers them. Runs as the caller, so the tenant policies
-- apply; the per-tenant lock makes two texts sent at once unable to spend the same credits.
create or replace function public.spend_sms_credits(p_segments integer, p_reference text) returns boolean
language plpgsql security invoker set search_path = public as $$
declare
  t uuid := public.require_tenant_id();
  have bigint;
begin
  if p_segments is null or p_segments < 1 or p_segments > 100 then
    raise exception 'segments must be between 1 and 100';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sms_credits:' || t::text, 0));
  select coalesce(sum(delta), 0) into have from public.sms_credit_ledger where tenant_id = t;
  if have < p_segments then
    return false;
  end if;
  insert into public.sms_credit_ledger (tenant_id, delta, kind, reference) values (t, -p_segments, 'send', left(p_reference, 200));
  return true;
end $$;
revoke all on function public.spend_sms_credits(integer, text) from public, anon, authenticated;
grant execute on function public.spend_sms_credits(integer, text) to service_role, tenant_app;

alter table public.client_messages add column if not exists segments integer check (segments is null or segments between 1 and 100);

notify pgrst, 'reload schema';
