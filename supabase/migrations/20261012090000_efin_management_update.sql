-- EFIN Management: update for databases that already ran an EARLIER version of 20261011100000_efin_management.sql.
-- Safe to run more than once, and safe on a database that already has the latest version (it only re-states what follows).
--   1. organizations.relationship now accepts 'client' (a business that only bought software or services: no team, PTINs
--      or assignments are kept). Older databases reject that value with a check-constraint error.
--   2. efin_onboard / efin_add_member are replaced (extra locations; clients get no PTIN, team or assignment).
--   (Permanent deletion lives in 20261012100000_efin_delete_functions.sql.)
-- Additive and replace-only: no table, column or row is dropped or rewritten.

set local lock_timeout = '10s';

alter table public.organizations drop constraint if exists organizations_relationship_check;
alter table public.organizations add constraint organizations_relationship_check check (relationship in ('internal','partner','client','other'));

-- ------------------------------------------------------------------------------------- one-step onboarding (atomic)
-- Creates an ERO office end to end in ONE transaction: organization, office, person + ERO role, optional PTIN, EFIN and a
-- draft assignment, plus their audit events. The application encrypts the identifiers first and passes ciphertext only.
-- If any part fails (for example a duplicate EFIN) nothing is saved. Callable by service_role only.
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
  if cred is not null and coalesce(p->>'relationship','partner') <> 'client' then
    insert into professional_credentials (id, person_id, kind, identifier_encrypted, identifier_last4, identifier_hash, verification_status, verification_source, verified_at, verified_by, expires_on)
    values (cred, per, 'ptin', p->>'ptin_encrypted', p->>'ptin_last4', p->>'ptin_hash', coalesce(p->>'ptin_verification','unverified'), nullif(p->>'ptin_source',''),
            case when coalesce(p->>'ptin_verification','unverified') = 'unverified' then null else now() end, case when coalesce(p->>'ptin_verification','unverified') = 'unverified' then null else actor end, nullif(p->>'ptin_expires_on','')::date);
  else
    cred := null;
  end if;
  insert into efin_records (id, efin_encrypted, efin_last4, efin_hash, organization_id, location_id, ero_person_id, internal_status, external_status, external_verified_at, verification_source, recorded_expiration, expiration_verified, tax_year, notes, created_by, updated_by)
  values (efin, p->>'efin_encrypted', p->>'efin_last4', p->>'efin_hash', org, loc, per, 'pending_verification', coalesce(p->>'efin_verification','unverified'),
          case when coalesce(p->>'efin_verification','unverified') = 'unverified' then null else now() end, nullif(p->>'efin_source',''), nullif(p->>'recorded_expiration','')::date,
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

-- Adds a team member (person + role, optional PTIN) to an existing organization in one transaction.
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
            case when coalesce(p->>'ptin_verification','unverified') = 'unverified' then null else now() end, case when coalesce(p->>'ptin_verification','unverified') = 'unverified' then null else actor end, nullif(p->>'ptin_expires_on','')::date);
    insert into audit_events (actor_id, actor_email, event_type, target_type, target_id, changes) values (actor, actor_email, 'credential.created', 'credential', cred, jsonb_build_object('kind','ptin','last4', p->>'ptin_last4','person_id', per));
  end if;
  insert into audit_events (actor_id, actor_email, event_type, target_type, target_id, organization_id, changes) values (actor, actor_email, 'person.created', 'person', per, org, jsonb_build_object('full_name', p->>'person_name', 'role', p->>'role'));
  return per;
end $$;
revoke execute on function public.efin_add_member(jsonb) from public, anon, authenticated;
grant execute on function public.efin_add_member(jsonb) to service_role;
