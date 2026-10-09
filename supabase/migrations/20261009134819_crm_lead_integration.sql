-- Buyer-specific GoHighLevel (HighLevel / LeadConnector) lead delivery.
--
-- Each calculator license connects its own HighLevel sub-account (location)
-- through OAuth. Tokens are stored only as AES-256-GCM ciphertext produced by
-- the server (key in the MONARCH_ENCRYPTION_KEY environment variable, never in
-- the database). Lead contact details are stored encrypted only until they are
-- delivered (or for at most 30 days), then purged.
--
-- Additive only; safe to re-run. All tables: RLS on, no anon/authenticated
-- access, service role only (server code after its own authorization checks).

set local lock_timeout = '10s';

-- One-time OAuth state values (CSRF protection), bound to a license.
create table if not exists public.crm_oauth_states (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique check (state_hash ~ '^[0-9a-f]{64}$'),
  license_id uuid not null references public.calculator_licenses (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists crm_oauth_states_expires_idx on public.crm_oauth_states (expires_at);

-- A license's connection to one HighLevel location.
create table if not exists public.crm_connections (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.calculator_licenses (id) on delete cascade,
  customer_id uuid not null references public.calculator_customers (id) on delete cascade,
  provider text not null default 'highlevel' check (provider = 'highlevel'),
  location_id text not null check (location_id ~ '^[A-Za-z0-9_-]{6,64}$'),
  location_name text check (location_name is null or char_length(location_name) <= 200),
  company_id text check (company_id is null or char_length(company_id) <= 64),
  scopes text[] not null default '{}',
  access_token_enc text,
  refresh_token_enc text,
  token_expires_at timestamptz,
  status text not null check (status in ('connected','reauth_required','disconnected')),
  refresh_lock_until timestamptz,
  last_refresh_at timestamptz,
  last_success_at timestamptz,
  last_checked_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  last_error_at timestamptz,
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A disconnected connection holds no credentials.
  constraint crm_connections_tokens_cleared check (status <> 'disconnected' or (access_token_enc is null and refresh_token_enc is null))
);
-- At most one live (non-disconnected) connection per license.
create unique index if not exists crm_connections_one_live on public.crm_connections (license_id) where status <> 'disconnected';
create index if not exists crm_connections_license_idx on public.crm_connections (license_id, created_at desc);

-- Buyer lead-capture settings, per license (kept across reconnects).
create table if not exists public.crm_lead_settings (
  license_id uuid primary key references public.calculator_licenses (id) on delete cascade,
  enabled boolean not null default false,
  business_name text check (business_name is null or char_length(business_name) between 1 and 120),
  lead_source text not null default 'Monarch Tax Calculator' check (char_length(lead_source) between 1 and 80),
  tags text[] not null default '{}' check (cardinality(tags) <= 10),
  update_existing boolean not null default false,
  include_summary boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Calculator lead submissions and their delivery state.
create table if not exists public.calculator_leads (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.calculator_licenses (id) on delete cascade,
  connection_id uuid references public.crm_connections (id) on delete set null,
  submission_id uuid not null,
  location_id text,
  status text not null check (status in ('received','sending','sent','retry_pending','reauth_required','failed')),
  payload_enc text,
  email_masked text check (email_masked is null or char_length(email_masked) <= 80),
  embed_host text check (embed_host is null or char_length(embed_host) <= 253),
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz,
  lock_until timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  ghl_contact_id text check (ghl_contact_id is null or char_length(ghl_contact_id) <= 64),
  contact_created boolean,
  tags_applied boolean not null default false,
  note_added boolean not null default false,
  delivered_at timestamptz,
  payload_purged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calculator_leads_submission_unique unique (license_id, submission_id)
);
create index if not exists calculator_leads_license_idx on public.calculator_leads (license_id, created_at desc);
create index if not exists calculator_leads_due_idx on public.calculator_leads (next_attempt_at) where status in ('received','retry_pending','sending');
create index if not exists calculator_leads_ip_idx on public.calculator_leads (ip_hash, created_at) where ip_hash is not null;

-- updated_at maintenance (reuses the commerce helper when present).
do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at' and pronamespace = 'public'::regnamespace) then
    execute 'create or replace trigger crm_connections_updated_at before update on public.crm_connections for each row execute function public.set_updated_at()';
    execute 'create or replace trigger crm_lead_settings_updated_at before update on public.crm_lead_settings for each row execute function public.set_updated_at()';
    execute 'create or replace trigger calculator_leads_updated_at before update on public.calculator_leads for each row execute function public.set_updated_at()';
  end if;
end $$;

alter table public.crm_oauth_states enable row level security;
alter table public.crm_connections enable row level security;
alter table public.crm_lead_settings enable row level security;
alter table public.calculator_leads enable row level security;
revoke all on table public.crm_oauth_states, public.crm_connections, public.crm_lead_settings, public.calculator_leads from anon, authenticated;
grant select, insert, update, delete on table public.crm_oauth_states, public.crm_connections, public.crm_lead_settings, public.calculator_leads to service_role;

-- Atomic claims used by the server (service role only).
create or replace function public.crm_claim_lead(p_id uuid, p_lock_until timestamptz)
returns setof public.calculator_leads
language sql
set search_path = ''
as $$
  update public.calculator_leads
     set status = 'sending', lock_until = p_lock_until
   where id = p_id
     and ((status in ('received','retry_pending') and next_attempt_at <= now())
          or (status = 'sending' and lock_until < now()))
  returning *;
$$;

create or replace function public.crm_due_lead_ids(p_limit integer, p_license_id uuid default null)
returns setof uuid
language sql
stable
set search_path = ''
as $$
  select id from public.calculator_leads
   where (p_license_id is null or license_id = p_license_id)
     and ((status in ('received','retry_pending') and next_attempt_at <= now())
          or (status = 'sending' and lock_until < now()))
   order by next_attempt_at nulls first
   limit greatest(1, least(p_limit, 200));
$$;

create or replace function public.crm_claim_refresh_lock(p_id uuid, p_until timestamptz)
returns boolean
language sql
set search_path = ''
as $$
  with claimed as (
    update public.crm_connections
       set refresh_lock_until = p_until
     where id = p_id and status = 'connected'
       and (refresh_lock_until is null or refresh_lock_until < now())
    returning 1
  )
  select exists (select 1 from claimed);
$$;

revoke all on function public.crm_claim_lead(uuid, timestamptz), public.crm_due_lead_ids(integer, uuid), public.crm_claim_refresh_lock(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.crm_claim_lead(uuid, timestamptz), public.crm_due_lead_ids(integer, uuid), public.crm_claim_refresh_lock(uuid, timestamptz) to service_role;

-- Compatibility check (rolled back): the new tables accept rows linked to
-- existing licenses and customers, and the one-live-connection rule holds.
do $$
declare
  l uuid;
  c uuid;
begin
  select id, customer_id into l, c from public.calculator_licenses limit 1;
  if l is null then return; end if;
  begin
    insert into public.crm_connections (license_id, customer_id, location_id, status, access_token_enc, refresh_token_enc)
      values (l, c, 'compatLocation01', 'connected', 'v1:x', 'v1:y');
    begin
      insert into public.crm_connections (license_id, customer_id, location_id, status) values (l, c, 'compatLocation02', 'connected');
      raise exception 'one-live-connection rule not enforced';
    exception when unique_violation then null;
    end;
    insert into public.calculator_leads (license_id, submission_id, status) values (l, gen_random_uuid(), 'received');
    raise exception 'monarch_compat_ok';
  exception when others then
    if sqlerrm <> 'monarch_compat_ok' then
      raise exception 'CRM lead integration compatibility check failed: %', sqlerrm;
    end if;
  end;
end $$;
