-- Phase 2, Step 1, Piece 2: Form Builder (additive).
--
-- Every table carries tenant_id from day one, with the Step 0 policies: tenant_app sees and writes only its own
-- tenant's rows, signed-in users only tenants they belong to, and foreign keys between these tables also check the
-- tenant (tenant_id, x_id) -> (tenant_id, id).
--
-- forms               a tenant's forms: draft definition, settings, public link id, status
-- form_versions       each published definition; never changed
-- form_submissions    drafts (saved for later) and submissions; answers are locked once submitted
-- form_uploads        files respondents uploaded, and drawn signatures
-- form_events         append-only history, including administrator views and exports
-- organizations.customer_id   links a firm (My Service Bureau) to the customer it was created for
--
-- Uploads live in the private bucket tenant-form-uploads, and submission PDFs in tenant-documents, both under
-- {tenant_id}/..., served only through 60-second signed links the server creates from rows the tenant can see.

set local lock_timeout = '10s';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tenant-form-uploads', 'tenant-form-uploads', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.forms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.require_tenant_id() references public.tenants (id) on delete restrict,
  name text not null check (length(name) between 2 and 120),
  description text check (description is null or length(description) <= 1000),
  status text not null default 'draft' check (status in ('draft', 'published', 'closed', 'archived')),
  -- The id in the public link /f/{public_id}: random, not the row id and not the tenant's name.
  public_id text not null unique check (public_id ~ '^[A-Za-z0-9]{16}$'),
  draft_definition jsonb not null default '{}'::jsonb check (jsonb_typeof(draft_definition) = 'object'),
  draft_updated_at timestamptz,
  current_version_id uuid,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  -- Consent language shown before signing. Written by the tenant; required before a form with a signature is published.
  signature_consent text check (signature_consent is null or length(signature_consent) between 20 and 5000),
  submission_seq integer not null default 0 check (submission_seq >= 0),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.form_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.require_tenant_id() references public.tenants (id) on delete restrict,
  form_id uuid not null references public.forms (id) on delete cascade,
  version integer not null check (version >= 1),
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  published_by uuid,
  published_at timestamptz not null default now(),
  unique (form_id, version)
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'forms_current_version_fkey') then
    alter table public.forms add constraint forms_current_version_fkey foreign key (current_version_id) references public.form_versions (id) on delete set null;
  end if;
end $$;

create or replace function public.form_versions_frozen() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'FORM_VERSION_FROZEN: a published form version cannot be changed';
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'form_versions_frozen' and tgrelid = 'public.form_versions'::regclass) then
    create trigger form_versions_frozen before update on public.form_versions for each row execute function public.form_versions_frozen();
  end if;
end $$;

alter table public.organizations add column if not exists customer_id uuid references public.calculator_customers (id) on delete set null;
create index if not exists organizations_customer_idx on public.organizations (customer_id) where customer_id is not null;

create table if not exists public.form_submissions (
  id uuid primary key,
  tenant_id uuid not null default public.require_tenant_id() references public.tenants (id) on delete restrict,
  form_id uuid not null references public.forms (id) on delete restrict,
  version_id uuid not null references public.form_versions (id) on delete restrict,
  number integer check (number is null or number >= 1),
  status text not null default 'draft' check (status in ('draft', 'new', 'in_review', 'done', 'spam')),
  is_test boolean not null default false,
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  respondent_email text check (respondent_email is null or length(respondent_email) <= 254),
  respondent_name text check (respondent_name is null or length(respondent_name) <= 200),
  customer_id uuid references public.calculator_customers (id) on delete restrict,
  organization_id uuid references public.organizations (id) on delete set null,
  firm_status text not null default 'none' check (firm_status in ('none', 'linked', 'created', 'failed')),
  firm_error text check (firm_error is null or length(firm_error) <= 500),
  -- Drafts: only a hash of the resume token is stored.
  draft_token_hash text unique check (draft_token_hash is null or draft_token_hash ~ '^[0-9a-f]{64}$'),
  draft_expires_at timestamptz,
  resume_email text check (resume_email is null or length(resume_email) <= 254),
  resume_sent_at timestamptz,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  ip_hash text check (ip_hash is null or length(ip_hash) <= 64),
  user_agent text check (user_agent is null or length(user_agent) <= 300),
  consent_text text check (consent_text is null or length(consent_text) between 20 and 5000),
  consented_at timestamptz,
  signature jsonb check (signature is null or jsonb_typeof(signature) = 'object'),
  pdf_path text unique check (pdf_path is null or pdf_path ~ '^[0-9a-f-]{36}/submissions/[0-9a-f-]{36}\.pdf$'),
  pdf_sha256 text check (pdf_sha256 is null or pdf_sha256 ~ '^[0-9a-f]{64}$'),
  pdf_generated_at timestamptz,
  pdf_attempts integer not null default 0,
  pdf_error text check (pdf_error is null or length(pdf_error) <= 500),
  -- The confirmation-screen download: a hash of a token held in an http-only cookie, valid for an hour.
  receipt_token_hash text unique check (receipt_token_hash is null or receipt_token_hash ~ '^[0-9a-f]{64}$'),
  receipt_expires_at timestamptz,
  notified_at timestamptz,
  notify_error text check (notify_error is null or length(notify_error) <= 500),
  confirmation_sent_at timestamptz,
  spam_reason text check (spam_reason is null or length(spam_reason) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'draft' or (number is not null and submitted_at is not null))
);
create unique index if not exists form_submissions_number_key on public.form_submissions (form_id, number) where number is not null;
create index if not exists form_submissions_form_idx on public.form_submissions (form_id, submitted_at desc);
create index if not exists form_submissions_customer_idx on public.form_submissions (customer_id) where customer_id is not null;
create index if not exists form_submissions_drafts_idx on public.form_submissions (draft_expires_at) where status = 'draft';
create index if not exists form_submissions_pdf_idx on public.form_submissions (created_at) where status <> 'draft' and pdf_path is null;

