-- Phase 2, Step 1, Piece 1: document management (additive).
--
-- Every table carries tenant_id from day one, with the Step 0 policies: tenant_app sees and writes only its own
-- tenant's rows, signed-in users only tenants they belong to, and foreign keys between these tables also check the
-- tenant (tenant_id, x_id) -> (tenant_id, id).
--
-- tenant_profiles          firm name, contact details and time zone (one row per tenant)
-- email_domains            sending domains a tenant connected (verified through the email provider)
-- email_senders            from-addresses ("brands") on those domains; workflow emails pick one
-- package_attributes       attributes a tenant defines for its products; workflow conditions can test them
-- documents                library entries (PDF or DOCX), templates when they contain merge fields
-- document_versions        each uploaded file; never overwritten
-- document_deliveries      each filled copy sent to someone, with its secure link (only a hash of the token)
-- signature_requests       e-signature requests and their evidence
-- document_events          append-only history
--
-- Files live in the private bucket tenant-documents under {tenant_id}/..., served only through 60-second signed
-- links the server creates from rows the tenant can see.

set local lock_timeout = '10s';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tenant-documents', 'tenant-documents', false, 26214400,
        array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.tenant_profiles (
  tenant_id uuid not null primary key references public.tenants (id) on delete cascade,
  legal_name text not null check (length(legal_name) between 2 and 200),
  display_name text not null check (length(display_name) between 2 and 120),
  email text check (email is null or (length(email) <= 254 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$')),
  phone text check (phone is null or length(phone) <= 40),
  address text check (address is null or length(address) <= 400),
  time_zone text not null default 'America/New_York' check (length(time_zone) between 3 and 64),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.tenant_profiles (tenant_id, legal_name, display_name, email)
values ('00000000-0000-4000-8000-000000000001', 'Monarch Tax Suite', 'Monarch Tax Suite', 'support@monarchtaxsuite.com')
on conflict (tenant_id) do nothing;

create table if not exists public.email_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.require_tenant_id() references public.tenants (id) on delete restrict,
  -- A domain can belong to one tenant only: it is registered once with the email provider.
  domain text not null unique check (domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' and length(domain) <= 253),
  provider_domain_id text unique,
  status text not null default 'pending' check (status in ('pending', 'verified', 'failed')),
  dns_records jsonb not null default '[]'::jsonb check (jsonb_typeof(dns_records) = 'array'),
  last_checked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_senders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.require_tenant_id() references public.tenants (id) on delete restrict,
  domain_id uuid not null references public.email_domains (id) on delete restrict,
  from_name text not null check (length(from_name) between 2 and 80 and from_name !~ '[<>"\r\n]'),
  local_part text not null check (local_part ~ '^[a-z0-9]([a-z0-9._+-]{0,62}[a-z0-9])?$'),
  reply_to text check (reply_to is null or (length(reply_to) <= 254 and reply_to ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$')),
  is_default boolean not null default false,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (domain_id, local_part)
);
create unique index if not exists email_senders_one_default on public.email_senders (tenant_id) where is_default and archived_at is null;

alter table public.automation_templates add column if not exists sender_id uuid references public.email_senders (id) on delete restrict;

create table if not exists public.package_attributes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.require_tenant_id() references public.tenants (id) on delete restrict,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null check (length(label) between 2 and 80),
  kind text not null default 'choice' check (kind in ('choice', 'text')),
  options text[] not null default '{}' check (cardinality(options) <= 30),
  created_at timestamptz not null default now(),
  unique (tenant_id, key)
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.require_tenant_id() references public.tenants (id) on delete restrict,
  name text not null check (length(name) between 2 and 120),
  description text check (description is null or length(description) <= 1000),
  file_type text not null check (file_type in ('pdf', 'docx')),
  status text not null default 'active' check (status in ('active', 'archived')),
  current_version_id uuid,
  -- Consent language shown before signing. Written by the tenant; required before the document can be signed.
  signature_consent text check (signature_consent is null or length(signature_consent) between 20 and 5000),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.require_tenant_id() references public.tenants (id) on delete restrict,
  document_id uuid not null references public.documents (id) on delete cascade,
  version integer not null check (version >= 1),
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}/versions/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  file_name text not null check (length(file_name) between 5 and 120 and file_name ~* '\.(pdf|docx)$'),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 26214400),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  merge_fields text[] not null default '{}',
  has_signature_field boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'ready', 'rejected')),
  created_by uuid,
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  unique (document_id, version)
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'documents_current_version_fkey') then
    alter table public.documents add constraint documents_current_version_fkey foreign key (current_version_id) references public.document_versions (id) on delete restrict;
  end if;
