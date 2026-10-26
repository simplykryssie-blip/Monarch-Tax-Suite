-- Websites: more than one website per workspace, each with its own settings, and search-engine (SEO) details for every page.
-- Additive except one index: the "one website per workspace" rule is removed (the rule that every web address is used by one
-- website stays). No existing website, page or domain changes; every existing website keeps its pages and addresses and gets
-- empty settings (which look exactly as it does today). Safe to run again.
--
-- sites.settings            the website's look and details, kept as a draft until published: colors, fonts, logo, header, footer,
--                           contact details, hours, social links and the website-wide search details.
-- sites.published_settings  the copy visitors see (set when the website is published).
-- site_pages.seo            a page's search details as a draft: title, picture for sharing, and whether to keep it out of search.
-- site_pages.published_seo  the copy visitors see.

set local lock_timeout = '10s';

drop index if exists public.sites_tenant_key;

alter table public.sites add column if not exists settings jsonb not null default '{}'::jsonb;
alter table public.sites add column if not exists published_settings jsonb;
alter table public.site_pages add column if not exists seo jsonb not null default '{}'::jsonb;
alter table public.site_pages add column if not exists published_seo jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sites_settings_is_object') then
    alter table public.sites add constraint sites_settings_is_object check (jsonb_typeof(settings) = 'object' and (published_settings is null or jsonb_typeof(published_settings) = 'object'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'site_pages_seo_is_object') then
    alter table public.site_pages add constraint site_pages_seo_is_object check (jsonb_typeof(seo) = 'object' and (published_seo is null or jsonb_typeof(published_seo) = 'object'));
  end if;
end $$;

-- Publishes the whole website in one statement: every page's draft becomes its published copy, and so do the website's settings.
create or replace function public.site_publish(p_site uuid) returns integer
language plpgsql set search_path = public as $$
declare
  n integer;
begin
  update public.site_pages
     set published = draft, published_title = title, published_description = description, published_seo = seo, published_at = now()
   where site_id = p_site;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'SITE_EMPTY: a site needs at least one page before it can be published';
  end if;
  update public.sites set status = 'published', published_at = now(), published_settings = settings where id = p_site;
  return n;
end $$;
