-- Round 2, My Workspace and Billing: the account holder's own clients, the returns they prepare for them (the My Work
-- board), the documents, messages, tasks and notes on each client, invoices, and bank-statement imports that match
-- payments to invoices. Every table has tenant_id from day one, the standard two policies, and same-tenant keys.
--
-- clients             a person or business the office prepares returns for. Only the last 4 digits of an SSN are kept.
-- client_returns      one card on the My Work board: original, extension or amendment for a tax year, in a pipeline stage.
-- client_docs         files on a client (stored in the private tenant-documents bucket under {tenant_id}/clients/...).
-- client_messages     a log of messages with a client (email, text, call), sent or received.
-- client_tasks        to-dos for a client or one of their returns.
-- client_notes        free notes on a client.
-- invoices            what a client owes for a return; lines default to the $223 breakdown and stay editable.
-- payment_imports     one uploaded bank statement CSV, reviewed before anything is applied.
-- payment_import_rows each deposit in it, with what was read from the description and the invoice it matched.

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  full_name text not null check (length(full_name) between 1 and 200),
  email text check (email is null or (length(email) between 3 and 254 and email = lower(email))),
  phone text check (phone is null or length(phone) <= 40),
  ssn_last4 text check (ssn_last4 is null or ssn_last4 ~ '^[0-9]{4}$'),
  address text check (address is null or length(address) <= 300),
  archived_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clients_name_idx on public.clients (tenant_id, lower(full_name));

create table if not exists public.client_returns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  client_id uuid not null references public.clients(id) on delete restrict,
  tax_year integer not null check (tax_year between 2000 and 2100),
  kind text not null default 'original' check (kind in ('original', 'extension', 'amendment')),
  parent_id uuid references public.client_returns(id) on delete set null,
  stage_id text not null default 'intake' check (length(stage_id) between 1 and 30),
  due_on date,
  filed_on date,
  notes text check (notes is null or length(notes) <= 2000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_returns_board_idx on public.client_returns (tenant_id, tax_year, stage_id) where archived_at is null;
create index if not exists client_returns_client_idx on public.client_returns (tenant_id, client_id);
-- A client has one original and one extension per year; amendments can repeat.
create unique index if not exists client_returns_one_per_year on public.client_returns (tenant_id, client_id, tax_year, kind) where kind in ('original', 'extension') and archived_at is null;

create table if not exists public.client_docs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  client_id uuid not null references public.clients(id) on delete restrict,
  return_id uuid references public.client_returns(id) on delete set null,
  title text not null check (length(title) between 1 and 200),
  file_path text not null check (length(file_path) between 1 and 500),
  file_type text not null check (file_type in ('pdf', 'docx', 'png', 'jpg', 'xlsx', 'csv', 'txt')),
  size_bytes integer check (size_bytes is null or size_bytes between 0 and 26214400),
  status text not null default 'pending' check (status in ('pending', 'stored')),
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists client_docs_path_key on public.client_docs (file_path);
create index if not exists client_docs_client_idx on public.client_docs (tenant_id, client_id, created_at desc);

create table if not exists public.client_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  client_id uuid not null references public.clients(id) on delete restrict,
  direction text not null default 'out' check (direction in ('out', 'in')),
  channel text not null default 'email' check (channel in ('email', 'sms', 'call', 'other')),
  subject text check (subject is null or length(subject) <= 200),
  body text not null check (length(body) between 1 and 4000),
  occurred_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists client_messages_client_idx on public.client_messages (tenant_id, client_id, occurred_at desc);

create table if not exists public.client_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  client_id uuid not null references public.clients(id) on delete restrict,
  return_id uuid references public.client_returns(id) on delete set null,
  title text not null check (length(title) between 1 and 200),
  due_on date,
  done_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists client_tasks_open_idx on public.client_tasks (tenant_id, due_on) where done_at is null;
create index if not exists client_tasks_client_idx on public.client_tasks (tenant_id, client_id);

create table if not exists public.client_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  client_id uuid not null references public.clients(id) on delete restrict,
  body text not null check (length(body) between 1 and 4000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists client_notes_client_idx on public.client_notes (tenant_id, client_id, created_at desc);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  client_id uuid not null references public.clients(id) on delete restrict,
  return_id uuid references public.client_returns(id) on delete set null,
  number text not null check (number ~ '^INV-[0-9]{4,8}$'),
  tax_year integer not null check (tax_year between 2000 and 2100),
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'void')),
  lines jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) <= 30),
  total_cents integer not null check (total_cents between 0 and 100000000),
  paid_cents integer not null default 0 check (paid_cents between 0 and 100000000),
  issued_on date not null default current_date,
  due_on date,
  paid_on date,
  notes text check (notes is null or length(notes) <= 1000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists invoices_number_key on public.invoices (tenant_id, number);
create index if not exists invoices_status_idx on public.invoices (tenant_id, status, tax_year);
create index if not exists invoices_client_idx on public.invoices (tenant_id, client_id);

create table if not exists public.payment_imports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  file_name text not null check (length(file_name) between 1 and 200),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  row_count integer not null default 0,
  status text not null default 'review' check (status in ('review', 'applied', 'discarded')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);
create index if not exists payment_imports_recent_idx on public.payment_imports (tenant_id, created_at desc);

create table if not exists public.payment_import_rows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  import_id uuid not null references public.payment_imports(id) on delete cascade,
  row_no integer not null,
  posted_on date,
  description text not null default '' check (length(description) <= 500),
  amount_cents integer not null check (amount_cents between 0 and 100000000),
  tax_year integer check (tax_year is null or tax_year between 2000 and 2100),
  ssn_last4 text check (ssn_last4 is null or ssn_last4 ~ '^[0-9]{4}$'),
  name_guess text check (name_guess is null or length(name_guess) <= 200),
  invoice_id uuid references public.invoices(id) on delete set null,
  match text not null default 'none' check (match in ('exact', 'possible', 'manual', 'none')),
  status text not null default 'pending' check (status in ('pending', 'ignored', 'applied')),
  created_at timestamptz not null default now()
);
create index if not exists payment_import_rows_import_idx on public.payment_import_rows (tenant_id, import_id, row_no);

