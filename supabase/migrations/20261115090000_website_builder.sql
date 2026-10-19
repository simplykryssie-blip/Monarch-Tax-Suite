-- Phase 5d: the website builder (additive).
--
-- sites         one website per office (tenant). A blank canvas: no preset templates. `slug` is the office's default
--               address label: <slug>.<platform domain>. `status` is 'published' while the site is live.
-- site_pages    the pages of a site. Each page keeps a DRAFT (what the office is editing) and a PUBLISHED copy (what
--               visitors see); publishing copies every draft over its published copy in one statement. Content is a
--               validated list of blocks (text, image, button, booking, form, section); there is no custom HTML or
--               script, so a site can never run code on the platform's origin.
-- site_domains  the addresses a site answers on: its default subdomain, and any custom domain the office connects
--               (added to the hosting project through the Vercel API; DNS records are shown to the office).
-- site_publish / site_unpublish  publish or take down a whole site atomically.
--
-- Same tenant rules as every table since Step 0: tenant_id with the required default, the two policies, and
-- same-tenant foreign keys. The public renderer finds a site by hostname with one logged platform lookup
-- (site_domains) and from then on acts as that tenant.

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null check (length(name) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$'),
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One site per office; each default address label belongs to one office.
create unique index if not exists sites_tenant_key on public.sites (tenant_id);
create unique index if not exists sites_slug_key on public.sites (slug);
create unique index if not exists sites_tenant_id_id_key on public.sites (tenant_id, id);

create table if not exists public.site_pages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  site_id uuid not null,
  slug text not null check (slug = '' or slug ~ '^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$'),
  title text not null check (length(title) between 1 and 120),
  description text check (description is null or length(description) <= 300),
  is_home boolean not null default false,
  show_in_nav boolean not null default true,
  position integer not null default 0 check (position between 0 and 1000),
  draft jsonb not null default '[]'::jsonb check (jsonb_typeof(draft) = 'array' and jsonb_array_length(draft) <= 60),
  published jsonb check (published is null or (jsonb_typeof(published) = 'array' and jsonb_array_length(published) <= 60)),
  published_title text check (published_title is null or length(published_title) between 1 and 120),
  published_description text check (published_description is null or length(published_description) <= 300),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The home page has the empty slug; every other page has its own.
  check ((is_home and slug = '') or (not is_home and slug <> ''))
);
create unique index if not exists site_pages_slug_key on public.site_pages (site_id, slug);
create unique index if not exists site_pages_one_home on public.site_pages (site_id) where is_home;
create index if not exists site_pages_site_idx on public.site_pages (tenant_id, site_id, position);

create table if not exists public.site_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  site_id uuid not null,
  hostname text not null check (hostname = lower(hostname) and length(hostname) between 4 and 253 and hostname ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'),
  kind text not null check (kind in ('subdomain', 'custom')),
  status text not null default 'pending' check (status in ('pending', 'active', 'error')),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  last_checked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
-- A hostname answers for one site in the whole platform.
create unique index if not exists site_domains_hostname_key on public.site_domains (hostname);
-- A site has one default subdomain.
create unique index if not exists site_domains_one_subdomain on public.site_domains (site_id) where kind = 'subdomain';
create index if not exists site_domains_site_idx on public.site_domains (tenant_id, site_id);

create or replace function public.sites_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
create or replace trigger sites_touch before update on public.sites for each row execute function public.sites_touch();
create or replace trigger site_pages_touch before update on public.site_pages for each row execute function public.sites_touch();

do $$
declare
  t text;
  tenant_tables text[] := array['sites', 'site_pages', 'site_domains'];
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

  -- A page and a domain can only belong to a site of the same tenant.
  if not exists (select 1 from pg_constraint where conname = 'site_pages_site_id_same_tenant') then
    alter table public.site_pages add constraint site_pages_site_id_same_tenant foreign key (tenant_id, site_id) references public.sites (tenant_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'site_domains_site_id_same_tenant') then
    alter table public.site_domains add constraint site_domains_site_id_same_tenant foreign key (tenant_id, site_id) references public.sites (tenant_id, id) on delete cascade;
  end if;
end $$;

-- Publishes the whole site in one statement: every page's draft becomes its published copy. Returns how many pages.
create or replace function public.site_publish(p_site uuid) returns integer
language plpgsql set search_path = public as $$
declare
  n integer;
begin
  update public.site_pages
     set published = draft, published_title = title, published_description = description, published_at = now()
   where site_id = p_site;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'SITE_EMPTY: a site needs at least one page before it can be published';
  end if;
  update public.sites set status = 'published', published_at = now() where id = p_site;
  return n;
end $$;

create or replace function public.site_unpublish(p_site uuid) returns void
language sql set search_path = public as $$
  update public.sites set status = 'draft' where id = p_site;
$$;

revoke all on function public.site_publish(uuid), public.site_unpublish(uuid) from public, anon, authenticated;
grant execute on function public.site_publish(uuid), public.site_unpublish(uuid) to service_role, tenant_app;
