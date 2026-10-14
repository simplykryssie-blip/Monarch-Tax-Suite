-- Phase 3, Piece 2: Compliance Center (additive). Guided, not caged: where an IRS or FTC rule applies the app says
-- "Required by", and the office can still go ahead with a logged reason. Every row belongs to one office (an
-- organizations row) of one tenant.
--
-- compliance_settings      per office: WISP review schedule and reminder days, retention alert window, PTIN reminder
--                          spacing, and the office's own IRS Stakeholder Liaison contact.
-- vault_documents          the document vault: 8879s, WISPs, training records, acknowledgments. Files live in the
--                          private tenant-documents bucket under {tenant_id}/compliance/{office}/...
-- compliance_attestations  firm-level WISP attestations (who, when, which WISP, next review). Append-only.
-- compliance_acks          each team member's acknowledgment of an attestation's WISP. Append-only.
-- form_8879_records        per return: when the signed 8879 went on file, where it's kept, the return due date
--                          (with extensions) and IRS received date, and the retention end the database works out.
-- ptin_renewals            per preparer and year: renewed yes/no and when.
-- compliance_incidents     breach / data theft incidents worked through a checklist. Counts and dates only: no
--                          client names or SSNs.
-- compliance_items         the office's own checklist items (one-time or yearly).
-- compliance_events        append-only history, including every early deletion and its reason.
-- compliance_notices       one row per reminder email, recorded before sending so it's never sent twice.

create table if not exists public.compliance_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  review_months integer not null default 12 check (review_months between 1 and 36),
  review_reminder_days integer[] not null default '{30,7}' check (cardinality(review_reminder_days) between 0 and 6),
  retention_alert_days integer not null default 90 check (retention_alert_days between 0 and 730),
  ptin_reminder_every_days integer not null default 14 check (ptin_reminder_every_days between 1 and 76),
  liaison_name text check (liaison_name is null or length(liaison_name) <= 120),
  liaison_phone text check (liaison_phone is null or length(liaison_phone) <= 40),
  liaison_email text check (liaison_email is null or length(liaison_email) <= 254),
  liaison_notes text check (liaison_notes is null or length(liaison_notes) <= 500),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index if not exists compliance_settings_office_key on public.compliance_settings (tenant_id, organization_id);

create table if not exists public.vault_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  kind text not null check (kind in ('8879', 'wisp', 'training', 'acknowledgment', 'other')),
  title text not null check (length(title) between 1 and 200),
  file_path text not null check (length(file_path) between 1 and 500),
  file_type text not null check (file_type in ('pdf', 'docx')),
  size_bytes integer check (size_bytes is null or size_bytes between 0 and 26214400),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'stored')),
  retention_until date,
  answers_sealed text check (answers_sealed is null or length(answers_sealed) <= 40000),
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_by_name text check (uploaded_by_name is null or length(uploaded_by_name) <= 200),
  created_at timestamptz not null default now()
);
create unique index if not exists vault_documents_path_key on public.vault_documents (file_path);
create index if not exists vault_documents_office_idx on public.vault_documents (tenant_id, organization_id, kind, created_at desc);

create table if not exists public.compliance_attestations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  source text not null check (source in ('built', 'uploaded')),
  document_id uuid references public.vault_documents(id) on delete set null,
  statement text not null check (length(statement) between 1 and 2000),
  attested_by uuid references auth.users(id) on delete set null,
  attested_name text not null check (length(attested_name) between 1 and 200),
  attested_at timestamptz not null default now(),
  review_due date not null,
  created_at timestamptz not null default now()
);
create index if not exists compliance_attestations_office_idx on public.compliance_attestations (tenant_id, organization_id, attested_at desc);

create table if not exists public.compliance_acks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  attestation_id uuid not null references public.compliance_attestations(id) on delete restrict,
  member_id uuid not null references public.office_members(id) on delete restrict,
  member_name text not null check (length(member_name) between 1 and 200),
  acknowledged_at timestamptz not null default now()
);
create unique index if not exists compliance_acks_member_key on public.compliance_acks (attestation_id, member_id);

create table if not exists public.form_8879_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  return_id uuid references public.tax_returns(id) on delete set null,
  tax_year integer not null check (tax_year between 2000 and 2100),
  return_ref text not null check (length(return_ref) between 1 and 80),
  taxpayer_name text not null check (length(taxpayer_name) between 1 and 200),
  signed_on date not null,
  location text not null check (location in ('vault', 'software', 'paper', 'other')),
  location_note text check (location_note is null or length(location_note) <= 300),
  document_id uuid references public.vault_documents(id) on delete set null,
  due_date date not null,
  received_date date,
  retention_until date not null,
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text check (created_by_name is null or length(created_by_name) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists form_8879_office_idx on public.form_8879_records (tenant_id, organization_id, retention_until);
create index if not exists form_8879_ref_idx on public.form_8879_records (tenant_id, lower(return_ref));

create table if not exists public.ptin_renewals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  member_id uuid not null references public.office_members(id) on delete cascade,
  renewal_year integer not null check (renewal_year between 2000 and 2100),
  renewed boolean not null default false,
  renewed_on date,
  recorded_by uuid references auth.users(id) on delete set null,
  recorded_at timestamptz not null default now(),
  constraint ptin_renewals_date_needs_renewed check (renewed or renewed_on is null)
);
create unique index if not exists ptin_renewals_member_year_key on public.ptin_renewals (member_id, renewal_year);

