-- EFIN Management foundation (Phase 1 of the service-bureau CRM).
--
-- ADDITIVE ONLY: new tables, indexes, functions and policies. Nothing existing is altered or dropped.
-- NOT APPLIED to production by the pull request that adds it; apply deliberately after review.
--
-- Design (see docs/efin-management.md):
--  * An EFIN, an organization, a person and a credential (PTIN) are separate records joined by explicit relationships.
--  * Internal status, verified external status and the assignment workflow are kept apart. Nothing here claims IRS approval.
--  * Sensitive identifiers (EFIN, EIN, PTIN) are stored encrypted by the application, with a last-4 for display and a keyed
--    hash for duplicate detection. Browser roles can never select the encrypted or hashed columns (column-level grants).
--  * Every table has row level security. Browser roles may only READ rows for organizations they belong to; all writes go
--    through server code (service role) after an administrator check, so there is no write policy for browser roles.
--  * audit_events is append-only (a trigger rejects UPDATE/DELETE for every role).

set local lock_timeout = '10s';

-- ----------------------------------------------------------------------------------------------- access helpers
create or replace function public.is_bureau_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid())
$$;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.organizations (id) on delete restrict,
  kind text not null default 'partner' check (kind in ('bureau','partner','entity')),
  legal_name text not null check (char_length(legal_name) between 2 and 200),
  dba_name text check (dba_name is null or char_length(dba_name) <= 200),
  business_structure text check (business_structure is null or business_structure in ('llc','corporation','s_corporation','partnership','sole_proprietorship','nonprofit','other')),
  ein_encrypted text,
  ein_last4 text check (ein_last4 is null or ein_last4 ~ '^[0-9]{4}$'),
  primary_address jsonb not null default '{}'::jsonb check (jsonb_typeof(primary_address) = 'object'),
  relationship text not null default 'partner' check (relationship in ('internal','partner','other')),
  agreement_status text not null default 'pending' check (agreement_status in ('pending','active','suspended','ended')),
  onboarding_status text not null default 'not_started' check (onboarding_status in ('not_started','in_progress','complete')),
  administrator_person_id uuid,
  status text not null default 'active' check (status in ('active','inactive')),
  notes text check (notes is null or char_length(notes) <= 4000),
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists organizations_parent_idx on public.organizations (parent_id);

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(full_name) between 2 and 200),
  email text check (email is null or char_length(email) <= 254),
  phone text check (phone is null or char_length(phone) <= 40),
  user_id uuid unique references auth.users (id) on delete set null,
  status text not null default 'active' check (status in ('active','inactive')),
  notes text check (notes is null or char_length(notes) <= 4000),
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists people_email_idx on public.people (lower(email));

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_administrator_fk') then
    alter table public.organizations add constraint organizations_administrator_fk foreign key (administrator_person_id) references public.people (id) on delete set null;
  end if;
end $$;

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('service_bureau_owner','service_bureau_admin','compliance_reviewer','office_owner','office_manager','tax_preparer','read_only_auditor')),
  status text not null default 'active' check (status in ('active','suspended','ended')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, role)
);
create index if not exists organization_memberships_user_idx on public.organization_memberships (user_id) where status = 'active';

create or replace function public.my_organization_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select organization_id from public.organization_memberships where user_id = auth.uid() and status = 'active'
$$;