end $$;

create table if not exists public.document_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.require_tenant_id() references public.tenants (id) on delete restrict,
  document_id uuid not null references public.documents (id) on delete restrict,
  version_id uuid not null references public.document_versions (id) on delete restrict,
  kind text not null check (kind in ('send', 'signature')),
  customer_id uuid references public.calculator_customers (id) on delete restrict,
  order_id uuid references public.orders (id) on delete restrict,
  recipient_email text not null check (length(recipient_email) <= 254),
  recipient_name text check (recipient_name is null or length(recipient_name) <= 200),
  execution_id uuid references public.automation_executions (id) on delete set null,
  action_index integer,
  is_test boolean not null default false,
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}/deliveries/[0-9a-f-]{36}\.(pdf|docx)$'),
  file_name text not null check (length(file_name) between 5 and 160),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  first_opened_at timestamptz,
  last_downloaded_at timestamptz,
  download_count integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now()
);
-- A workflow step sends one copy per run, however often the run is retried.
create unique index if not exists document_deliveries_once_per_step on public.document_deliveries (execution_id, action_index) where execution_id is not null;
create index if not exists document_deliveries_document_idx on public.document_deliveries (document_id, created_at desc);

create table if not exists public.signature_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.require_tenant_id() references public.tenants (id) on delete restrict,
  delivery_id uuid not null unique references public.document_deliveries (id) on delete restrict,
  document_id uuid not null references public.documents (id) on delete restrict,
  signer_email text not null check (length(signer_email) <= 254),
  signer_name text check (signer_name is null or length(signer_name) <= 200),
  consent_text text not null check (length(consent_text) between 20 and 5000),
  status text not null default 'sent' check (status in ('sent', 'viewed', 'signed', 'declined', 'expired', 'voided')),
  reminder_days integer check (reminder_days is null or reminder_days between 1 and 30),
  last_reminded_at timestamptz,
  expires_at timestamptz not null,
  viewed_at timestamptz,
  consented_at timestamptz,
  signed_at timestamptz,
  signed_name text check (signed_name is null or length(signed_name) between 2 and 200),
  signature_method text check (signature_method is null or signature_method in ('typed', 'drawn')),
  signer_ip_hash text,
  signer_user_agent text check (signer_user_agent is null or length(signer_user_agent) <= 300),
  original_sha256 text not null check (original_sha256 ~ '^[0-9a-f]{64}$'),
  signed_storage_path text unique check (signed_storage_path is null or signed_storage_path ~ '^[0-9a-f-]{36}/signed/[0-9a-f-]{36}\.pdf$'),
  signed_sha256 text check (signed_sha256 is null or signed_sha256 ~ '^[0-9a-f]{64}$'),
  declined_at timestamptz,
  decline_reason text check (decline_reason is null or length(decline_reason) <= 1000),
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists signature_requests_open_idx on public.signature_requests (status, expires_at) where status in ('sent', 'viewed');

create table if not exists public.document_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.require_tenant_id() references public.tenants (id) on delete restrict,
  document_id uuid references public.documents (id) on delete cascade,
  delivery_id uuid references public.document_deliveries (id) on delete cascade,
  signature_request_id uuid references public.signature_requests (id) on delete cascade,
  type text not null check (length(type) between 3 and 60),
  actor_id uuid,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists document_events_document_idx on public.document_events (document_id, created_at desc);

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['tenant_profiles', 'email_domains', 'email_senders', 'package_attributes', 'documents',
                         'document_versions', 'document_deliveries', 'signature_requests', 'document_events'];
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

-- Same-tenant references: every foreign key between tenant tables also matches on tenant_id.
do $$
declare
  p text;
  r record;
begin
  foreach p in array array['email_domains', 'email_senders', 'documents', 'document_versions', 'document_deliveries', 'signature_requests', 'automation_executions'] loop
    execute format('create unique index if not exists %I on public.%I (tenant_id, id)', p || '_tenant_id_id_key', p);
  end loop;
  for r in
    select c.conrelid::regclass::text as child, a.attname as col, c.confrelid::regclass::text as parent
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace and array_length(c.conkey, 1) = 1
      and c.conrelid::regclass::text = any (array['email_senders', 'automation_templates', 'documents', 'document_versions', 'document_deliveries', 'signature_requests', 'document_events'])
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
