-- Forms sent to a client: a personal link, the submission tied to the client, and the finished PDF saved in the client's files.
-- Additive only: one new table and two new nullable columns. Nothing is dropped and no existing value is changed. Safe to run again.
--
-- form_invites                    one row per form sent to a client: the form, the client, a hash of the personal link (the link
--                                 itself is never stored), when it expires, when it was opened, and which submission answered it.
-- form_submissions.client_id      the client a submission came from, when it came through a personal link.
-- client_docs.form_submission_id  the submission a saved PDF belongs to, so it is saved to the client's files once.

set local lock_timeout = '10s';

alter table public.form_submissions add column if not exists client_id uuid;
alter table public.client_docs add column if not exists form_submission_id uuid;

create table if not exists public.form_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  form_id uuid not null,
  client_id uuid not null,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  sent_to text check (sent_to is null or length(sent_to) <= 254),
  expires_at timestamptz not null,
  opened_at timestamptz,
  submission_id uuid,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists form_invites_token_key on public.form_invites (token_hash);
create index if not exists form_invites_client_idx on public.form_invites (tenant_id, client_id, created_at desc);

-- Tenant scoping, the same as every tenant table since Step 0.
do $$
declare
  t text;
  tenant_tables text[] := array['form_invites'];
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
end $$;

-- Same-tenant references: an invite is for a form and a client of its own workspace, a submission can come from a client of its
-- workspace, and a saved PDF points at a submission of its workspace.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'form_invites_form_id_same_tenant') then
    alter table public.form_invites add constraint form_invites_form_id_same_tenant foreign key (tenant_id, form_id) references public.forms (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'form_invites_client_id_same_tenant') then
    alter table public.form_invites add constraint form_invites_client_id_same_tenant foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'form_invites_submission_id_same_tenant') then
    alter table public.form_invites add constraint form_invites_submission_id_same_tenant foreign key (tenant_id, submission_id) references public.form_submissions (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'form_submissions_client_id_same_tenant') then
    alter table public.form_submissions add constraint form_submissions_client_id_same_tenant foreign key (tenant_id, client_id) references public.clients (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'client_docs_form_submission_id_same_tenant') then
    alter table public.client_docs add constraint client_docs_form_submission_id_same_tenant foreign key (tenant_id, form_submission_id) references public.form_submissions (tenant_id, id);
  end if;
end $$;