create table if not exists public.office_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 200),
  address jsonb not null default '{}'::jsonb check (jsonb_typeof(address) = 'object'),
  is_primary boolean not null default false,
  status text not null default 'active' check (status in ('active','inactive')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists office_locations_one_primary on public.office_locations (organization_id) where is_primary and archived_at is null;

create table if not exists public.professional_credentials (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  kind text not null default 'ptin' check (kind in ('ptin','caf','state_license','other')),
  identifier_encrypted text,
  identifier_last4 text check (identifier_last4 is null or identifier_last4 ~ '^[A-Za-z0-9]{4}$'),
  identifier_hash text,
  verification_status text not null default 'unverified' check (verification_status in ('unverified','manually_verified','verified')),
  verification_source text check (verification_source is null or char_length(verification_source) <= 300),
  verified_at timestamptz,
  verified_by uuid references auth.users (id) on delete set null,
  expires_on date,
  notes text check (notes is null or char_length(notes) <= 2000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists professional_credentials_person_idx on public.professional_credentials (person_id);
create unique index if not exists professional_credentials_unique on public.professional_credentials (kind, identifier_hash) where identifier_hash is not null and archived_at is null;

create table if not exists public.efin_records (
  id uuid primary key default gen_random_uuid(),
  efin_encrypted text not null,
  efin_last4 text not null check (efin_last4 ~ '^[0-9]{4}$'),
  efin_hash text not null,
  organization_id uuid not null references public.organizations (id) on delete restrict,
  location_id uuid references public.office_locations (id) on delete set null,
  ero_person_id uuid references public.people (id) on delete set null,
  internal_status text not null default 'pending_verification' check (internal_status in ('draft','pending_verification','active','renewal_review','inactive','suspended')),
  external_status text not null default 'unverified' check (external_status in ('unverified','manually_verified','verified')),
  external_verified_at timestamptz,
  verification_source text check (verification_source is null or char_length(verification_source) <= 300),
  recorded_expiration date,
  expiration_verified boolean not null default false,
  tax_year integer check (tax_year is null or tax_year between 2000 and 2100),
  notes text check (notes is null or char_length(notes) <= 4000),
  archived_at timestamptz,
  archived_reason text check (archived_reason is null or char_length(archived_reason) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- The same EFIN cannot be recorded twice while a record is live; archived records keep their history.
create unique index if not exists efin_records_live_unique on public.efin_records (efin_hash) where archived_at is null;
create index if not exists efin_records_org_idx on public.efin_records (organization_id);
create index if not exists efin_records_expiration_idx on public.efin_records (recorded_expiration) where archived_at is null;

create table if not exists public.organization_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  role text not null check (role in ('ero','responsible_official','principal','tax_preparer','office_administrator','bureau_administrator')),
  location_id uuid references public.office_locations (id) on delete set null,
  status text not null default 'active' check (status in ('active','ended')),
  start_date date,
  end_date date,
  verification_status text not null default 'unverified' check (verification_status in ('unverified','manually_verified','verified')),
  verification_note text check (verification_note is null or char_length(verification_note) <= 1000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create unique index if not exists organization_roles_live_unique on public.organization_roles (organization_id, person_id, role, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'active';
create index if not exists organization_roles_person_idx on public.organization_roles (person_id);

create table if not exists public.efin_assignments (
  id uuid primary key default gen_random_uuid(),
  efin_id uuid not null references public.efin_records (id) on delete restrict,
  organization_id uuid not null references public.organizations (id) on delete restrict,
  location_id uuid references public.office_locations (id) on delete set null,
  person_id uuid references public.people (id) on delete restrict,
  role text not null check (role in ('ero','responsible_official','principal','tax_preparer','office_administrator','bureau_administrator')),
  software_provider text check (software_provider is null or char_length(software_provider) <= 120),
  state text not null default 'draft' check (state in ('draft','pending_review','approved','active','suspended','revoked','expired')),
  effective_from date,
  effective_to date,
  requested_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  review_reason text check (review_reason is null or char_length(review_reason) <= 1000),
  activated_at timestamptz,
  ended_at timestamptz,
  end_reason text check (end_reason is null or char_length(end_reason) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_from is null or effective_to >= effective_from)
);
-- No duplicate in-flight or live assignment of the same person/role/office to the same EFIN.
create unique index if not exists efin_assignments_live_unique on public.efin_assignments (efin_id, organization_id, coalesce(person_id, '00000000-0000-0000-0000-000000000000'::uuid), role) where state in ('draft','pending_review','approved','active','suspended');
create index if not exists efin_assignments_org_idx on public.efin_assignments (organization_id);
create index if not exists efin_assignments_efin_idx on public.efin_assignments (efin_id);

create table if not exists public.filing_relationships (
  id uuid primary key default gen_random_uuid(),
  efin_id uuid not null references public.efin_records (id) on delete restrict,
  organization_id uuid not null references public.organizations (id) on delete restrict,
  software_provider text not null check (char_length(software_provider) between 2 and 120),
  software_product text check (software_product is null or char_length(software_product) <= 120),
  tax_year integer check (tax_year is null or tax_year between 2000 and 2100),
  external_auth_status text not null default 'unverified' check (external_auth_status in ('unverified','manually_verified','verified','not_applicable')),
  verification_source text check (verification_source is null or char_length(verification_source) <= 300),
  last_verified_at timestamptz,
  remediation_note text check (remediation_note is null or char_length(remediation_note) <= 1000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists filing_relationships_efin_idx on public.filing_relationships (efin_id);

create table if not exists public.compliance_documents (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('efin','organization','person','credential','assignment')),
  subject_id uuid not null,
  kind text not null check (char_length(kind) between 2 and 80),
  title text not null check (char_length(title) between 2 and 200),
  storage_path text check (storage_path is null or char_length(storage_path) <= 500),
  verification_status text not null default 'unverified' check (verification_status in ('unverified','manually_verified','verified')),
  verified_at timestamptz,
  verified_by uuid references auth.users (id) on delete set null,
  expires_on date,
  notes text check (notes is null or char_length(notes) <= 2000),
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists compliance_documents_subject_idx on public.compliance_documents (subject_type, subject_id);

create table if not exists public.renewal_tasks (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('efin','credential','agreement','software')),
  subject_id uuid not null,
  organization_id uuid references public.organizations (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 200),
  due_on date not null,
  original_due_on date not null,
  status text not null default 'open' check (status in ('open','urgent','escalated','overdue','done','cancelled')),
  assigned_to uuid references auth.users (id) on delete set null,
  completed_at timestamptz,
  completed_by uuid references auth.users (id) on delete set null,
  completion_note text check (completion_note is null or char_length(completion_note) <= 1000),
  evidence_note text check (evidence_note is null or char_length(evidence_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One live renewal task per thing being renewed. A changed date updates the task; original_due_on keeps the first deadline.
create unique index if not exists renewal_tasks_live_unique on public.renewal_tasks (subject_type, subject_id) where status in ('open','urgent','escalated','overdue');
create index if not exists renewal_tasks_due_idx on public.renewal_tasks (due_on) where status in ('open','urgent','escalated','overdue');

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.renewal_tasks (id) on delete cascade,
  kind text not null default 'renewal_reminder' check (kind in ('renewal_reminder','escalation')),
  due_on date not null,
  stage_days integer not null check (stage_days between 0 and 365),
  recipient text not null check (char_length(recipient) <= 254),
  channel text not null default 'email' check (channel in ('email')),
  status text not null default 'queued' check (status in ('queued','sent','failed','skipped')),
  attempts integer not null default 0 check (attempts >= 0),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 200),
  error text check (error is null or char_length(error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Each reminder stage goes to each recipient once per deadline, however many times the daily job runs or retries.
create unique index if not exists notification_events_once on public.notification_events (task_id, due_on, stage_days, recipient, channel);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  actor_email text check (actor_email is null or char_length(actor_email) <= 254),
  event_type text not null check (char_length(event_type) between 3 and 80),
  target_type text check (target_type is null or char_length(target_type) <= 40),
  target_id uuid,
  organization_id uuid,
  changes jsonb not null default '{}'::jsonb check (jsonb_typeof(changes) = 'object'),
  reason text check (reason is null or char_length(reason) <= 1000),
  correlation_id text check (correlation_id is null or char_length(correlation_id) <= 80)
);
create index if not exists audit_events_time_idx on public.audit_events (occurred_at desc);
create index if not exists audit_events_target_idx on public.audit_events (target_type, target_id, occurred_at desc);
create index if not exists audit_events_org_idx on public.audit_events (organization_id, occurred_at desc);

create or replace function public.audit_events_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_events is append-only';
end $$;
drop trigger if exists audit_events_no_update on public.audit_events;
create trigger audit_events_no_update before update or delete on public.audit_events for each row execute function public.audit_events_immutable();
drop trigger if exists audit_events_no_truncate on public.audit_events;
create trigger audit_events_no_truncate before truncate on public.audit_events for each statement execute function public.audit_events_immutable();

-- ------------------------------------------------------------------------------------------------ updated_at
do $$
declare t text;
begin
  foreach t in array array['organizations','people','organization_memberships','office_locations','professional_credentials','efin_records','organization_roles','efin_assignments','filing_relationships','compliance_documents','renewal_tasks','notification_events'] loop
    execute format('create or replace trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ------------------------------------------------------------------------------------------------------ RLS
do $$
declare t text;
begin
  foreach t in array array['organizations','people','organization_memberships','office_locations','professional_credentials','efin_records','organization_roles','efin_assignments','filing_relationships','compliance_documents','renewal_tasks','notification_events','audit_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;
revoke update, delete, truncate on public.audit_events from service_role;

revoke execute on function public.is_bureau_admin() from public, anon;
revoke execute on function public.my_organization_ids() from public, anon;
grant execute on function public.is_bureau_admin() to authenticated, service_role;
grant execute on function public.my_organization_ids() to authenticated, service_role;
revoke execute on function public.audit_events_immutable() from public, anon, authenticated;

-- Browser roles: read-only, and never the encrypted or hashed identifier columns.
grant select (id, parent_id, kind, legal_name, dba_name, business_structure, ein_last4, primary_address, relationship, agreement_status, onboarding_status, administrator_person_id, status, notes, archived_at, created_at, updated_at) on public.organizations to authenticated;
grant select (id, full_name, email, phone, user_id, status, notes, archived_at, created_at, updated_at) on public.people to authenticated;
grant select on public.organization_memberships, public.office_locations, public.organization_roles, public.efin_assignments, public.filing_relationships, public.renewal_tasks to authenticated;
grant select (id, person_id, kind, identifier_last4, verification_status, verification_source, verified_at, expires_on, archived_at, created_at, updated_at) on public.professional_credentials to authenticated;
grant select (id, organization_id, location_id, ero_person_id, efin_last4, internal_status, external_status, external_verified_at, verification_source, recorded_expiration, expiration_verified, tax_year, archived_at, created_at, updated_at) on public.efin_records to authenticated;
grant select on public.compliance_documents, public.notification_events, public.audit_events to authenticated;

-- Policies. is_bureau_admin() is the existing admin_users list; partner users are scoped by active memberships.
drop policy if exists organizations_read on public.organizations;
create policy organizations_read on public.organizations for select to authenticated using (public.is_bureau_admin() or id in (select public.my_organization_ids()));
drop policy if exists office_locations_read on public.office_locations;
create policy office_locations_read on public.office_locations for select to authenticated using (public.is_bureau_admin() or organization_id in (select public.my_organization_ids()));
drop policy if exists memberships_read on public.organization_memberships;
create policy memberships_read on public.organization_memberships for select to authenticated using (public.is_bureau_admin() or user_id = auth.uid());
drop policy if exists organization_roles_read on public.organization_roles;
create policy organization_roles_read on public.organization_roles for select to authenticated using (public.is_bureau_admin() or organization_id in (select public.my_organization_ids()));
drop policy if exists people_read on public.people;
create policy people_read on public.people for select to authenticated using (
  public.is_bureau_admin() or user_id = auth.uid()
  or id in (select person_id from public.organization_roles where organization_id in (select public.my_organization_ids()))
);
drop policy if exists credentials_read on public.professional_credentials;
create policy credentials_read on public.professional_credentials for select to authenticated using (
  public.is_bureau_admin() or person_id in (select id from public.people where user_id = auth.uid())
);
drop policy if exists efin_records_read on public.efin_records;
create policy efin_records_read on public.efin_records for select to authenticated using (
  public.is_bureau_admin() or organization_id in (select public.my_organization_ids())
  or id in (select efin_id from public.efin_assignments where organization_id in (select public.my_organization_ids()) and state in ('approved','active'))
);
drop policy if exists efin_assignments_read on public.efin_assignments;
create policy efin_assignments_read on public.efin_assignments for select to authenticated using (public.is_bureau_admin() or organization_id in (select public.my_organization_ids()));
drop policy if exists filing_relationships_read on public.filing_relationships;
create policy filing_relationships_read on public.filing_relationships for select to authenticated using (public.is_bureau_admin() or organization_id in (select public.my_organization_ids()));
drop policy if exists renewal_tasks_read on public.renewal_tasks;
create policy renewal_tasks_read on public.renewal_tasks for select to authenticated using (public.is_bureau_admin() or organization_id in (select public.my_organization_ids()));
drop policy if exists compliance_documents_read on public.compliance_documents;
create policy compliance_documents_read on public.compliance_documents for select to authenticated using (public.is_bureau_admin());
drop policy if exists notification_events_read on public.notification_events;
create policy notification_events_read on public.notification_events for select to authenticated using (public.is_bureau_admin());
drop policy if exists audit_events_read on public.audit_events;
create policy audit_events_read on public.audit_events for select to authenticated using (public.is_bureau_admin());