create or replace function public.workspace_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
create or replace trigger clients_touch before update on public.clients for each row execute function public.workspace_touch();
create or replace trigger client_returns_touch before update on public.client_returns for each row execute function public.workspace_touch();
create or replace trigger invoices_touch before update on public.invoices for each row execute function public.workspace_touch();

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['clients', 'client_returns', 'client_docs', 'client_messages', 'client_tasks', 'client_notes', 'invoices', 'payment_imports', 'payment_import_rows'];
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
create unique index if not exists clients_tenant_id_id_key on public.clients (tenant_id, id);
create unique index if not exists client_returns_tenant_id_id_key on public.client_returns (tenant_id, id);
create unique index if not exists invoices_tenant_id_id_key on public.invoices (tenant_id, id);
create unique index if not exists payment_imports_tenant_id_id_key on public.payment_imports (tenant_id, id);
do $$
declare
  k record;
begin
  for k in select * from (values
    ('client_returns', 'client_id', 'clients'),
    ('client_returns', 'parent_id', 'client_returns'),
    ('client_docs', 'client_id', 'clients'),
    ('client_docs', 'return_id', 'client_returns'),
    ('client_messages', 'client_id', 'clients'),
    ('client_tasks', 'client_id', 'clients'),
    ('client_tasks', 'return_id', 'client_returns'),
    ('client_notes', 'client_id', 'clients'),
    ('invoices', 'client_id', 'clients'),
    ('invoices', 'return_id', 'client_returns'),
    ('payment_import_rows', 'import_id', 'payment_imports'),
    ('payment_import_rows', 'invoice_id', 'invoices')
  ) as v(child, col, parent) loop
    if not exists (select 1 from pg_constraint where conname = k.child || '_' || k.col || '_same_tenant') then
      execute format('alter table public.%I add constraint %I foreign key (tenant_id, %I) references public.%I (tenant_id, id)',
        k.child, k.child || '_' || k.col || '_same_tenant', k.col, k.parent);
    end if;
  end loop;
end $$;
