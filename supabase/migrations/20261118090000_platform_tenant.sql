-- Verexa HQ (platform): the platform's own record.
--
-- Platform administrators' actions are written to workspace_audit_events (append-only, tenant_id on every row). An action
-- that targets one workspace is recorded against that workspace. An action that targets no workspace (running billing
-- setup, for example) needs a tenant of its own to belong to, so the platform gets one, seeded with a fixed id the same
-- way Monarch Tax Suite is tenant #1.
--
-- It is not a workspace: it has no members, no subscription, no billing, and the workspace list and the schedulers skip it.
-- Nothing else changes. Safe to run again.

set local lock_timeout = '10s';

insert into public.tenants (id, slug, name, tier)
values ('00000000-0000-4000-8000-000000000002', 'verexa-hq-platform', 'Verexa HQ (platform)', 'bureau')
on conflict (id) do nothing;
