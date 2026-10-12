-- Phase 2 Step 0: the tenant foundation.
--
-- 1. tenant_id on every tenant-owned table, backfilled to Monarch Tax Suite (tenant #1), NOT NULL, indexed, with a
--    foreign key to tenants. Rows inserted later take tenant_id from the request's tenant context; with no context the
--    insert fails (require_tenant_id()), so nothing is ever filed under a guessed tenant.
-- 2. Composite foreign keys (tenant_id, x_id) -> parent (tenant_id, id): a row can only point at rows of its own tenant,
--    whoever writes it (service role included).
-- 3. Per-tenant uniqueness where a value is the tenant's own name for something (product slug, customer email,
--    template and workflow keys, ...). Values that are globally unique by nature (Stripe ids, token hashes) stay global.
-- 4. tenant_members: who works for which tenant. Seeded from admin_users as Monarch owners.
-- 5. Row-level security scoped to the current tenant:
--    * tenant_app: the role the server runs tenant work as. PostgREST switches the service role to it when a request
--      carries x-tenant-id (pgrst_pre_request below); policies then allow exactly that tenant's rows.
--    * authenticated: a restrictive policy on every tenant table limits signed-in users to tenants they belong to.
--    * service_role (no x-tenant-id header): platform access, used only where the platform must act across tenants;
--      the app logs each use (lib/supabase/service.ts platformClient).
--
-- Platform-level tables (no tenant_id): tenants, tenant_members (carries tenant_id; its own policies),
-- admin_users (platform administrators), rate_limit_counters (abuse counters, if present).

set local lock_timeout = '10s';

-- ---------------------------------------------------------------------------------------------------------------
-- Tenant context
-- ---------------------------------------------------------------------------------------------------------------

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'tenant_app') then
    create role tenant_app nologin noinherit;
  end if;
end $$;
-- PostgREST connects as authenticator; SET ROLE needs the session user to be a member.
grant tenant_app to authenticator;
grant tenant_app to postgres;
grant usage on schema public to tenant_app;

create or replace function public.current_tenant_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

create or replace function public.require_tenant_id() returns uuid
language plpgsql stable as $$
declare t uuid := public.current_tenant_id();
begin
  if t is null then
    raise exception 'tenant_id is required: this request has no tenant context' using errcode = '23502';
  end if;
  return t;
end $$;

-- Runs before every PostgREST request. Only a service-role request that names a tenant is narrowed; anon and
-- authenticated requests are never changed, whatever headers they send. No SET clause on purpose: a function with
-- one would undo the SET LOCAL ROLE when it returns.
create or replace function public.pgrst_pre_request() returns void
language plpgsql as $$
declare
  h text;
  t uuid;
begin
  if current_user <> 'service_role' then
    return;
  end if;
  h := nullif(current_setting('request.headers', true), '')::json ->> 'x-tenant-id';
  if h is null then
    return;
  end if;
  begin
    t := h::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid tenant' using errcode = '28000';
  end;
  if not exists (select 1 from public.tenants where id = t) then
    raise exception 'unknown tenant' using errcode = '28000';
  end if;
  perform set_config('app.tenant_id', t::text, true);
  set local role tenant_app;
end $$;

revoke execute on function public.pgrst_pre_request() from public;
grant execute on function public.pgrst_pre_request() to anon, authenticated, service_role;
grant execute on function public.current_tenant_id() to anon, authenticated, service_role, tenant_app;
grant execute on function public.require_tenant_id() to service_role, tenant_app;

-- ---------------------------------------------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------------------------------------------

create table if not exists public.tenant_members (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'staff')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index if not exists tenant_members_user_idx on public.tenant_members (user_id);

insert into public.tenant_members (tenant_id, user_id, role)
select '00000000-0000-4000-8000-000000000001', user_id, 'owner' from public.admin_users
on conflict do nothing;

create or replace function public.my_tenant_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select tenant_id from public.tenant_members where user_id = auth.uid()
$$;
revoke execute on function public.my_tenant_ids() from public, anon;
grant execute on function public.my_tenant_ids() to authenticated, service_role;

