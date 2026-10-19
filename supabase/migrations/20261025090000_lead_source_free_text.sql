-- A lead's source is now a label set automatically by how the lead arrived (a form's name, "Manual", a funnel,
-- a page, an import's name, the WISP audit or builder) and can be edited afterwards. Replaces the fixed list on
-- leads.source with a length check. Existing values (wisp_audit, manual, ...) stay as they are.

set local lock_timeout = '10s';

alter table public.leads drop constraint if exists leads_source_check;
alter table public.leads add constraint leads_source_check check (length(source) between 1 and 120);