create table if not exists public.compliance_incidents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  title text not null check (length(title) between 1 and 200),
  summary text check (summary is null or length(summary) <= 4000),
  discovered_on date not null,
  people_affected integer check (people_affected is null or people_affected between 0 and 100000000),
  info_encrypted text not null default 'unknown' check (info_encrypted in ('yes', 'no', 'unknown')),
  status text not null default 'open' check (status in ('open', 'closed')),
  steps jsonb not null default '{}'::jsonb check (jsonb_typeof(steps) = 'object'),
  irs_notified_on date,
  ftc_notified_on date,
  reported_by uuid references auth.users(id) on delete set null,
  reported_by_name text check (reported_by_name is null or length(reported_by_name) <= 200),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists compliance_incidents_office_idx on public.compliance_incidents (tenant_id, organization_id, status, created_at desc);

create table if not exists public.compliance_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  description text check (description is null or length(description) <= 2000),
  due_on date,
  repeat text not null default 'once' check (repeat in ('once', 'yearly')),
  done_at timestamptz,
  done_by uuid references auth.users(id) on delete set null,
  done_by_name text check (done_by_name is null or length(done_by_name) <= 200),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists compliance_items_office_idx on public.compliance_items (tenant_id, organization_id, due_on);

create table if not exists public.compliance_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  organization_id uuid references public.organizations(id) on delete set null,
  entity text not null check (entity in ('attestation', 'ack', '8879', 'document', 'ptin', 'incident', 'item', 'settings')),
  record_id uuid,
  action text not null check (length(action) between 1 and 60),
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text check (actor_name is null or length(actor_name) <= 200),
  reason text check (reason is null or length(reason) <= 1000),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists compliance_events_office_idx on public.compliance_events (tenant_id, organization_id, created_at desc);
create index if not exists compliance_events_record_idx on public.compliance_events (tenant_id, entity, record_id, created_at desc);

create table if not exists public.compliance_notices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  notice_key text not null check (length(notice_key) between 1 and 200),
  recipient text not null check (length(recipient) between 3 and 254),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'held_back')),
  attempts integer not null default 0 check (attempts between 0 and 20),
  last_error text check (last_error is null or length(last_error) <= 500),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create unique index if not exists compliance_notices_key on public.compliance_notices (tenant_id, notice_key, recipient);

-- History and attestations can only grow. An attestation may only lose its link to a vault file that was removed.
create or replace function public.compliance_append_only() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and tg_table_name = 'compliance_attestations' then
    if (to_jsonb(new) ->> 'document_id') is null and (to_jsonb(old) ->> 'document_id') is not null
       and (to_jsonb(new) - 'document_id') = (to_jsonb(old) - 'document_id') then
      return new;
    end if;
  end if;
  raise exception 'COMPLIANCE_RECORD_KEPT: % records cannot be changed or deleted', tg_table_name;
end $$;
create or replace trigger compliance_events_append_only before update or delete on public.compliance_events for each row execute function public.compliance_append_only();
create or replace trigger compliance_attestations_append_only before update or delete on public.compliance_attestations for each row execute function public.compliance_append_only();
create or replace trigger compliance_acks_append_only before update or delete on public.compliance_acks for each row execute function public.compliance_append_only();

-- The 8879 retention end is worked out here, so it can't drift: 3 years from the later of the return due date
-- (with extensions) and the date the IRS received the return (Publication 1345).
create or replace function public.form_8879_retention() returns trigger
language plpgsql set search_path = public as $$
begin
  new.retention_until := (greatest(new.due_date, coalesce(new.received_date, new.due_date)) + interval '3 years')::date;
  new.updated_at := now();
  return new;
end $$;
create or replace trigger form_8879_retention before insert or update on public.form_8879_records for each row execute function public.form_8879_retention();

create or replace function public.compliance_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
create or replace trigger compliance_settings_touch before update on public.compliance_settings for each row execute function public.compliance_touch();
create or replace trigger compliance_incidents_touch before update on public.compliance_incidents for each row execute function public.compliance_touch();
create or replace trigger compliance_items_touch before update on public.compliance_items for each row execute function public.compliance_touch();

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['compliance_settings', 'vault_documents', 'compliance_attestations', 'compliance_acks', 'form_8879_records', 'ptin_renewals', 'compliance_incidents', 'compliance_items', 'compliance_events', 'compliance_notices'];
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
create unique index if not exists vault_documents_tenant_id_id_key on public.vault_documents (tenant_id, id);
create unique index if not exists compliance_attestations_tenant_id_id_key on public.compliance_attestations (tenant_id, id);
do $$
declare
  k record;
begin
  for k in select * from (values
    ('compliance_settings', 'organization_id', 'organizations'),
    ('vault_documents', 'organization_id', 'organizations'),
    ('compliance_attestations', 'organization_id', 'organizations'),
    ('compliance_attestations', 'document_id', 'vault_documents'),
    ('compliance_acks', 'organization_id', 'organizations'),
    ('compliance_acks', 'attestation_id', 'compliance_attestations'),
    ('compliance_acks', 'member_id', 'office_members'),
    ('form_8879_records', 'organization_id', 'organizations'),
    ('form_8879_records', 'return_id', 'tax_returns'),
    ('form_8879_records', 'document_id', 'vault_documents'),
    ('ptin_renewals', 'organization_id', 'organizations'),
    ('ptin_renewals', 'member_id', 'office_members'),
    ('compliance_incidents', 'organization_id', 'organizations'),
    ('compliance_items', 'organization_id', 'organizations'),
    ('compliance_events', 'organization_id', 'organizations'),
    ('compliance_notices', 'organization_id', 'organizations')
  ) as v(child, col, parent) loop
    if not exists (select 1 from pg_constraint where conname = k.child || '_' || k.col || '_same_tenant') then
      execute format('alter table public.%I add constraint %I foreign key (tenant_id, %I) references public.%I (tenant_id, id)',
        k.child, k.child || '_' || k.col || '_same_tenant', k.col, k.parent);
    end if;
  end loop;
end $$;
