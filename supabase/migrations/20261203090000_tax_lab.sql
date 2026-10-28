-- Monarch Tax Lab: tax-preparer training sold as licenses from the Monarch store. Additive only: five new tables.
-- Nothing is dropped and no existing table or value is changed. Safe to run again.
--
-- A training license is an ordinary calculator_licenses row (bought through the storefront, key issued in the CRM).
-- The buyer activates the key at /lab/activate, which records the license's training terms below.
--
-- lab_license_terms   one row per activated training license: instructor or student license, how many student seats,
--                     who activated it, and when access ends.
-- lab_members         the people who use a license: the instructor (or individual student) who activated it, and the
--                     students an instructor invited. An invited student holds a seat; only the invite token's hash is
--                     stored.
-- lab_scenarios       practice client scenarios. license_id null = the Monarch library every licensee sees; otherwise
--                     a private scenario an instructor wrote for their class.
-- lab_answer_keys     the correct return for a scenario. Read only by server code: students never receive it, and
--                     their returns are checked on the server.
-- lab_work            one row per student per scenario: the return and intake sheet in progress, the copy submitted for
--                     review, and the instructor's grade.

set local lock_timeout = '10s';

create table if not exists public.lab_license_terms (
  license_id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  kind text not null check (kind in ('instructor', 'student')),
  seats integer not null default 0 check (seats between 0 and 1000),
  activated_by uuid references auth.users(id) on delete set null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > starts_at)
);

create table if not exists public.lab_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  license_id uuid not null,
  user_id uuid references auth.users(id) on delete cascade,
  email text not null check (length(email) between 3 and 254),
  display_name text check (display_name is null or length(display_name) <= 120),
  role text not null check (role in ('instructor', 'student')),
  status text not null default 'invited' check (status in ('invited', 'active', 'removed')),
  invite_token_hash text check (invite_token_hash is null or invite_token_hash ~ '^[0-9a-f]{64}$'),
  invite_expires_at timestamptz,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists lab_members_invite_token on public.lab_members (invite_token_hash) where invite_token_hash is not null;
create unique index if not exists lab_members_license_user on public.lab_members (license_id, user_id) where user_id is not null and status <> 'removed';
create unique index if not exists lab_members_license_email on public.lab_members (license_id, lower(email)) where status <> 'removed';
create index if not exists lab_members_user_idx on public.lab_members (user_id) where user_id is not null;

create table if not exists public.lab_scenarios (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  license_id uuid,
  tax_year integer not null default 2026 check (tax_year between 2024 and 2100),
  status text not null default 'draft' check (status in ('draft', 'published')),
  title text not null check (length(title) between 1 and 160),
  level text not null default 'Beginner' check (level in ('Beginner', 'Intermediate', 'Advanced')),
  summary text check (summary is null or length(summary) <= 300),
  narrative text not null default '' check (length(narrative) <= 20000),
  facts jsonb not null default '[]'::jsonb check (jsonb_typeof(facts) = 'array'),
  intake_mode text not null default 'notes' check (intake_mode in ('notes', 'interview')),
  doc_options jsonb not null default '{}'::jsonb check (jsonb_typeof(doc_options) = 'object'),
  documents jsonb not null default '{}'::jsonb check (jsonb_typeof(documents) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lab_scenarios_license_idx on public.lab_scenarios (license_id);

create table if not exists public.lab_answer_keys (
  scenario_id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  ret jsonb not null check (jsonb_typeof(ret) = 'object'),
  line_values jsonb not null check (jsonb_typeof(line_values) = 'object'),
  overrides jsonb not null default '{}'::jsonb check (jsonb_typeof(overrides) = 'object'),
  checks text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.lab_work (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  member_id uuid not null,
  scenario_id uuid not null,
  ret jsonb not null default '{}'::jsonb check (jsonb_typeof(ret) = 'object'),
  intake jsonb not null default '{}'::jsonb check (jsonb_typeof(intake) = 'object'),
  checks_run integer not null default 0 check (checks_run >= 0),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'graded')),
  submitted_ret jsonb check (submitted_ret is null or jsonb_typeof(submitted_ret) = 'object'),
  submitted_intake jsonb check (submitted_intake is null or jsonb_typeof(submitted_intake) = 'object'),
  note text check (note is null or length(note) <= 2000),
  correct integer,
  total integer,
  efile_rejects integer,
  submitted_at timestamptz,
  grade text check (grade is null or grade in ('pass', 'revise')),
  score text check (score is null or length(score) <= 20),
  feedback text check (feedback is null or length(feedback) <= 4000),
  graded_by uuid references auth.users(id) on delete set null,
  graded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists lab_work_member_scenario on public.lab_work (member_id, scenario_id);
create index if not exists lab_work_scenario_idx on public.lab_work (scenario_id);

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['lab_license_terms', 'lab_members', 'lab_scenarios', 'lab_answer_keys', 'lab_work'];
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

-- Rows point only at rows of their own tenant, and go when what they belong to goes.
create unique index if not exists lab_members_tenant_id_id_key on public.lab_members (tenant_id, id);
create unique index if not exists lab_scenarios_tenant_id_id_key on public.lab_scenarios (tenant_id, id);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lab_license_terms_license_same_tenant') then
    alter table public.lab_license_terms add constraint lab_license_terms_license_same_tenant foreign key (tenant_id, license_id) references public.calculator_licenses (tenant_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lab_members_license_same_tenant') then
    alter table public.lab_members add constraint lab_members_license_same_tenant foreign key (tenant_id, license_id) references public.calculator_licenses (tenant_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lab_scenarios_license_same_tenant') then
    alter table public.lab_scenarios add constraint lab_scenarios_license_same_tenant foreign key (tenant_id, license_id) references public.calculator_licenses (tenant_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lab_answer_keys_scenario_same_tenant') then
    alter table public.lab_answer_keys add constraint lab_answer_keys_scenario_same_tenant foreign key (tenant_id, scenario_id) references public.lab_scenarios (tenant_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lab_work_member_same_tenant') then
    alter table public.lab_work add constraint lab_work_member_same_tenant foreign key (tenant_id, member_id) references public.lab_members (tenant_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lab_work_scenario_same_tenant') then
    alter table public.lab_work add constraint lab_work_scenario_same_tenant foreign key (tenant_id, scenario_id) references public.lab_scenarios (tenant_id, id) on delete cascade;
  end if;
end $$;
