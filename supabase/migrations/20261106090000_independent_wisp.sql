-- Phase 4, Piece 2: the independent PTIN holder's own WISP (additive).
--
-- practice_wisps  one row per WISP an independent holder builds for their own practice, in their own tenant:
--                 draft (answers saved, sealed because they can include an EIN) -> paid (the $25 WISP product was bought)
--                 -> active (the holder attested to the generated plan; a review is due 12 months later) -> archived
--                 (kept as history when the holder links to an ERO; never deleted).
--                 compliance_attestations is organization_id-based, so this is the holder's own tenant-keyed record.
--
-- The purchase itself is recorded on the platform's storefront like any other order; only its Stripe session id is kept
-- here, so no row points across tenants.
--
-- Same tenant rules as every table since Step 0.

create table if not exists public.practice_wisps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  status text not null default 'draft' check (status in ('draft', 'paid', 'active', 'archived')),
  practice_name text not null check (length(practice_name) between 1 and 200),
  holder_name text not null check (length(holder_name) between 1 and 200),
  answers_sealed text not null check (length(answers_sealed) <= 40000),
  stripe_session_id text unique check (stripe_session_id is null or length(stripe_session_id) <= 255),
  paid_at timestamptz,
  pdf_path text check (pdf_path is null or length(pdf_path) <= 500),
  pdf_sha256 text check (pdf_sha256 is null or pdf_sha256 ~ '^[0-9a-f]{64}$'),
  generated_at timestamptz,
  attested_at timestamptz,
  attested_name text check (attested_name is null or length(attested_name) between 1 and 200),
  review_due_on date,
  reminder_30_sent_at timestamptz,
  reminder_7_sent_at timestamptz,
  archived_at timestamptz,
  archived_reason text check (archived_reason is null or archived_reason in ('linked_to_ero')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- A holder has at most one live WISP; archived ones are kept alongside.
create unique index if not exists practice_wisps_one_live on public.practice_wisps (tenant_id) where status <> 'archived';
create index if not exists practice_wisps_review_idx on public.practice_wisps (review_due_on) where status = 'active';

create or replace function public.practice_wisps_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
create or replace trigger practice_wisps_touch before update on public.practice_wisps for each row execute function public.practice_wisps_touch();

-- Archived history is never deleted.
create or replace function public.practice_wisps_keep() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.status = 'archived' then
    raise exception 'WISP_HISTORY_KEPT: an archived WISP is kept as history and cannot be changed or deleted';
  end if;
  if tg_op = 'DELETE' and old.status in ('active') then
    raise exception 'WISP_HISTORY_KEPT: an attested WISP is archived, never deleted';
  end if;
  return coalesce(new, old);
end $$;
create or replace trigger practice_wisps_keep before update or delete on public.practice_wisps for each row execute function public.practice_wisps_keep();

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['practice_wisps'];
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

-- "Linked to an ERO" means exactly one thing: an active office_members row for the account. The app asks this one
-- function, so the rule lives in one place and the gate tests it with fake rows.
create or replace function public.is_linked_to_ero(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.office_members where user_id = p_user and status = 'active')
$$;
revoke execute on function public.is_linked_to_ero(uuid) from public, anon, authenticated;
grant execute on function public.is_linked_to_ero(uuid) to service_role;
