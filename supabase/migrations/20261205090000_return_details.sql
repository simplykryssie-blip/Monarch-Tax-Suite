-- Return details: what an office tracks on a tax return beyond its stage and dates. Additive only: new optional columns on
-- client_returns and one new table. Nothing is dropped and no existing value is changed; every existing return keeps working
-- as it is. Safe to run again.
--
-- client_returns (new columns)   form_type, filing_status, e-file status with its date and any rejection reason, the federal
--                                result (positive = refund, negative = amount owed) and the fee amount.
-- return_state_filings           one row per state return tied to a return: the state, its status, filed date and result
--                                (positive = refund, negative = amount owed).

set local lock_timeout = '10s';

alter table public.client_returns add column if not exists form_type text check (form_type is null or form_type in ('1040', '1040-SR', '1040-NR', '1120', '1120-S', '1065', '990', '941', '940', 'other'));
alter table public.client_returns add column if not exists filing_status text check (filing_status is null or filing_status in ('single', 'married_joint', 'married_separate', 'head_of_household', 'qualifying_surviving_spouse'));
alter table public.client_returns add column if not exists efile_status text not null default 'not_sent' check (efile_status in ('not_sent', 'transmitted', 'accepted', 'rejected'));
alter table public.client_returns add column if not exists efile_on date check (efile_on is null or efile_on between date '2000-01-01' and date '2100-01-01');
alter table public.client_returns add column if not exists efile_reject_reason text check (efile_reject_reason is null or length(efile_reject_reason) <= 500);
alter table public.client_returns add column if not exists federal_result_cents bigint check (federal_result_cents is null or federal_result_cents between -100000000000 and 100000000000);
alter table public.client_returns add column if not exists fee_cents bigint check (fee_cents is null or fee_cents between 0 and 100000000000);

create table if not exists public.return_state_filings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  return_id uuid not null,
  state text not null check (state ~ '^[A-Z]{2}$'),
  status text not null default 'not_started' check (status in ('not_started', 'in_prep', 'filed', 'accepted', 'rejected')),
  filed_on date check (filed_on is null or filed_on between date '2000-01-01' and date '2100-01-01'),
  result_cents bigint check (result_cents is null or result_cents between -100000000000 and 100000000000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists return_state_filings_one_per_state on public.return_state_filings (tenant_id, return_id, state);
create index if not exists return_state_filings_return_idx on public.return_state_filings (return_id);

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['return_state_filings'];
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

-- A state return points only at a return of its own tenant, and goes when that return goes.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'return_state_filings_return_same_tenant') then
    alter table public.return_state_filings add constraint return_state_filings_return_same_tenant foreign key (tenant_id, return_id) references public.client_returns (tenant_id, id) on delete cascade;
  end if;
end $$;
