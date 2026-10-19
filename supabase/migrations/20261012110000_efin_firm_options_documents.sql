-- EFIN Management: confirmation wording, responsible party, tax software and bank options, firm documents.
-- Additive. Safe to run more than once. Run AFTER 20261011100000, 20261012090000 and 20261012100000.
--  * A third confirmation state, 'pending', for "pending confirmation" (Unconfirmed / Pending confirmation / Confirmed).
--  * bureau_options: your own list of tax software and bank products (Settings); organization_options: which a firm uses.
--  * filing_relationships.renews_on: when that software renews (not an IRS date).
--  * A private storage bucket for firm documents (files are only ever served through signed, short-lived links).
--  * efin_onboard now also saves the responsible party and the chosen software / bank options.

set local lock_timeout = '10s';

alter table public.efin_records drop constraint efin_records_external_status_check, add constraint efin_records_external_status_check check (external_status in ('unverified','pending','manually_verified','verified'));
alter table public.organization_roles drop constraint organization_roles_verification_status_check, add constraint organization_roles_verification_status_check check (verification_status in ('unverified','pending','manually_verified','verified'));
alter table public.professional_credentials drop constraint professional_credentials_verification_status_check, add constraint professional_credentials_verification_status_check check (verification_status in ('unverified','pending','manually_verified','verified'));
alter table public.compliance_documents drop constraint compliance_documents_verification_status_check, add constraint compliance_documents_verification_status_check check (verification_status in ('unverified','pending','manually_verified','verified'));
alter table public.filing_relationships drop constraint filing_relationships_external_auth_status_check, add constraint filing_relationships_external_auth_status_check check (external_auth_status in ('unverified','pending','manually_verified','verified','not_applicable'));

alter table public.filing_relationships add column if not exists renews_on date;

create table if not exists public.bureau_options (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('tax_software','bank_product')),
  name text not null check (char_length(name) between 2 and 120),
  notes text check (notes is null or char_length(notes) <= 500),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists bureau_options_unique on public.bureau_options (kind, lower(name));

create table if not exists public.organization_options (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  option_id uuid not null references public.bureau_options (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (organization_id, option_id)
);

create or replace trigger set_updated_at before update on public.bureau_options for each row execute function public.set_updated_at();

alter table public.bureau_options enable row level security;
alter table public.organization_options enable row level security;
revoke all on table public.bureau_options, public.organization_options from anon, authenticated;
grant select, insert, update, delete on table public.bureau_options, public.organization_options to service_role;
grant select on public.bureau_options, public.organization_options to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'bureau_options' and policyname = 'bureau_options_read') then
    create policy bureau_options_read on public.bureau_options for select to authenticated using (public.is_bureau_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'organization_options' and policyname = 'organization_options_read') then
    create policy organization_options_read on public.organization_options for select to authenticated using (public.is_bureau_admin() or organization_id in (select public.my_organization_ids()));
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit) values ('firm-documents', 'firm-documents', false, 4194304) on conflict (id) do nothing;

