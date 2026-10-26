-- Billing: archive voided invoices. An archived invoice leaves the Billing list and the client's list but is kept, and can be
-- restored. Only a voided invoice can be archived (enforced by the app).
-- Additive only: one new column on invoices. Nothing is dropped and no existing value is changed. Safe to run again.
--
-- invoices.archived_at   when the invoice was archived; empty = shown as usual.

set local lock_timeout = '10s';

alter table public.invoices add column if not exists archived_at timestamptz;
create index if not exists invoices_archived_idx on public.invoices (tenant_id, archived_at) where archived_at is not null;