alter table public.tenant_members enable row level security;
revoke all on table public.tenant_members from anon, authenticated;
grant select, insert, update, delete on table public.tenant_members to service_role;
grant select on table public.tenant_members to tenant_app, authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tenant_members' and policyname = 'tenant_members_own_tenant') then
    create policy tenant_members_own_tenant on public.tenant_members for select to tenant_app using (tenant_id = public.current_tenant_id());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tenant_members' and policyname = 'tenant_members_self') then
    create policy tenant_members_self on public.tenant_members for select to authenticated using (user_id = auth.uid());
  end if;
end $$;

grant select on table public.tenants to tenant_app;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tenants' and policyname = 'tenants_current') then
    create policy tenants_current on public.tenants for select to tenant_app using (id = public.current_tenant_id());
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- tenant_id on every tenant-owned table
-- ---------------------------------------------------------------------------------------------------------------

do $$
declare
  t text;
  tenant_tables text[] := array[
    'products', 'product_versions', 'product_version_changes', 'product_images', 'product_files', 'download_events',
    'calculator_customers', 'orders', 'storefront_checkouts', 'update_checkout_sessions', 'stripe_events',
    'calculator_licenses', 'calculator_license_events', 'calculator_authorized_domains',
    'calculator_installations', 'installation_events',
    'crm_connections', 'crm_lead_settings', 'crm_oauth_states', 'calculator_leads', 'lead_delivery_log',
    'automation_templates', 'automation_workflows', 'automation_events', 'automation_executions', 'automation_audit_log',
    'onboarding_links', 'onboarding_profiles',
    'organizations', 'people', 'organization_memberships', 'office_locations', 'organization_roles',
    'professional_credentials', 'efin_records', 'efin_assignments', 'filing_relationships', 'compliance_documents',
    'renewal_tasks', 'notification_events', 'bureau_options', 'organization_options', 'audit_events',
    'service_orders', 'service_order_events'
  ];
begin
  foreach t in array tenant_tables loop
    if to_regclass('public.' || t) is null then
      raise exception 'tenant foundation: table public.% is missing; apply the earlier migrations first', t;
    end if;
    -- A constant default backfills existing rows without rewriting them or firing row triggers (audit_events is
    -- append-only); it is replaced right after by the tenant-context default.
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'tenant_id') then
      execute format('alter table public.%I add column tenant_id uuid not null default %L', t, '00000000-0000-4000-8000-000000000001');
    end if;
    execute format('alter table public.%I alter column tenant_id set default public.require_tenant_id()', t);
    if not exists (select 1 from pg_constraint where conrelid = ('public.' || t)::regclass and conname = t || '_tenant_id_fkey') then
      execute format('alter table public.%I add constraint %I foreign key (tenant_id) references public.tenants (id) on delete restrict', t, t || '_tenant_id_fkey');
    end if;
    execute format('create index if not exists %I on public.%I (tenant_id)', t || '_tenant_idx', t);

    -- Row-level security.
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on table public.%I to tenant_app', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'tenant_isolation') then
      execute format('create policy tenant_isolation on public.%I as permissive for all to tenant_app using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id())', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'tenant_members_only') then
      execute format('create policy tenant_members_only on public.%I as restrictive for all to authenticated using (tenant_id in (select public.my_tenant_ids())) with check (tenant_id in (select public.my_tenant_ids()))', t);
    end if;
  end loop;
end $$;

grant usage, select on all sequences in schema public to tenant_app;

-- ---------------------------------------------------------------------------------------------------------------
-- A row can only reference rows of its own tenant
-- ---------------------------------------------------------------------------------------------------------------

do $$
declare
  p text;
  parents text[] := array[
    'products', 'product_versions', 'product_files', 'calculator_customers', 'orders', 'calculator_licenses',
    'calculator_installations', 'crm_connections', 'automation_workflows', 'automation_events',
    'organizations', 'people', 'office_locations', 'efin_records', 'renewal_tasks', 'bureau_options', 'service_orders'
  ];
  r record;
begin
  foreach p in array parents loop
    execute format('create unique index if not exists %I on public.%I (tenant_id, id)', p || '_tenant_id_id_key', p);
  end loop;

  -- Every single-column foreign key between two tenant tables gets a (tenant_id, column) twin. The original key keeps
  -- its delete behaviour; the twin uses NO ACTION, which is checked after cascades and SET NULL have run.
  for r in
    select c.conrelid::regclass::text as child, a.attname as col, c.confrelid::regclass::text as parent
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace and array_length(c.conkey, 1) = 1
      and c.confrelid::regclass::text = any (parents)
      and exists (select 1 from information_schema.columns ic where ic.table_schema = 'public' and ic.table_name = c.conrelid::regclass::text and ic.column_name = 'tenant_id')
      and a.attname <> 'tenant_id'
  loop
    if not exists (select 1 from pg_constraint where conrelid = r.child::regclass and conname = r.child || '_' || r.col || '_same_tenant') then
      execute format('alter table public.%I add constraint %I foreign key (tenant_id, %I) references public.%I (tenant_id, id)',
        r.child, r.child || '_' || r.col || '_same_tenant', r.col, r.parent);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Per-tenant uniqueness
