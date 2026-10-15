-- Round 2, Automations: pipelines (the stages a piece of work moves through, built visually) and SMS templates
-- (plain text, saved for when text messaging is connected). Both belong to one tenant from day one.
--
-- pipelines      a named, ordered list of stages. kind 'returns' drives the My Work board; the default returns
--                pipeline is the one the board uses. stages is a jsonb array of {id, name, color, done}.
-- sms_templates  a short plain-text message with {{placeholders}}.

create table if not exists public.pipelines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null check (length(name) between 2 and 80),
  kind text not null default 'custom' check (kind in ('returns', 'custom')),
  stages jsonb not null default '[]'::jsonb check (jsonb_typeof(stages) = 'array' and jsonb_array_length(stages) between 2 and 15),
  is_default boolean not null default false,
  archived_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pipelines_tenant_kind_idx on public.pipelines (tenant_id, kind) where archived_at is null;
-- At most one default pipeline per kind per tenant.
create unique index if not exists pipelines_one_default_key on public.pipelines (tenant_id, kind) where is_default and archived_at is null;

create table if not exists public.sms_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null check (length(name) between 2 and 120),
  body text not null check (length(body) between 1 and 480),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sms_templates_tenant_idx2 on public.sms_templates (tenant_id, name);

create or replace function public.round2_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
create or replace trigger pipelines_touch before update on public.pipelines for each row execute function public.round2_touch();
create or replace trigger sms_templates_touch before update on public.sms_templates for each row execute function public.round2_touch();

do $$
declare
  t text;
  tenant_tables text[] := array['pipelines', 'sms_templates'];
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

create unique index if not exists pipelines_tenant_id_id_key on public.pipelines (tenant_id, id);
create unique index if not exists sms_templates_tenant_id_id_key on public.sms_templates (tenant_id, id);
