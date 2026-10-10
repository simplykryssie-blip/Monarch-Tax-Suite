-- Automation Center: email templates, workflows, events, executions, secure setup links and an audit trail.
--
-- ADDITIVE ONLY: new tables, indexes and RLS. Nothing existing is altered or dropped.
-- NOT APPLIED to production by the pull request that adds it; apply deliberately after review.
--
-- Access model (same as the rest of Monarch): RLS on every table, no anon/authenticated grants.
-- Server code uses the service role only after checking admin_users (administrators) or, for
-- onboarding links, a hashed single-license token.
--
-- Privacy: events and executions hold ids, statuses and error categories only. They never hold
-- lead contents, license keys, OAuth tokens, webhook URLs or signing secrets.

set local lock_timeout = '10s';

create table if not exists public.automation_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text unique check (template_key is null or template_key ~ '^[a-z0-9_]{3,60}$'),
  name text not null check (char_length(name) between 2 and 120),
  subject text not null check (char_length(subject) between 1 and 200),
  body text not null check (char_length(body) between 1 and 20000),
  active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.automation_workflows (
  id uuid primary key default gen_random_uuid(),
  workflow_key text unique check (workflow_key is null or workflow_key ~ '^[a-z0-9_]{3,60}$'),
  name text not null check (char_length(name) between 2 and 120),
  description text check (description is null or char_length(description) <= 1000),
  trigger_event text not null check (char_length(trigger_event) between 3 and 60),
  conditions jsonb not null default '[]'::jsonb check (jsonb_typeof(conditions) = 'array'),
  actions jsonb not null default '[]'::jsonb check (jsonb_typeof(actions) = 'array'),
  status text not null default 'paused' check (status in ('active','paused','archived')),
  max_attempts integer not null default 4 check (max_attempts between 1 and 8),
  cooldown_hours integer not null default 0 check (cooldown_hours between 0 and 720),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists automation_workflows_trigger_idx on public.automation_workflows (trigger_event) where status = 'active';

-- One row per real-world event. event_key makes emission idempotent: the same payment, license,
-- connection or lead submission can never start a second round of workflows.
create table if not exists public.automation_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique check (char_length(event_key) between 3 and 200),
  event_type text not null check (char_length(event_type) between 3 and 60),
  license_id uuid references public.calculator_licenses (id) on delete set null,
  customer_id uuid references public.calculator_customers (id) on delete set null,
  order_id uuid references public.orders (id) on delete set null,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists automation_events_type_idx on public.automation_events (event_type, created_at desc);
create index if not exists automation_events_license_idx on public.automation_events (license_id, created_at desc);

create table if not exists public.automation_executions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.automation_workflows (id) on delete restrict,
  event_id uuid not null references public.automation_events (id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','running','retrying','succeeded','failed','skipped')),
  is_test boolean not null default false,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 4 check (max_attempts between 1 and 8),
  next_attempt_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  action_log jsonb not null default '[]'::jsonb check (jsonb_typeof(action_log) = 'array'),
  error text check (error is null or char_length(error) <= 1000),
  error_kind text check (error_kind is null or error_kind in ('config','transient','permanent','skipped')),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- A workflow runs at most once per event (tests are exempt).
create unique index if not exists automation_executions_once on public.automation_executions (workflow_id, event_id) where not is_test;
create index if not exists automation_executions_due_idx on public.automation_executions (next_attempt_at) where status in ('queued','retrying');
create index if not exists automation_executions_status_idx on public.automation_executions (status, created_at desc);

-- Secure customer setup links: only a hash of the token is stored; links expire and can be revoked.
create table if not exists public.onboarding_links (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.calculator_licenses (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  first_opened_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists onboarding_links_license_idx on public.onboarding_links (license_id, created_at desc);

create table if not exists public.automation_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) between 3 and 80),
  target_type text check (target_type is null or char_length(target_type) <= 40),
  target_id text check (target_id is null or char_length(target_id) <= 80),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists automation_audit_created_idx on public.automation_audit_log (created_at desc);
create index if not exists automation_audit_actor_idx on public.automation_audit_log (actor_id, action, created_at desc);

do $$
declare
  t text;
begin
  foreach t in array array['automation_templates','automation_workflows'] loop
    execute format('create or replace trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
  create or replace trigger set_updated_at before update on public.automation_executions for each row execute function public.set_updated_at();
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['automation_templates','automation_workflows','automation_events','automation_executions','onboarding_links','automation_audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;