-- Answers are locked once submitted, and submissions are kept: only drafts and spam can be deleted.
create or replace function public.form_submissions_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status not in ('draft', 'spam') then
      raise exception 'SUBMISSION_KEPT: submitted forms cannot be deleted';
    end if;
    return old;
  end if;
  if old.status <> 'draft' then
    if new.status = 'draft' then
      raise exception 'SUBMISSION_LOCKED: a submission cannot become a draft again';
    end if;
    if new.answers is distinct from old.answers or new.form_id is distinct from old.form_id or new.version_id is distinct from old.version_id
       or new.number is distinct from old.number or new.submitted_at is distinct from old.submitted_at or new.started_at is distinct from old.started_at
       or new.signature is distinct from old.signature or new.consent_text is distinct from old.consent_text or new.consented_at is distinct from old.consented_at
       or new.is_test is distinct from old.is_test then
      raise exception 'SUBMISSION_LOCKED: answers cannot be changed after submission';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'form_submissions_guard' and tgrelid = 'public.form_submissions'::regclass) then
    create trigger form_submissions_guard before update or delete on public.form_submissions for each row execute function public.form_submissions_guard();
  end if;
end $$;

create table if not exists public.form_uploads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.require_tenant_id() references public.tenants (id) on delete restrict,
  form_id uuid not null references public.forms (id) on delete restrict,
  submission_id uuid not null references public.form_submissions (id) on delete cascade,
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  kind text not null default 'file' check (kind in ('file', 'signature')),
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}/forms/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  file_name text not null check (length(file_name) between 1 and 160),
  content_type text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'attached', 'rejected')),
  created_at timestamptz not null default now()
);
create index if not exists form_uploads_submission_idx on public.form_uploads (submission_id);

create table if not exists public.form_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.require_tenant_id() references public.tenants (id) on delete restrict,
  form_id uuid references public.forms (id) on delete cascade,
  submission_id uuid references public.form_submissions (id) on delete cascade,
  type text not null check (length(type) between 3 and 60),
  actor_id uuid,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists form_events_submission_idx on public.form_events (submission_id, created_at desc);
create index if not exists form_events_form_idx on public.form_events (form_id, created_at desc);

-- The next submission number for a form, taken atomically.
create or replace function public.form_take_number(p_form uuid) returns integer
language sql security invoker set search_path = public as $$
  update public.forms set submission_seq = submission_seq + 1, updated_at = now() where id = p_form returning submission_seq
$$;

