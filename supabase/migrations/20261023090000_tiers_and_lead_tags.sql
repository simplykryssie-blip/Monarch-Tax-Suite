-- Role-based navigation and lead tags.
--  * tenants.tier: which of the three purchase tiers an account has. ptin = My Workspace only; ero = adds the ERO
--    Dashboard; bureau = adds My Service Bureau (and the store, leads and operations tools). Existing accounts
--    (including Monarch itself) default to bureau, so nothing disappears for anyone today.
--  * leads.tags: free-form, user-defined labels on a lead (lower case, up to 12 per lead, 40 characters each).
-- Add-only: no table is dropped, no data is rewritten.

set local lock_timeout = '10s';

alter table public.tenants add column if not exists tier text not null default 'bureau';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenants_tier_check') then
    alter table public.tenants add constraint tenants_tier_check check (tier in ('ptin', 'ero', 'bureau'));
  end if;
end $$;

alter table public.leads add column if not exists tags text[] not null default '{}';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leads_tags_check') then
    alter table public.leads add constraint leads_tags_check check (cardinality(tags) <= 12 and array_position(tags, null) is null);
  end if;
end $$;
create index if not exists leads_tags_idx on public.leads using gin (tags);
