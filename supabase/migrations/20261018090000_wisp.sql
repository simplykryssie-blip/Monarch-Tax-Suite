-- WISP Generator backend: leads, paid plans and their delivery history, for every tenant.
--
-- wisp_audits      one row per completed free audit: score, category breakdown, answers, the optional ERO answers.
--                  Lead capture, kept even when the visitor never buys. No contact details are asked for here.
-- wisp_plans       the builder's answers (encrypted, they can include an EIN), the delivery email, the Stripe
--                  checkout, the paying customer and order, and the generated PDF in tenant-documents.
--                  A plan with an email but no payment is a lead too.
-- wisp_deliveries  append-only history of every email attempt (sent, failed, held back, retried) and download.
--
-- Same tenant rules as every table since Step 0: tenant_id with the required default, the two policies, and
-- same-tenant foreign keys, so a plan can only point at its own tenant's customer, order and audit.

create table if not exists public.wisp_audits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  score integer not null check (score between 0 and 100),
  breakdown jsonb not null check (jsonb_typeof(breakdown) = 'object'),
  answers jsonb not null check (jsonb_typeof(answers) = 'array'),
  ero_answers jsonb not null default '{}'::jsonb check (jsonb_typeof(ero_answers) = 'object'),
  ip_hash text check (ip_hash is null or length(ip_hash) <= 64),
  user_agent text check (user_agent is null or length(user_agent) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists wisp_audits_recent_idx on public.wisp_audits (tenant_id, created_at desc);

create table if not exists public.wisp_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  audit_id uuid references public.wisp_audits(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'paid', 'generated')),
  firm_name text not null check (length(firm_name) between 1 and 200),
  email text not null check (length(email) between 3 and 254),
  answers_sealed text not null check (length(answers_sealed) <= 40000),
  access_token_hash text not null check (length(access_token_hash) = 64),
  link_token_hash text check (link_token_hash is null or length(link_token_hash) = 64),
  link_expires_at timestamptz,
  stripe_session_id text unique check (stripe_session_id is null or length(stripe_session_id) <= 255),
  customer_id uuid references public.calculator_customers(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  pdf_path text check (pdf_path is null or length(pdf_path) <= 500),
  pdf_sha256 text check (pdf_sha256 is null or pdf_sha256 ~ '^[0-9a-f]{64}$'),
  generated_at timestamptz,
  emailed_at timestamptz,
  email_error text check (email_error is null or length(email_error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wisp_plans_recent_idx on public.wisp_plans (tenant_id, created_at desc);
create index if not exists wisp_plans_customer_idx on public.wisp_plans (tenant_id, customer_id) where customer_id is not null;

create table if not exists public.wisp_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  plan_id uuid not null references public.wisp_plans(id) on delete cascade,
  kind text not null check (kind in ('email', 'download')),
  status text not null check (status in ('sent', 'failed', 'held_back', 'downloaded')),
  actor text not null check (actor in ('system', 'buyer', 'admin')),
  detail text check (detail is null or length(detail) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists wisp_deliveries_plan_idx on public.wisp_deliveries (tenant_id, plan_id, created_at desc);

-- The delivery history can only grow (a plan that is deleted takes its history with it).
create or replace function public.wisp_deliveries_append_only() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'WISP_DELIVERY_KEPT: the delivery history cannot be changed';
end $$;
drop trigger if exists wisp_deliveries_append_only on public.wisp_deliveries;
create trigger wisp_deliveries_append_only before update on public.wisp_deliveries for each row execute function public.wisp_deliveries_append_only();

create or replace function public.wisp_plans_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists wisp_plans_touch on public.wisp_plans;
create trigger wisp_plans_touch before update on public.wisp_plans for each row execute function public.wisp_plans_touch();

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['wisp_audits', 'wisp_plans', 'wisp_deliveries'];
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
create unique index if not exists wisp_audits_tenant_id_id_key on public.wisp_audits (tenant_id, id);
create unique index if not exists wisp_plans_tenant_id_id_key on public.wisp_plans (tenant_id, id);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wisp_plans_audit_id_same_tenant') then
    alter table public.wisp_plans add constraint wisp_plans_audit_id_same_tenant foreign key (tenant_id, audit_id) references public.wisp_audits (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wisp_plans_customer_id_same_tenant') then
    alter table public.wisp_plans add constraint wisp_plans_customer_id_same_tenant foreign key (tenant_id, customer_id) references public.calculator_customers (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wisp_plans_order_id_same_tenant') then
    alter table public.wisp_plans add constraint wisp_plans_order_id_same_tenant foreign key (tenant_id, order_id) references public.orders (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wisp_deliveries_plan_id_same_tenant') then
    alter table public.wisp_deliveries add constraint wisp_deliveries_plan_id_same_tenant foreign key (tenant_id, plan_id) references public.wisp_plans (tenant_id, id) on delete cascade;
  end if;
end $$;
