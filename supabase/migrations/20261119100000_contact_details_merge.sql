-- Contacts, second round: driver's license, last year's address, a spouse who is not a client, a business email, the standard
-- invoice fees kept in Settings, and merging two duplicate clients into one.
-- Additive only: new columns, two new tables and one function. Nothing is dropped and no existing value is changed. Safe to run again.
--
-- clients.dl_number, dl_state, dl_issued_on, dl_expires_on   the driver's license number, the state that issued it, and its dates.
-- clients.address_same_as_last_year, prior_address_*         whether the address was used on last year's return; if not, the old one.
-- client_spouses                                             a spouse entered by hand (not a client). One per client.
-- client_businesses.email                                    a business email.
-- invoice_defaults                                           the standard fee lines ($223 breakdown) an invoice starts from, one row per workspace.
-- merge_clients()                                            moves everything on one client to another, in one step, then archives the first.

set local lock_timeout = '10s';

alter table public.clients add column if not exists dl_number text check (dl_number is null or length(dl_number) between 1 and 40);
alter table public.clients add column if not exists dl_state text check (dl_state is null or dl_state ~ '^[A-Z]{2}$');
alter table public.clients add column if not exists dl_issued_on date check (dl_issued_on is null or dl_issued_on between date '1900-01-01' and date '2100-01-01');
alter table public.clients add column if not exists dl_expires_on date check (dl_expires_on is null or dl_expires_on between date '1900-01-01' and date '2100-01-01');
alter table public.clients add column if not exists address_same_as_last_year boolean not null default true;
alter table public.clients add column if not exists prior_address_line1 text check (prior_address_line1 is null or length(prior_address_line1) <= 150);
alter table public.clients add column if not exists prior_address_line2 text check (prior_address_line2 is null or length(prior_address_line2) <= 100);
alter table public.clients add column if not exists prior_city text check (prior_city is null or length(prior_city) <= 80);
alter table public.clients add column if not exists prior_state text check (prior_state is null or prior_state ~ '^[A-Z]{2}$');
alter table public.clients add column if not exists prior_zip text check (prior_zip is null or prior_zip ~ '^[0-9]{5}(-[0-9]{4})?$');

alter table public.client_businesses add column if not exists email text check (email is null or (length(email) between 3 and 254 and email = lower(email)));