create or replace function public.efin_onboard(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := nullif(p->>'actor_id','')::uuid;
  actor_email text := p->>'actor_email';
  org uuid := (p->>'org_id')::uuid;
  loc uuid := (p->>'loc_id')::uuid;
  per uuid := (p->>'person_id')::uuid;
  efin uuid := (p->>'efin_id')::uuid;
  cred uuid := nullif(p->>'cred_id','')::uuid;
  asg uuid := gen_random_uuid();
  resp uuid := nullif(p->>'resp_person_id','')::uuid;
begin
  insert into organizations (id, legal_name, dba_name, business_structure, ein_encrypted, ein_last4, primary_address, relationship, agreement_status, onboarding_status, notes, created_by, updated_by)
  values (org, p->>'legal_name', nullif(p->>'dba_name',''), nullif(p->>'business_structure',''), nullif(p->>'ein_encrypted',''), nullif(p->>'ein_last4',''), coalesce(p->'address','{}'::jsonb), coalesce(p->>'relationship','partner'), coalesce(p->>'agreement_status','pending'), 'in_progress', nullif(p->>'org_notes',''), actor, actor);
  insert into office_locations (id, organization_id, name, address, is_primary) values (loc, org, p->>'office_name', coalesce(p->'address','{}'::jsonb), true);
  -- Additional locations (optional): [{name, address}]
  insert into office_locations (organization_id, name, address)
  select org, x->>'name', coalesce(x->'address','{}'::jsonb) from jsonb_array_elements(coalesce(p->'extra_offices','[]'::jsonb)) x where nullif(x->>'name','') is not null;
  insert into people (id, full_name, email, phone, created_by, updated_by) values (per, p->>'person_name', nullif(p->>'person_email',''), nullif(p->>'person_phone',''), actor, actor);
  update organizations set administrator_person_id = per where id = org;
  insert into organization_roles (organization_id, person_id, role, location_id, verification_status, created_by) values (org, per, 'ero', loc, coalesce(p->>'role_verification','unverified'), actor);
  -- Responsible party: the same person (checkbox) or a second person with their own contact details.
  if coalesce((p->>'responsible_same')::boolean, true) then
    insert into organization_roles (organization_id, person_id, role, location_id, verification_status, created_by) values (org, per, 'responsible_official', loc, coalesce(p->>'role_verification','unverified'), actor);
  elsif resp is not null then
    insert into people (id, full_name, email, phone, created_by, updated_by) values (resp, p->>'resp_name', nullif(p->>'resp_email',''), nullif(p->>'resp_phone',''), actor, actor);
    insert into organization_roles (organization_id, person_id, role, location_id, verification_status, created_by) values (org, resp, 'responsible_official', loc, 'unverified', actor);
  end if;
  -- Tax software and bank products chosen in onboarding (from Settings).
  insert into organization_options (organization_id, option_id)
  select org, (x)::uuid from jsonb_array_elements_text(coalesce(p->'option_ids','[]'::jsonb)) x
  where exists (select 1 from bureau_options o where o.id = (x)::uuid and o.active)
  on conflict do nothing;
  if cred is not null and coalesce(p->>'relationship','partner') <> 'client' then
    insert into professional_credentials (id, person_id, kind, identifier_encrypted, identifier_last4, identifier_hash, verification_status, verification_source, verified_at, verified_by, expires_on)
    values (cred, per, 'ptin', p->>'ptin_encrypted', p->>'ptin_last4', p->>'ptin_hash', coalesce(p->>'ptin_verification','unverified'), nullif(p->>'ptin_source',''),
            case when coalesce(p->>'ptin_verification','unverified') in ('unverified','pending') then null else now() end, case when coalesce(p->>'ptin_verification','unverified') in ('unverified','pending') then null else actor end, nullif(p->>'ptin_expires_on','')::date);
  else
    cred := null;
  end if;
  insert into efin_records (id, efin_encrypted, efin_last4, efin_hash, organization_id, location_id, ero_person_id, internal_status, external_status, external_verified_at, verification_source, recorded_expiration, expiration_verified, tax_year, notes, created_by, updated_by)
  values (efin, p->>'efin_encrypted', p->>'efin_last4', p->>'efin_hash', org, loc, per, 'pending_verification', coalesce(p->>'efin_verification','unverified'),
          case when coalesce(p->>'efin_verification','unverified') in ('unverified','pending') then null else now() end, nullif(p->>'efin_source',''), nullif(p->>'recorded_expiration','')::date,
          coalesce((p->>'expiration_verified')::boolean, false) and nullif(p->>'recorded_expiration','') is not null, nullif(p->>'tax_year','')::int, nullif(p->>'efin_notes',''), actor, actor);
  insert into audit_events (actor_id, actor_email, event_type, target_type, target_id, organization_id, changes) values
    (actor, actor_email, 'organization.created', 'organization', org, org, jsonb_build_object('legal_name', p->>'legal_name', 'relationship', coalesce(p->>'relationship','partner'))),
    (actor, actor_email, 'person.created', 'person', per, org, jsonb_build_object('full_name', p->>'person_name')),
    (actor, actor_email, 'efin.created', 'efin', efin, org, jsonb_build_object('last4', p->>'efin_last4', 'external_status', coalesce(p->>'efin_verification','unverified')));
  -- Clients that only bought software or services get no internal assignment workflow, team or PTIN records.
  if coalesce(p->>'relationship','partner') <> 'client' then
    insert into efin_assignments (id, efin_id, organization_id, location_id, person_id, role, state, requested_by) values (asg, efin, org, loc, per, 'ero', 'draft', actor);
    insert into audit_events (actor_id, actor_email, event_type, target_type, target_id, organization_id, changes) values (actor, actor_email, 'assignment.created', 'assignment', asg, org, jsonb_build_object('efin_id', efin, 'role', 'ero', 'person_id', per, 'state', 'draft'));
  end if;
  if cred is not null then
    insert into audit_events (actor_id, actor_email, event_type, target_type, target_id, changes) values (actor, actor_email, 'credential.created', 'credential', cred, jsonb_build_object('kind','ptin','last4', p->>'ptin_last4','person_id', per));
  end if;
  return efin;
end $$;
revoke execute on function public.efin_onboard(jsonb) from public, anon, authenticated;
grant execute on function public.efin_onboard(jsonb) to service_role;

create or replace function public.efin_add_member(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := nullif(p->>'actor_id','')::uuid;
  actor_email text := p->>'actor_email';
  org uuid := (p->>'org_id')::uuid;
  per uuid := (p->>'person_id')::uuid;
  cred uuid := nullif(p->>'cred_id','')::uuid;
begin
  if not exists (select 1 from organizations where id = org) then raise exception 'organization not found'; end if;
  if exists (select 1 from organizations where id = org and relationship = 'client') then raise exception 'TEAM_NOT_TRACKED'; end if;
  insert into people (id, full_name, email, phone, created_by, updated_by) values (per, p->>'person_name', nullif(p->>'person_email',''), nullif(p->>'person_phone',''), actor, actor);
  insert into organization_roles (organization_id, person_id, role, location_id, verification_status, created_by)
  values (org, per, p->>'role', nullif(p->>'loc_id','')::uuid, coalesce(p->>'role_verification','unverified'), actor);
  if cred is not null then
    insert into professional_credentials (id, person_id, kind, identifier_encrypted, identifier_last4, identifier_hash, verification_status, verification_source, verified_at, verified_by, expires_on)
    values (cred, per, 'ptin', p->>'ptin_encrypted', p->>'ptin_last4', p->>'ptin_hash', coalesce(p->>'ptin_verification','unverified'), nullif(p->>'ptin_source',''),
            case when coalesce(p->>'ptin_verification','unverified') in ('unverified','pending') then null else now() end, case when coalesce(p->>'ptin_verification','unverified') in ('unverified','pending') then null else actor end, nullif(p->>'ptin_expires_on','')::date);
    insert into audit_events (actor_id, actor_email, event_type, target_type, target_id, changes) values (actor, actor_email, 'credential.created', 'credential', cred, jsonb_build_object('kind','ptin','last4', p->>'ptin_last4','person_id', per));
  end if;
  insert into audit_events (actor_id, actor_email, event_type, target_type, target_id, organization_id, changes) values (actor, actor_email, 'person.created', 'person', per, org, jsonb_build_object('full_name', p->>'person_name', 'role', p->>'role'));
  return per;
end $$;
revoke execute on function public.efin_add_member(jsonb) from public, anon, authenticated;
grant execute on function public.efin_add_member(jsonb) to service_role;
