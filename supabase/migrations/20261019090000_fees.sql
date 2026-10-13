-- Phase 3, Piece 1: Fees & Statements (additive).
--
-- fee_schedules     a tenant's fee schedule. One default for the bureau (organization_id is null) and at most one
--                   override per office (an office is a firm in My Service Bureau, an organizations row).
-- fee_lines         the line items of a schedule: a label and an amount, charged on every return or only on
--                   bank-product returns (optionally for one bank). Nothing is hardcoded: Monarch's $223 is only a
--                   template the bureau can load. An override line replaces the default line with the same code.
--                   kind is 'fee' only for now; the column leaves room for a rebate line a future tenant may need.
-- tax_returns       the basic return record: office, tax year, the software's return reference, taxpayer name,
--                   bank product, filed and funded dates. Imported from CSV or entered by hand. No SSNs.
-- return_fees       the fees charged on a return, copied from the schedule when the return is recorded, so a later
--                   schedule change never rewrites past statements.
-- bank_imports      each bank CSV upload, with its file fingerprint so the same file can't be imported twice.
-- fee_receipts      money against returns: what a bank reports as owed and collected, and payments an ERO makes
--                   for returns without a bank product (marked paid by hand). Bank rows that match no return are
--                   kept unlinked until someone links them.
-- fee_csv_mappings  the column mapping last used for each kind of import, reused next time.
-- fee_events        append-only history of every change: who, when, what and why.
--
-- Same tenant rules as every table since Step 0: tenant_id with the required default, the two policies, and
-- same-tenant foreign keys.

create table if not exists public.fee_schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  notes text check (notes is null or length(notes) <= 1000),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists fee_schedules_default_key on public.fee_schedules (tenant_id) where organization_id is null;
create unique index if not exists fee_schedules_office_key on public.fee_schedules (tenant_id, organization_id) where organization_id is not null;

create table if not exists public.fee_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  schedule_id uuid not null references public.fee_schedules(id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9][a-z0-9_:-]{0,79}$'),
  label text not null check (length(label) between 1 and 120),
  amount_cents integer not null check (amount_cents between 0 and 10000000),
  applies text not null default 'every_return' check (applies in ('every_return', 'bank_product')),
  bank_option_id uuid references public.bureau_options(id) on delete cascade,
  kind text not null default 'fee' check (kind in ('fee')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fee_lines_bank_needs_bank_product check (bank_option_id is null or applies = 'bank_product')
);
create unique index if not exists fee_lines_code_key on public.fee_lines (schedule_id, code);
create index if not exists fee_lines_schedule_idx on public.fee_lines (tenant_id, schedule_id, sort_order);