create table if not exists public.client_spouses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  client_id uuid not null references public.clients(id) on delete restrict,
  first_name text not null check (length(first_name) between 1 and 100),
  last_name text check (last_name is null or length(last_name) between 1 and 100),
  dob date check (dob is null or dob between date '1900-01-01' and date '2100-01-01'),
  phone text check (phone is null or length(phone) <= 40),
  email text check (email is null or (length(email) between 3 and 254 and email = lower(email))),
  ssn_last4 text check (ssn_last4 is null or ssn_last4 ~ '^[0-9]{4}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists client_spouses_one_per_client on public.client_spouses (tenant_id, client_id);

create table if not exists public.invoice_defaults (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 12),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index if not exists invoice_defaults_one_per_tenant on public.invoice_defaults (tenant_id);

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['client_spouses', 'invoice_defaults'];
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

-- A spouse entered by hand can only belong to a client in the same workspace.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_spouses_client_id_same_tenant') then
    alter table public.client_spouses add constraint client_spouses_client_id_same_tenant foreign key (tenant_id, client_id) references public.clients (tenant_id, id);
  end if;
end $$;

-- Merge one client into another. Runs as the signed-in workspace (row security applies), in one step: either everything moves
-- or nothing does. The kept client gets any detail it was missing from the other; the other is archived, never deleted.
-- A return that would clash with one the kept client already has (the same year and kind) stays on the archived record.
-- The encrypted Social Security number is moved by the app, which holds the key.
create or replace function public.merge_clients(p_keep uuid, p_drop uuid, p_actor uuid) returns jsonb
language plpgsql
as $$
declare
  moved jsonb := '{}'::jsonb;
  n integer;
  keep_row public.clients;
  drop_row public.clients;
begin
  if p_keep is null or p_drop is null or p_keep = p_drop then
    raise exception 'Choose two different clients.';
  end if;
  select * into keep_row from public.clients where id = p_keep;
  if not found then raise exception 'The client to keep was not found.'; end if;
  select * into drop_row from public.clients where id = p_drop;
  if not found then raise exception 'The client to merge was not found.'; end if;

  -- If the two are each other's spouse, that link ends here.
  update public.clients set spouse_id = null where id in (p_keep, p_drop) and spouse_id in (p_keep, p_drop);
  -- Anyone linked to the merged client as a spouse is now linked to the kept one.
  update public.clients set spouse_id = p_keep where spouse_id = p_drop and id <> p_keep;
  if keep_row.spouse_id is null and drop_row.spouse_id is not null and drop_row.spouse_id <> p_keep then
    update public.clients set spouse_id = drop_row.spouse_id where id = p_keep;
    update public.clients set spouse_id = p_keep where id = drop_row.spouse_id;
  end if;
  update public.clients set spouse_id = null where id = p_drop;

  update public.client_returns r set client_id = p_keep
  where r.client_id = p_drop
    and not exists (
      select 1 from public.client_returns k
      where k.client_id = p_keep and k.tax_year = r.tax_year and k.kind = r.kind and k.kind in ('original', 'extension')
        and k.archived_at is null and r.archived_at is null);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('returns', n);

  update public.client_docs set client_id = p_keep where client_id = p_drop;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('documents', n);
  update public.client_messages set client_id = p_keep where client_id = p_drop;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('messages', n);
  update public.client_tasks set client_id = p_keep where client_id = p_drop;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('tasks', n);
  update public.client_notes set client_id = p_keep where client_id = p_drop;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('notes', n);
  update public.invoices set client_id = p_keep where client_id = p_drop;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('invoices', n);
  update public.invoice_payments set client_id = p_keep where client_id = p_drop;
  update public.document_deliveries set client_id = p_keep where client_id = p_drop;
  update public.portal_doc_requests set client_id = p_keep where client_id = p_drop;
  update public.client_dependents set client_id = p_keep where client_id = p_drop;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('dependents', n);
  update public.client_businesses set client_id = p_keep where client_id = p_drop;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('businesses', n);
  update public.client_spouses set client_id = p_keep
  where client_id = p_drop and not exists (select 1 from public.client_spouses where client_id = p_keep);
  update public.portal_members set client_id = p_keep
  where client_id = p_drop and not exists (select 1 from public.portal_members where client_id = p_keep);

  -- Fill in what the kept client was missing.
  update public.clients k set
    email = coalesce(k.email, d.email), phone = coalesce(k.phone, d.phone), dob = coalesce(k.dob, d.dob),
    ssn_last4 = coalesce(k.ssn_last4, d.ssn_last4),
    dl_number = coalesce(k.dl_number, d.dl_number), dl_state = coalesce(k.dl_state, d.dl_state),
    dl_issued_on = coalesce(k.dl_issued_on, d.dl_issued_on), dl_expires_on = coalesce(k.dl_expires_on, d.dl_expires_on),
    address = coalesce(k.address, d.address), address_line1 = coalesce(k.address_line1, d.address_line1),
    address_line2 = coalesce(k.address_line2, d.address_line2), city = coalesce(k.city, d.city),
    state = coalesce(k.state, d.state), zip = coalesce(k.zip, d.zip)
  from public.clients d
  where k.id = p_keep and d.id = p_drop;

  update public.clients set archived_at = coalesce(archived_at, now()) where id = p_drop;

  insert into public.workspace_audit_events (actor_id, action, subject_type, subject_id, detail)
  values (p_actor, 'client.merged', 'client', p_keep, jsonb_build_object('merged_name', drop_row.full_name, 'merged_id', p_drop, 'moved', moved));

  return moved;
end $$;
revoke all on function public.merge_clients(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_clients(uuid, uuid, uuid) to service_role, tenant_app;
