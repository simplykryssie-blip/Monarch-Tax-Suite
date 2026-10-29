-- Staff assignment on leads: the teammate a lead is assigned to (clients already have an owner, clients.owner_id).
-- Additive only. A lead with no one assigned is null. If the teammate's account is removed the lead simply becomes unassigned.
-- The existing tenant policies on leads already cover the new column.

alter table public.leads add column if not exists assigned_to uuid references auth.users(id) on delete set null;
create index if not exists leads_assigned_idx on public.leads (tenant_id, assigned_to);