-- ---------------------------------------------------------------------------------------------------------------

create unique index if not exists products_tenant_slug_key on public.products (tenant_id, slug);
create unique index if not exists calculator_customers_tenant_auth_user_key on public.calculator_customers (tenant_id, auth_user_id);
create unique index if not exists calculator_customers_tenant_email_key on public.calculator_customers (tenant_id, lower(email));
create unique index if not exists calculator_customers_tenant_stripe_customer_key on public.calculator_customers (tenant_id, stripe_customer_id);
create unique index if not exists automation_templates_tenant_key on public.automation_templates (tenant_id, template_key);
create unique index if not exists automation_workflows_tenant_key on public.automation_workflows (tenant_id, workflow_key);
create unique index if not exists automation_events_tenant_key on public.automation_events (tenant_id, event_key);
create unique index if not exists bureau_options_tenant_unique on public.bureau_options (tenant_id, kind, lower(name));
create unique index if not exists people_tenant_user_key on public.people (tenant_id, user_id);
create unique index if not exists efin_records_tenant_live_unique on public.efin_records (tenant_id, efin_hash) where archived_at is null;
create unique index if not exists professional_credentials_tenant_unique on public.professional_credentials (tenant_id, kind, identifier_hash)
  where identifier_hash is not null and archived_at is null;

-- The old global versions go last: until they are gone, a second tenant cannot reuse a slug, an email or a default
-- template key that another tenant already has.
alter table public.products drop constraint if exists products_slug_key;
drop index if exists public.products_slug_key;
alter table public.calculator_customers drop constraint if exists calculator_customers_auth_user_id_key;
drop index if exists public.calculator_customers_auth_user_id_key;
drop index if exists public.calculator_customers_email_key;
alter table public.calculator_customers drop constraint if exists calculator_customers_stripe_customer_id_key;
drop index if exists public.calculator_customers_stripe_customer_id_key;
alter table public.automation_templates drop constraint if exists automation_templates_template_key_key;
alter table public.automation_workflows drop constraint if exists automation_workflows_workflow_key_key;
alter table public.automation_events drop constraint if exists automation_events_event_key_key;
drop index if exists public.bureau_options_unique;
alter table public.people drop constraint if exists people_user_id_key;
drop index if exists public.people_user_id_key;
drop index if exists public.efin_records_live_unique;
drop index if exists public.professional_credentials_unique;

-- ---------------------------------------------------------------------------------------------------------------
-- Functions the server calls
-- ---------------------------------------------------------------------------------------------------------------

do $$
declare
  f text;
begin
  -- These ran as their owner, which skips row-level security. As invoker they run as the caller: tenant_app sees only
  -- its own tenant; the service role is unchanged.
  foreach f in array array['public.efin_onboard(jsonb)', 'public.efin_add_member(jsonb)', 'public.efin_delete_efin(uuid, uuid, text)', 'public.efin_delete_organization(uuid, uuid, text)'] loop
    if to_regprocedure(f) is not null then
      execute format('alter function %s security invoker', f);
    end if;
  end loop;
  foreach f in array array[
    'public.efin_onboard(jsonb)', 'public.efin_add_member(jsonb)', 'public.efin_delete_efin(uuid, uuid, text)', 'public.efin_delete_organization(uuid, uuid, text)',
    'public.crm_claim_lead(uuid, timestamptz)', 'public.crm_claim_refresh_lock(uuid, timestamptz)', 'public.crm_due_lead_ids(integer, uuid)',
    'public.is_bureau_admin()', 'public.my_organization_ids()'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('grant execute on function %s to tenant_app', f);
    end if;
  end loop;
end $$;

-- Turn on the request hook.
alter role authenticator set pgrst.db_pre_request = 'public.pgrst_pre_request';
notify pgrst, 'reload config';
