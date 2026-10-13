-- Leads: one place for every prospect, whatever funnel they came from.
--
-- leads        one row per person (one email per tenant): contact details, where they came from, where they are in
--              the pipeline, notes, and the links that follow them along: their WISP audit and score, the customer
--              and order when they buy, and the firm (an organizations row) when they become an ERO.
-- lead_events  append-only thread for each lead: created, audit taken, status changes, contacted, converted, imported.
--
-- Same tenant rules as every table since Step 0: tenant_id with the required default, the two policies, and
-- same-tenant foreign keys, so a lead can only point at its own tenant's audit, plan, customer, order and firm.

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  full_name text not null check (length(full_name) between 1 and 200),
  email text not null check (length(email) between 3 and 254 and email = lower(email)),
  phone text check (phone is null or length(phone) <= 40),
  firm_name text check (firm_name is null or length(firm_name) <= 200),
  source text not null check (source in ('wisp_audit', 'facebook_group', 'referral', 'website', 'manual', 'other')),
  status text not null default 'new' check (status in ('new', 'contacted', 'interested', 'converted', 'lost')),
  notes text check (notes is null or length(notes) <= 10000),
  last_contacted_at timestamptz,
  audit_id uuid references public.wisp_audits(id) on delete set null,
  audit_score integer check (audit_score is null or audit_score between 0 and 100),
  wisp_plan_id uuid references public.wisp_plans(id) on delete set null,
  customer_id uuid references public.calculator_customers(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists leads_email_key on public.leads (tenant_id, email);
create index if not exists leads_recent_idx on public.leads (tenant_id, created_at desc);
create index if not exists leads_status_idx on public.leads (tenant_id, status);

create table if not exists public.lead_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  lead_id uuid not null references public.leads(id) on delete cascade,
  action text not null check (length(action) between 1 and 60),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists lead_events_lead_idx on public.lead_events (tenant_id, lead_id, created_at desc);

-- The thread can only grow (a lead that is deleted takes its thread with it).
create or replace function public.lead_events_append_only() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'LEAD_EVENT_KEPT: the lead history cannot be changed';
end $$;
create or replace trigger lead_events_append_only before update on public.lead_events for each row execute function public.lead_events_append_only();

create or replace function public.leads_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
create or replace trigger leads_touch before update on public.leads for each row execute function public.leads_touch();

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['leads', 'lead_events'];
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

-- Same-tenant references.
create unique index if not exists leads_tenant_id_id_key on public.leads (tenant_id, id);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leads_audit_id_same_tenant') then
    alter table public.leads add constraint leads_audit_id_same_tenant foreign key (tenant_id, audit_id) references public.wisp_audits (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_wisp_plan_id_same_tenant') then
    alter table public.leads add constraint leads_wisp_plan_id_same_tenant foreign key (tenant_id, wisp_plan_id) references public.wisp_plans (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_customer_id_same_tenant') then
    alter table public.leads add constraint leads_customer_id_same_tenant foreign key (tenant_id, customer_id) references public.calculator_customers (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_order_id_same_tenant') then
    alter table public.leads add constraint leads_order_id_same_tenant foreign key (tenant_id, order_id) references public.orders (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_organization_id_same_tenant') then
    alter table public.leads add constraint leads_organization_id_same_tenant foreign key (tenant_id, organization_id) references public.organizations (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lead_events_lead_id_same_tenant') then
    alter table public.lead_events add constraint lead_events_lead_id_same_tenant foreign key (tenant_id, lead_id) references public.leads (tenant_id, id) on delete cascade;
  end if;
end $$;
