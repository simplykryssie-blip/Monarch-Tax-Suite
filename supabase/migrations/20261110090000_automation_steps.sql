-- Phase 5b: workflows with branches and waits (additive).
--
-- automation_workflows.steps          the step tree (actions, waits, if/else branches). Null for a workflow made before
--                                     this change: its `actions` list is read as the steps. `actions` keeps a flat copy of
--                                     the action steps so "which templates are in use" keeps working.
-- automation_workflows.trigger_config settings for a trigger that needs them (date-based: days before or after).
-- automation_events.subject_*         what an event is about, by id (an appointment, lead, client, invoice or return).
--                                     Names, emails and phone numbers are looked up when a step runs, never stored here.
-- automation_executions.pc            the next step to run, so a run that waits or retries carries on where it stopped.
-- automation_executions 'waiting'     a run suspended until next_attempt_at (a wait step).
-- clients.tags                        tags on clients, like leads have.
-- automation_tasks                    tasks created by a workflow step, for staff to work through.
--
-- Same tenant rules as every table since Step 0.

alter table public.automation_workflows add column if not exists steps jsonb check (steps is null or jsonb_typeof(steps) = 'array');
alter table public.automation_workflows add column if not exists trigger_config jsonb not null default '{}'::jsonb check (jsonb_typeof(trigger_config) = 'object');

alter table public.automation_events add column if not exists subject_type text check (subject_type is null or subject_type in ('appointment', 'lead', 'client', 'invoice', 'return'));
alter table public.automation_events add column if not exists subject_id uuid;
create index if not exists automation_events_subject_idx on public.automation_events (tenant_id, subject_type, subject_id) where subject_id is not null;

alter table public.automation_executions add column if not exists pc integer not null default 0 check (pc >= 0 and pc <= 200);
alter table public.automation_executions drop constraint if exists automation_executions_status_check;
alter table public.automation_executions add constraint automation_executions_status_check check (status in ('queued', 'running', 'retrying', 'waiting', 'succeeded', 'failed', 'skipped'));
drop index if exists public.automation_executions_due_idx;
create index if not exists automation_executions_due_idx on public.automation_executions (next_attempt_at) where status in ('queued', 'retrying', 'waiting');
create unique index if not exists automation_executions_tenant_id_id_key on public.automation_executions (tenant_id, id);

alter table public.clients add column if not exists tags text[] not null default '{}';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_tags_check') then
    alter table public.clients add constraint clients_tags_check check (cardinality(tags) <= 12 and array_position(tags, null) is null);
  end if;
end $$;

create table if not exists public.automation_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  title text not null check (length(title) between 1 and 200),
  due_on date,
  done_at timestamptz,
  contact_name text check (contact_name is null or length(contact_name) <= 200),
  contact_email text check (contact_email is null or length(contact_email) <= 254),
  client_id uuid,
  lead_id uuid,
  execution_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists automation_tasks_open_idx on public.automation_tasks (tenant_id, due_on) where done_at is null;
-- A workflow makes a given task once, even if the step is retried.
create unique index if not exists automation_tasks_once on public.automation_tasks (execution_id, title) where execution_id is not null;

do $$
declare
  t text;
  k record;
  tenant_tables text[] := array['automation_tasks'];
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

  -- A task can only point at its own tenant's client, lead and workflow run.
  for k in select * from (values
    ('automation_tasks', 'client_id', 'clients'),
    ('automation_tasks', 'lead_id', 'leads'),
    ('automation_tasks', 'execution_id', 'automation_executions')
  ) as v(child, col, parent) loop
    if not exists (select 1 from pg_constraint where conname = k.child || '_' || k.col || '_same_tenant') then
      execute format('alter table public.%I add constraint %I foreign key (tenant_id, %I) references public.%I (tenant_id, id)',
        k.child, k.child || '_' || k.col || '_same_tenant', k.col, k.parent);
    end if;
  end loop;
end $$;