-- Creates a firm (My Service Bureau organization) from a form submission in one transaction: the organization
-- linked to the customer, its main office, the mapped people with their roles and PTINs, and the EFIN with a draft
-- ERO assignment. Runs as the caller, so tenant_app writes only its own tenant. Identifiers arrive encrypted.
create or replace function public.firm_from_submission(p jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  org uuid := (p->>'org_id')::uuid;
  loc uuid := (p->>'loc_id')::uuid;
  rel text := coalesce(p->>'relationship', 'partner');
  who text := coalesce(p->>'actor_email', 'form submission');
  x jsonb;
  ero uuid;
  first_person uuid;
  efin uuid := nullif(p->'efin'->>'efin_id', '')::uuid;
  has_responsible boolean := false;
begin
  insert into organizations (id, legal_name, dba_name, ein_encrypted, ein_last4, primary_address, relationship, agreement_status, onboarding_status, notes, customer_id)
  values (org, p->>'legal_name', nullif(p->>'dba_name', ''), nullif(p->>'ein_encrypted', ''), nullif(p->>'ein_last4', ''), coalesce(p->'address', '{}'::jsonb), rel, 'pending', 'in_progress',
          nullif(p->>'notes', ''), nullif(p->>'customer_id', '')::uuid);
  insert into office_locations (id, organization_id, name, address, is_primary) values (loc, org, p->>'office_name', coalesce(p->'address', '{}'::jsonb), true);
  insert into audit_events (actor_id, actor_email, event_type, target_type, target_id, organization_id, changes)
  values (null, who, 'organization.created', 'organization', org, org, jsonb_build_object('legal_name', p->>'legal_name', 'relationship', rel, 'source', 'form_submission', 'submission_id', p->>'submission_id'));

  for x in select * from jsonb_array_elements(coalesce(p->'people', '[]'::jsonb)) loop
    -- Software and service clients keep one contact and no team or PTINs.
    exit when rel = 'client' and first_person is not null;
    insert into people (id, full_name, email, phone) values ((x->>'person_id')::uuid, x->>'full_name', nullif(x->>'email', ''), nullif(x->>'phone', ''));
    first_person := coalesce(first_person, (x->>'person_id')::uuid);
    if x->>'role' = 'ero' and ero is null then ero := (x->>'person_id')::uuid; end if;
    if x->>'role' = 'responsible_official' then has_responsible := true; end if;
    insert into organization_roles (organization_id, person_id, role, location_id) values (org, (x->>'person_id')::uuid, x->>'role', loc);
    insert into audit_events (actor_id, actor_email, event_type, target_type, target_id, organization_id, changes)
    values (null, who, 'person.created', 'person', (x->>'person_id')::uuid, org, jsonb_build_object('full_name', x->>'full_name', 'role', x->>'role'));
    if rel <> 'client' and nullif(x->>'cred_id', '') is not null then
      insert into professional_credentials (id, person_id, kind, identifier_encrypted, identifier_last4, identifier_hash)
      values ((x->>'cred_id')::uuid, (x->>'person_id')::uuid, 'ptin', x->>'ptin_encrypted', x->>'ptin_last4', x->>'ptin_hash');
      insert into audit_events (actor_id, actor_email, event_type, target_type, target_id, changes)
      values (null, who, 'credential.created', 'credential', (x->>'cred_id')::uuid, jsonb_build_object('kind', 'ptin', 'last4', x->>'ptin_last4', 'person_id', x->>'person_id'));
    end if;
  end loop;
  update organizations set administrator_person_id = coalesce(ero, first_person) where id = org;
  -- As in onboarding: the ERO is also the responsible official unless someone else was named.
  if ero is not null and not has_responsible then
    insert into organization_roles (organization_id, person_id, role, location_id) values (org, ero, 'responsible_official', loc);
  end if;

  if efin is not null then
    insert into efin_records (id, efin_encrypted, efin_last4, efin_hash, organization_id, location_id, ero_person_id, internal_status, external_status)
    values (efin, p->'efin'->>'efin_encrypted', p->'efin'->>'efin_last4', p->'efin'->>'efin_hash', org, loc, coalesce(ero, first_person), 'pending_verification', 'unverified');
    insert into audit_events (actor_id, actor_email, event_type, target_type, target_id, organization_id, changes)
    values (null, who, 'efin.created', 'efin', efin, org, jsonb_build_object('last4', p->'efin'->>'efin_last4', 'external_status', 'unverified', 'source', 'form_submission'));
    if rel <> 'client' and coalesce(ero, first_person) is not null then
      insert into efin_assignments (efin_id, organization_id, location_id, person_id, role, state) values (efin, org, loc, coalesce(ero, first_person), 'ero', 'draft');
    end if;
  end if;
  return org;
end $$;

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['forms', 'form_versions', 'form_submissions', 'form_uploads', 'form_events'];
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
  foreach t in array array['public.form_take_number(uuid)', 'public.firm_from_submission(jsonb)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', t);
    execute format('grant execute on function %s to service_role, tenant_app', t);
  end loop;
end $$;

-- Same-tenant references: every foreign key between tenant tables also matches on tenant_id.
do $$
declare
  p text;
  r record;
begin
  foreach p in array array['forms', 'form_versions', 'form_submissions', 'calculator_customers', 'organizations'] loop
    execute format('create unique index if not exists %I on public.%I (tenant_id, id)', p || '_tenant_id_id_key', p);
  end loop;
  for r in
    select c.conrelid::regclass::text as child, a.attname as col, c.confrelid::regclass::text as parent
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace and array_length(c.conkey, 1) = 1
      and (c.conrelid::regclass::text = any (array['forms', 'form_versions', 'form_submissions', 'form_uploads', 'form_events'])
           or (c.conrelid::regclass::text = 'organizations' and a.attname = 'customer_id'))
      and exists (select 1 from information_schema.columns ic where ic.table_schema = 'public' and ic.table_name = c.confrelid::regclass::text and ic.column_name = 'tenant_id')
      and exists (select 1 from pg_indexes i where i.schemaname = 'public' and i.tablename = c.confrelid::regclass::text and i.indexname = c.confrelid::regclass::text || '_tenant_id_id_key')
      and a.attname not in ('tenant_id')
  loop
    if not exists (select 1 from pg_constraint where conrelid = r.child::regclass and conname = r.child || '_' || r.col || '_same_tenant') then
      execute format('alter table public.%I add constraint %I foreign key (tenant_id, %I) references public.%I (tenant_id, id)',
        r.child, r.child || '_' || r.col || '_same_tenant', r.col, r.parent);
    end if;
  end loop;
end $$;
