-- Leads can come from the WISP builder (someone who filled in the first step but hasn't paid).
-- Replaces the source check on leads with one that also allows 'wisp_builder'. No rows change.

set local lock_timeout = '10s';

alter table public.leads drop constraint if exists leads_source_check;
alter table public.leads add constraint leads_source_check
  check (source in ('wisp_audit', 'wisp_builder', 'facebook_group', 'referral', 'website', 'manual', 'other'));
