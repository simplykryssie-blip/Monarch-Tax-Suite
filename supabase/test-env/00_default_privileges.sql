-- TEST ENVIRONMENT ONLY.
--
-- Why this file exists: the Monarch migrations create tables without explicit
-- grants to service_role (the key the server uses). Production works because
-- Supabase's historical platform default automatically grants new public tables,
-- functions and sequences to anon, authenticated and service_role (confirmed in
-- production's pg_default_acl). Supabase's docs say new projects are moving to
-- "revoke by default". On such a project the app would fail with
-- "permission denied for table ..." even though the schema is identical.
--
-- This reproduces the production defaults BEFORE the migrations run, so the
-- migrations (including their explicit revokes on sensitive tables) end up with
-- the same permissions production has. On a project that already has the old
-- default it changes nothing.
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
