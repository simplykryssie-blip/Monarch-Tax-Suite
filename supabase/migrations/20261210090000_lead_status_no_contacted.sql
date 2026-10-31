-- Leads: the "Contacted" status is removed. A lead is New, Interested, Converted (made only by Convert to client) or Lost.
-- Existing leads that say Contacted become New. Their "Last contacted" date is kept, and their history is not touched.
-- Order matters: the rows are changed first so the narrower rule can be put back. Safe to run again.

set local lock_timeout = '10s';

update public.leads set status = 'new' where status = 'contacted';

alter table public.leads drop constraint if exists leads_status_check;
alter table public.leads add constraint leads_status_check check (status in ('new', 'interested', 'converted', 'lost'));
