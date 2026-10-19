-- Phase 5e: the campaign builder (additive).
--
-- marketing_consents    the consent ledger for bulk email and text: one row per person (by email) saying why the office may
--                       send them campaigns (a form opt-in, the owner marked them, a CSV import) and whether they agreed to
--                       texts. Existing clients and people who booked an appointment are marketable without a row; a
--                       row can also be revoked.
-- marketing_suppressions  addresses this office must not send campaigns to (unsubscribed, replied STOP, bounced,
--                       complained). Per office: unsubscribing from one office never affects another.
-- platform_suppressions   the ONE platform-wide list: hard bounces and spam complaints only. It holds a keyed hash of the
--                       address (never the address), has no tenant_id on purpose (it is about the address, not an office)
--                       and is reachable only by the server's platform access.
-- audience_segments     a saved audience (filters by tag, status, kind).
-- campaigns             an email or text campaign: audience, message, schedule, status.
-- campaign_recipients   who a campaign was (or will be) sent to and what happened: sent, delivered, opened, clicked,
--                       bounced, complained, unsubscribed.
-- campaign_links        the links in a campaign's email, so a click can be counted and sent on.
-- campaign_claim        atomically takes a batch of queued recipients, so two ticks never send the same one twice.
--
-- Same tenant rules as every table since Step 0 for the tenant tables.

create table if not exists public.marketing_consents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  email text not null check (length(email) between 3 and 254 and email = lower(email)),
  basis text not null check (basis in ('form', 'owner', 'import')),
  sms_consent boolean not null default false,
  sms_consent_at timestamptz,
  note text check (note is null or length(note) <= 200),
  marked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sms_consent = (sms_consent_at is not null))
);
create unique index if not exists marketing_consents_email_key on public.marketing_consents (tenant_id, email);

create table if not exists public.marketing_suppressions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  channel text not null check (channel in ('email', 'sms')),
  address text not null check (length(address) between 3 and 254 and address = lower(address)),
  reason text not null check (reason in ('unsubscribed', 'stop', 'bounced', 'complaint', 'manual')),
  campaign_id uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists marketing_suppressions_key on public.marketing_suppressions (tenant_id, channel, address);

create table if not exists public.platform_suppressions (
  address_hash text not null check (address_hash ~ '^[0-9a-f]{64}$'),
  channel text not null check (channel in ('email', 'sms')),
  reason text not null check (reason in ('hard_bounce', 'complaint')),
  created_at timestamptz not null default now(),
  primary key (channel, address_hash)
);
alter table public.platform_suppressions enable row level security;
revoke all on table public.platform_suppressions from anon, authenticated, tenant_app;
grant select, insert on table public.platform_suppressions to service_role;

create table if not exists public.audience_segments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null check (length(name) between 1 and 80),
  filter jsonb not null default '{}'::jsonb check (jsonb_typeof(filter) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists audience_segments_name_key on public.audience_segments (tenant_id, lower(name));

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null check (length(name) between 1 and 120),
  channel text not null check (channel in ('email', 'sms')),
  subject text check (subject is null or length(subject) between 1 and 200),
  body text not null default '' check (length(body) <= 20000),
  sender_id uuid,
  audience jsonb not null default '{}'::jsonb check (jsonb_typeof(audience) = 'object'),
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'sent', 'paused', 'cancelled')),
  send_at timestamptz,
  respect_hours boolean not null default true,
  paused_reason text check (paused_reason is null or length(paused_reason) <= 300),
  recipient_count integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (channel <> 'email' or status = 'draft' or subject is not null)
);
create index if not exists campaigns_tenant_status_idx on public.campaigns (tenant_id, status, send_at);
create unique index if not exists campaigns_tenant_id_id_key on public.campaigns (tenant_id, id);