create table if not exists public.tax_returns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  tax_year integer not null check (tax_year between 2000 and 2100),
  return_ref text not null check (length(return_ref) between 1 and 80),
  taxpayer_name text not null check (length(taxpayer_name) between 1 and 200),
  bank_option_id uuid references public.bureau_options(id) on delete set null,
  filed_on date,
  funded_on date,
  source text not null default 'manual' check (source in ('manual', 'import')),
  notes text check (notes is null or length(notes) <= 2000),
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  archive_reason text check (archive_reason is null or length(archive_reason) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists tax_returns_ref_key on public.tax_returns (tenant_id, organization_id, tax_year, lower(return_ref));
create index if not exists tax_returns_office_idx on public.tax_returns (tenant_id, organization_id, tax_year);
create index if not exists tax_returns_ref_idx on public.tax_returns (tenant_id, lower(return_ref));

create table if not exists public.return_fees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  return_id uuid not null references public.tax_returns(id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9][a-z0-9_:-]{0,79}$'),
  label text not null check (length(label) between 1 and 120),
  amount_cents integer not null check (amount_cents between 0 and 10000000),
  applies text not null check (applies in ('every_return', 'bank_product')),
  schedule_id uuid references public.fee_schedules(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists return_fees_code_key on public.return_fees (return_id, code);
create index if not exists return_fees_return_idx on public.return_fees (tenant_id, return_id);

create table if not exists public.bank_imports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  bank_option_id uuid not null references public.bureau_options(id) on delete restrict,
  file_name text not null check (length(file_name) between 1 and 200),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  row_count integer not null check (row_count >= 0),
  matched_count integer not null check (matched_count >= 0),
  unmatched_count integer not null check (unmatched_count >= 0),
  imported_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists bank_imports_file_key on public.bank_imports (tenant_id, file_sha256);

create table if not exists public.fee_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  kind text not null check (kind in ('bank', 'ero_payment')),
  organization_id uuid references public.organizations(id) on delete restrict,
  return_id uuid references public.tax_returns(id) on delete restrict,
  import_id uuid references public.bank_imports(id) on delete cascade,
  bank_option_id uuid references public.bureau_options(id) on delete set null,
  owed_cents integer check (owed_cents is null or owed_cents between 0 and 100000000),
  collected_cents integer not null check (collected_cents between 0 and 100000000),
  received_on date,
  reference text check (reference is null or length(reference) <= 120),
  row_ref text check (row_ref is null or length(row_ref) <= 80),
  row_name text check (row_name is null or length(row_name) <= 200),
  note text check (note is null or length(note) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint fee_receipts_payment_needs_return check (kind <> 'ero_payment' or return_id is not null),
  constraint fee_receipts_bank_needs_import check (kind <> 'bank' or import_id is not null),
  constraint fee_receipts_linked_needs_office check (return_id is null or organization_id is not null)
);
create index if not exists fee_receipts_return_idx on public.fee_receipts (tenant_id, return_id);
create index if not exists fee_receipts_office_idx on public.fee_receipts (tenant_id, organization_id);
create index if not exists fee_receipts_unmatched_idx on public.fee_receipts (tenant_id, created_at desc) where return_id is null;

create table if not exists public.fee_csv_mappings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  kind text not null check (kind in ('returns', 'bank')),
  mapping jsonb not null check (jsonb_typeof(mapping) = 'object'),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index if not exists fee_csv_mappings_kind_key on public.fee_csv_mappings (tenant_id, kind);

create table if not exists public.fee_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  entity text not null check (entity in ('schedule', 'line', 'return', 'import', 'receipt', 'statement')),
  record_id uuid,
  organization_id uuid references public.organizations(id) on delete set null,
  action text not null check (length(action) between 1 and 60),
  actor_id uuid references auth.users(id) on delete set null,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  reason text check (reason is null or length(reason) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists fee_events_recent_idx on public.fee_events (tenant_id, created_at desc);
create index if not exists fee_events_record_idx on public.fee_events (tenant_id, entity, record_id, created_at desc);

-- The history can only grow.
create or replace function public.fee_events_append_only() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'FEE_HISTORY_KEPT: the fee history cannot be changed or deleted';
end $$;
drop trigger if exists fee_events_append_only on public.fee_events;
create trigger fee_events_append_only before update or delete on public.fee_events for each row execute function public.fee_events_append_only();

-- Money already recorded against a return stays: receipts can't be edited, and a return with receipts can't be
-- deleted (the restrict keys above); mistakes are reversed by archiving the return or linking the row elsewhere.
create or replace function public.fee_receipts_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.kind = 'ero_payment' then
      raise exception 'FEE_RECEIPT_KEPT: recorded payments cannot be deleted';
    end if;
    return old;
  end if;
  -- Only linking an unmatched bank row to a return (and its office) may change a receipt.
  if new.kind is distinct from old.kind or new.collected_cents is distinct from old.collected_cents or new.owed_cents is distinct from old.owed_cents
     or new.import_id is distinct from old.import_id or new.received_on is distinct from old.received_on or new.created_at is distinct from old.created_at
     or (old.return_id is not null and new.return_id is distinct from old.return_id) then
    raise exception 'FEE_RECEIPT_KEPT: recorded amounts cannot be changed';
  end if;
  return new;
end $$;
drop trigger if exists fee_receipts_guard on public.fee_receipts;
create trigger fee_receipts_guard before update or delete on public.fee_receipts for each row execute function public.fee_receipts_guard();

create or replace function public.fees_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists fee_schedules_touch on public.fee_schedules;
create trigger fee_schedules_touch before update on public.fee_schedules for each row execute function public.fees_touch();
drop trigger if exists fee_lines_touch on public.fee_lines;
create trigger fee_lines_touch before update on public.fee_lines for each row execute function public.fees_touch();
drop trigger if exists tax_returns_touch on public.tax_returns;
create trigger tax_returns_touch before update on public.tax_returns for each row execute function public.fees_touch();

-- A bank line or a return's bank must name a bank product, not a tax software entry.
create or replace function public.fees_bank_is_bank_product() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.bank_option_id is not null and not exists (select 1 from public.bureau_options o where o.id = new.bank_option_id and o.kind = 'bank_product') then
    raise exception 'FEE_NOT_A_BANK: choose a bank product from Software & banking';
  end if;
  return new;
end $$;
drop trigger if exists fee_lines_bank_check on public.fee_lines;
create trigger fee_lines_bank_check before insert or update on public.fee_lines for each row execute function public.fees_bank_is_bank_product();
drop trigger if exists tax_returns_bank_check on public.tax_returns;
create trigger tax_returns_bank_check before insert or update on public.tax_returns for each row execute function public.fees_bank_is_bank_product();
drop trigger if exists bank_imports_bank_check on public.bank_imports;
create trigger bank_imports_bank_check before insert or update on public.bank_imports for each row execute function public.fees_bank_is_bank_product();

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['fee_schedules', 'fee_lines', 'tax_returns', 'return_fees', 'bank_imports', 'fee_receipts', 'fee_csv_mappings', 'fee_events'];
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
create unique index if not exists fee_schedules_tenant_id_id_key on public.fee_schedules (tenant_id, id);
create unique index if not exists tax_returns_tenant_id_id_key on public.tax_returns (tenant_id, id);
create unique index if not exists bank_imports_tenant_id_id_key on public.bank_imports (tenant_id, id);
do $$
declare
  k record;
begin
  for k in select * from (values
    ('fee_schedules', 'organization_id', 'organizations', ''),
    ('fee_lines', 'schedule_id', 'fee_schedules', ''),
    ('fee_lines', 'bank_option_id', 'bureau_options', ''),
    ('tax_returns', 'organization_id', 'organizations', ''),
    ('tax_returns', 'bank_option_id', 'bureau_options', ''),
    ('return_fees', 'return_id', 'tax_returns', ''),
    ('return_fees', 'schedule_id', 'fee_schedules', ''),
    ('bank_imports', 'bank_option_id', 'bureau_options', ''),
    ('fee_receipts', 'organization_id', 'organizations', ''),
    ('fee_receipts', 'return_id', 'tax_returns', ''),
    ('fee_receipts', 'import_id', 'bank_imports', ''),
    ('fee_receipts', 'bank_option_id', 'bureau_options', ''),
    ('fee_events', 'organization_id', 'organizations', '')
  ) as v(child, col, parent, tail) loop
    if not exists (select 1 from pg_constraint where conname = k.child || '_' || k.col || '_same_tenant') then
      execute format('alter table public.%I add constraint %I foreign key (tenant_id, %I) references public.%I (tenant_id, id)%s',
        k.child, k.child || '_' || k.col || '_same_tenant', k.col, k.parent, k.tail);
    end if;
  end loop;
end $$;
