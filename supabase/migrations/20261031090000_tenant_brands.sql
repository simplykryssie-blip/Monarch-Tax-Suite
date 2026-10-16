-- White-label branding per tenant (account). The platform is Verexa HQ; each tenant can put its own name, logo and
-- colours on what its customers see (emails, forms, documents), and optionally on its own admin and sign-in page.
--
-- tenant_brands   one row per tenant. Names, colours and image addresses only: no secrets.
--
-- Tenant scoped from day one: tenant_id from the session, row-level security, one row per tenant.

create table if not exists public.tenant_brands (
  tenant_id uuid not null default public.require_tenant_id() primary key references public.tenants (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  tagline text check (tagline is null or length(tagline) <= 120),
  logo_url text check (logo_url is null or (length(logo_url) <= 600 and logo_url ~ '^(https://|/)[^[:space:]"''()<>\\]+$')),
  mark_url text check (mark_url is null or (length(mark_url) <= 600 and mark_url ~ '^(https://|/)[^[:space:]"''()<>\\]+$')),
  primary_color text check (primary_color is null or primary_color ~ '^#[0-9a-f]{6}$'),
  accent_color text check (accent_color is null or accent_color ~ '^#[0-9a-f]{6}$'),
  sidebar_color text check (sidebar_color is null or sidebar_color ~ '^#[0-9a-f]{6}$'),
  support_email text check (support_email is null or (length(support_email) <= 254 and support_email = lower(support_email))),
  -- Show the tenant's brand instead of Verexa HQ in its own admin and sign-in page.
  white_label_admin boolean not null default false,
  -- Show a small "Powered by Verexa HQ" on pages its customers see. Off: customers only ever see the tenant.
  show_powered_by boolean not null default false,
  -- The tenant's own address for sign-in (for example app.yourfirm.com), so its sign-in page can show its brand.
  app_host text check (app_host is null or (length(app_host) <= 253 and app_host = lower(app_host))),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists tenant_brands_app_host_key on public.tenant_brands (app_host) where app_host is not null;

do $$
declare
  t text;
  tenant_tables text[] := array['tenant_brands'];
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

-- Monarch Tax Suite, tenant #1, keeps the brand it has always had.
insert into public.tenant_brands (tenant_id, name, tagline, logo_url, mark_url, primary_color, accent_color, sidebar_color, white_label_admin, show_powered_by)
values ('00000000-0000-4000-8000-000000000001', 'Monarch Tax Suite', 'Software · Tools · Training · Growth', '/brand/logo.png', '/brand/mark.png', '#b8902f', '#171714', '#0b0b0a', false, false)
on conflict (tenant_id) do nothing;
