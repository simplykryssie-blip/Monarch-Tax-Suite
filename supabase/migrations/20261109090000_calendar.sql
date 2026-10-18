-- Phase 5a: the calendar (additive).
--
-- appointment_types     what can be booked: name, length, buffers before and after, how far ahead and how soon, a short
--                       link name for the public booking page, reminder hours. Each type belongs to one staff member or,
--                       with no assignee, to the office.
-- availability_rules    when bookings are possible. Weekly rows (weekday + times) and date rows (one day: other hours,
--                       or closed). With no rows at all the office's business hours are used. Federal holidays and
--                       closures from Business hours always block booking.
-- appointments          one booking. Start and end are stored in UTC with both time zones, the person it is for (matched
--                       to a client or lead), the text-message consent given at booking and a hashed link token for the
--                       client to cancel or reschedule. Two booked appointments for the same staff member can't overlap,
--                       buffers included: the database enforces it, so two people clicking the same slot can't both win.
-- appointment_reminders reminders due, one per channel and time; the 5-minute scheduler sends them.
--
-- Same tenant rules as every table since Step 0: tenant_id with the required default, the two policies, and
-- same-tenant foreign keys.

create extension if not exists btree_gist with schema extensions;

create table if not exists public.appointment_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  slug text not null check (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  name text not null check (length(name) between 1 and 120),
  description text check (description is null or length(description) <= 2000),
  location text check (location is null or length(location) <= 300),
  duration_minutes integer not null check (duration_minutes between 5 and 480),
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes between 0 and 120),
  buffer_after_minutes integer not null default 0 check (buffer_after_minutes between 0 and 120),
  step_minutes integer not null default 30 check (step_minutes between 5 and 240),
  min_notice_minutes integer not null default 120 check (min_notice_minutes between 0 and 43200),
  max_days_ahead integer not null default 60 check (max_days_ahead between 1 and 365),
  reminder_hours integer[] not null default '{24}' check (cardinality(reminder_hours) <= 3 and 1 <= all(reminder_hours) and 336 >= all(reminder_hours)),
  assignee_id uuid references auth.users(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists appointment_types_slug_key on public.appointment_types (tenant_id, slug);

create table if not exists public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  assignee_id uuid references auth.users(id) on delete cascade,
  weekday smallint check (weekday is null or weekday between 0 and 6),
  on_date date,
  closed boolean not null default false,
  start_time time,
  end_time time,
  created_at timestamptz not null default now(),
  check ((weekday is null) <> (on_date is null)),
  check (closed = (start_time is null and end_time is null)),
  check (closed or (start_time is not null and end_time is not null and start_time < end_time)),
  check (weekday is null or not closed)
);
create index if not exists availability_rules_lookup_idx on public.availability_rules (tenant_id, assignee_id, weekday, on_date);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  type_id uuid not null,
  assignee_id uuid references auth.users(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  block_start timestamptz not null,
  block_end timestamptz not null,
  office_time_zone text not null check (length(office_time_zone) between 3 and 64),
  client_time_zone text check (client_time_zone is null or length(client_time_zone) between 3 and 64),
  status text not null default 'booked' check (status in ('booked', 'cancelled', 'no_show', 'done')),
  source text not null default 'public' check (source in ('public', 'staff')),
  contact_name text not null check (length(contact_name) between 1 and 200),
  contact_email text not null check (length(contact_email) between 3 and 254 and contact_email = lower(contact_email)),
  contact_phone text check (contact_phone is null or length(contact_phone) <= 40),
  client_id uuid,
  lead_id uuid,
  sms_consent boolean not null default false,
  sms_consent_at timestamptz,
  notes text check (notes is null or length(notes) <= 2000),
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 300),
  cancelled_at timestamptz,
  manage_token_hash text check (manage_token_hash is null or manage_token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (block_start <= starts_at and block_end >= ends_at),
  check (sms_consent = (sms_consent_at is not null))
);
create unique index if not exists appointments_manage_token_key on public.appointments (manage_token_hash) where manage_token_hash is not null;
create index if not exists appointments_when_idx on public.appointments (tenant_id, starts_at);
create index if not exists appointments_contact_idx on public.appointments (tenant_id, contact_email);
-- No two booked appointments for the same staff member (or the office, with no assignee) overlap, buffers included.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'appointments_no_overlap') then
    alter table public.appointments add constraint appointments_no_overlap
      exclude using gist (tenant_id with =, (coalesce(assignee_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =, tstzrange(block_start, block_end) with &&)
      where (status = 'booked');
  end if;
end $$;

create table if not exists public.appointment_reminders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  appointment_id uuid not null,
  channel text not null check (channel in ('email', 'sms')),
  send_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  sent_at timestamptz,
  detail text check (detail is null or length(detail) <= 300),
  created_at timestamptz not null default now()
);
create unique index if not exists appointment_reminders_once_key on public.appointment_reminders (appointment_id, channel, send_at);
create index if not exists appointment_reminders_due_idx on public.appointment_reminders (tenant_id, send_at) where status = 'pending';

create or replace function public.calendar_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
create or replace trigger appointment_types_touch before update on public.appointment_types for each row execute function public.calendar_touch();
create or replace trigger appointments_touch before update on public.appointments for each row execute function public.calendar_touch();

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  k record;
  tenant_tables text[] := array['appointment_types', 'availability_rules', 'appointments', 'appointment_reminders'];
begin
  foreach t in array tenant_tables loop
    execute format('alter table public.%I alter column tenant_id set default public.require_tenant_id()', t);
    execute format('create index if not exists %I on public.%I (tenant_id)', t || '_tenant_idx', t);
    execute format('create unique index if not exists %I on public.%I (tenant_id, id)', t || '_tenant_id_id_key', t);
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

  -- A booking can only point at its own tenant's type, client and lead.
  for k in select * from (values
    ('appointments', 'type_id', 'appointment_types'),
    ('appointments', 'client_id', 'clients'),
    ('appointments', 'lead_id', 'leads'),
    ('appointment_reminders', 'appointment_id', 'appointments')
  ) as v(child, col, parent) loop
    if not exists (select 1 from pg_constraint where conname = k.child || '_' || k.col || '_same_tenant') then
      execute format('alter table public.%I add constraint %I foreign key (tenant_id, %I) references public.%I (tenant_id, id)%s',
        k.child, k.child || '_' || k.col || '_same_tenant', k.col, k.parent,
        case when k.child = 'appointment_reminders' then ' on delete cascade' else '' end);
    end if;
  end loop;
end $$;