create table if not exists public.campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  campaign_id uuid not null,
  contact_kind text not null check (contact_kind in ('lead', 'client')),
  contact_id uuid not null,
  name text check (name is null or length(name) <= 200),
  address text not null check (length(address) between 3 and 254),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'skipped')),
  skip_reason text check (skip_reason is null or length(skip_reason) <= 80),
  provider_id text check (provider_id is null or length(provider_id) <= 100),
  error text check (error is null or length(error) <= 300),
  segments integer check (segments is null or segments between 1 and 40),
  attempts integer not null default 0 check (attempts between 0 and 10),
  claimed_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  open_count integer not null default 0,
  clicked_at timestamptz,
  click_count integer not null default 0,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists campaign_recipients_person_key on public.campaign_recipients (campaign_id, contact_kind, contact_id);
create unique index if not exists campaign_recipients_token_key on public.campaign_recipients (token_hash);
create index if not exists campaign_recipients_queue_idx on public.campaign_recipients (tenant_id, campaign_id, status);
create index if not exists campaign_recipients_provider_idx on public.campaign_recipients (provider_id) where provider_id is not null;
create index if not exists campaign_recipients_sent_idx on public.campaign_recipients (tenant_id, sent_at) where sent_at is not null;

create table if not exists public.campaign_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  campaign_id uuid not null,
  position integer not null check (position between 0 and 99),
  url text not null check (url ~ '^https://' and length(url) <= 1000),
  click_count integer not null default 0
);
create unique index if not exists campaign_links_pos_key on public.campaign_links (campaign_id, position);

create or replace function public.campaigns_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
create or replace trigger campaigns_touch before update on public.campaigns for each row execute function public.campaigns_touch();
create or replace trigger marketing_consents_touch before update on public.marketing_consents for each row execute function public.campaigns_touch();

do $$
declare
  t text;
  tenant_tables text[] := array['marketing_consents', 'marketing_suppressions', 'audience_segments', 'campaigns', 'campaign_recipients', 'campaign_links'];
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

  -- A recipient, link or suppression can only point at its own tenant's campaign.
  if not exists (select 1 from pg_constraint where conname = 'campaign_recipients_campaign_same_tenant') then
    alter table public.campaign_recipients add constraint campaign_recipients_campaign_same_tenant foreign key (tenant_id, campaign_id) references public.campaigns (tenant_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'campaign_links_campaign_same_tenant') then
    alter table public.campaign_links add constraint campaign_links_campaign_same_tenant foreign key (tenant_id, campaign_id) references public.campaigns (tenant_id, id) on delete cascade;
  end if;
end $$;

-- Takes up to p_limit queued recipients of one campaign and marks them 'sending', skipping any another worker holds.
create or replace function public.campaign_claim(p_campaign uuid, p_limit integer) returns setof public.campaign_recipients
language sql set search_path = public as $$
  update public.campaign_recipients r
     set status = 'sending', claimed_at = now()
   where r.id in (
     select id from public.campaign_recipients
      where campaign_id = p_campaign and status = 'queued'
      order by created_at, id
      limit greatest(1, least(p_limit, 500))
      for update skip locked
   )
  returning r.*;
$$;
revoke all on function public.campaign_claim(uuid, integer) from public, anon, authenticated;
grant execute on function public.campaign_claim(uuid, integer) to service_role, tenant_app;

-- Counts an open or a click on a recipient (and, for a click, on the campaign's link) in one statement.
create or replace function public.campaign_note_event(p_recipient uuid, p_kind text, p_link_campaign uuid default null, p_link_position integer default null) returns void
language plpgsql set search_path = public as $$
begin
  if p_kind = 'open' then
    update public.campaign_recipients set open_count = open_count + 1, opened_at = coalesce(opened_at, now()) where id = p_recipient;
  elsif p_kind = 'click' then
    update public.campaign_recipients set click_count = click_count + 1, clicked_at = coalesce(clicked_at, now()), opened_at = coalesce(opened_at, now()) where id = p_recipient;
    if p_link_campaign is not null and p_link_position is not null then
      update public.campaign_links set click_count = click_count + 1 where campaign_id = p_link_campaign and position = p_link_position;
    end if;
  end if;
end $$;
revoke all on function public.campaign_note_event(uuid, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.campaign_note_event(uuid, text, uuid, integer) to service_role, tenant_app;
