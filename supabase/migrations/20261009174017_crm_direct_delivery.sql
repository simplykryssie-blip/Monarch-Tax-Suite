-- Direct, buyer-owned lead delivery. Monarch does not store leads.
--
-- (Lead storage is removed separately: 20261009180000_remove_lead_storage.sql.)
-- 1. Extends buyer CRM destinations (crm_connections) with signed webhooks.
--    Webhook URLs and signing secrets are stored only as server-side
--    AES-256-GCM ciphertext, like HighLevel tokens.
-- 2. Adds lead_delivery_log: delivery diagnostics without personal data
--    (no names, emails, phones or calculator values).
--
-- Customer, order, license, installation and product records are untouched.

set local lock_timeout = '10s';

-- Buyer destinations: HighLevel (OAuth) or a signed webhook.
alter table public.crm_connections alter column location_id drop not null;
alter table public.crm_connections
  add column if not exists webhook_url_enc text,
  add column if not exists webhook_host text check (webhook_host is null or char_length(webhook_host) <= 253),
  add column if not exists signing_secret_enc text;

alter table public.crm_connections drop constraint if exists crm_connections_provider_check;
alter table public.crm_connections add constraint crm_connections_provider_check check (provider in ('highlevel','webhook'));

alter table public.crm_connections drop constraint if exists crm_connections_tokens_cleared;
alter table public.crm_connections add constraint crm_connections_tokens_cleared check (
  status <> 'disconnected'
  or (access_token_enc is null and refresh_token_enc is null and webhook_url_enc is null and signing_secret_enc is null)
);

alter table public.crm_connections drop constraint if exists crm_connections_provider_fields;
alter table public.crm_connections add constraint crm_connections_provider_fields check (
  (provider = 'highlevel' and location_id is not null and webhook_url_enc is null)
  or (provider = 'webhook' and location_id is null and access_token_enc is null and refresh_token_enc is null
      and (status = 'disconnected' or (webhook_url_enc is not null and webhook_host is not null and signing_secret_enc is not null)))
);

-- Delivery diagnostics (no personal data). ip_hash is a keyed hash used only
-- for rate limiting; the server clears it after 24 hours and deletes rows
-- after 30 days.
create table if not exists public.lead_delivery_log (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.calculator_licenses (id) on delete cascade,
  provider text check (provider is null or provider in ('highlevel','webhook')),
  outcome text not null check (outcome in ('sent','failed','rejected')),
  reason text check (reason is null or char_length(reason) <= 80),
  http_status integer,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create index if not exists lead_delivery_log_license_idx on public.lead_delivery_log (license_id, created_at desc);
create index if not exists lead_delivery_log_ip_idx on public.lead_delivery_log (ip_hash, created_at) where ip_hash is not null;
create index if not exists lead_delivery_log_created_idx on public.lead_delivery_log (created_at);

alter table public.lead_delivery_log enable row level security;
revoke all on table public.lead_delivery_log from anon, authenticated;
grant select, insert, update, delete on table public.lead_delivery_log to service_role;

-- Compatibility check (rolled back): both destination kinds fit the rules.
do $$
declare
  l uuid;
  c uuid;
begin
  select id, customer_id into l, c from public.calculator_licenses limit 1;
  if l is null then return; end if;
  begin
    insert into public.crm_connections (license_id, customer_id, provider, status, webhook_url_enc, webhook_host, signing_secret_enc)
      values (l, c, 'webhook', 'connected', 'v1:u', 'hooks.example.com', 'v1:s');
    insert into public.lead_delivery_log (license_id, provider, outcome, reason) values (l, 'webhook', 'sent', null);
    raise exception 'monarch_compat_ok';
  exception when others then
    if sqlerrm <> 'monarch_compat_ok' then
      raise exception 'Direct delivery compatibility check failed: %', sqlerrm;
    end if;
  end;
end $$;
