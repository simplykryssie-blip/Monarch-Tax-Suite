-- Phase 5.0 gate: business calendar and encrypted Social Security numbers. Run it in the SQL editor of the TEST project
-- after 20261107090000_business_calendar and 20261108090000_ssn_keyring. Two throwaway tenants and example.com data only.
-- It never commits: it ends by raising an exception carrying the results, so everything it did is rolled back. Every
-- line of the message should start with PASS.
--
-- Server requests are simulated as PostgREST runs them: SET LOCAL ROLE service_role, request.headers carrying
-- x-tenant-id, then public.pgrst_pre_request() (which switches to tenant_app for that tenant).
--
-- What this proves is the database's side: one tenant cannot see or write another's business hours, closures, data
-- key or encrypted numbers; a number cannot be attached to another tenant's client; the calendar's rules (dates in
-- order, closures under 62 days, one row per holiday per year) hold; each tenant has one data key; and signed-in
-- and anonymous users cannot read these tables. Encryption, owner-only reveal and rate limits are in the app and are
-- tested in tests/ssn.test.ts.

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a5';
  b uuid := '00000000-0000-4000-8000-0000000000b6';
  r text[] := '{}';
  n bigint;
  outcome text;
  b_client uuid; a_client uuid; b_closure uuid;
begin
  insert into public.tenants (id, slug, name, tier) values (a, 'gate-p50-a', 'Gate P5.0 Tenant A', 'ero'), (b, 'gate-p50-b', 'Gate P5.0 Tenant B', 'ero');

  -- ------------------------------------------------------------ seed tenant B (as the platform)
  insert into public.business_hours (tenant_id, week) values (b, '{"1":{"open":"08:00","close":"12:00"}}'::jsonb);
  insert into public.business_closures (tenant_id, source, holiday_key, holiday_year, name, start_date, end_date) values (b, 'federal', 'christmas', 2026, 'Christmas Day', '2026-12-25', '2026-12-25');
  insert into public.business_closures (tenant_id, source, name, start_date, end_date) values (b, 'custom', 'B retreat', '2026-11-02', '2026-11-03') returning id into b_closure;
  insert into public.clients (tenant_id, full_name) values (b, 'B Client') returning id into b_client;
  insert into public.tenant_data_keys (tenant_id, master_version, wrapped_key) values (b, 1, 's1:' || repeat('k', 60));
  insert into public.client_ssn (tenant_id, client_id, ciphertext) values (b, b_client, 's1:' || repeat('c', 60));
  insert into public.clients (tenant_id, full_name) values (a, 'A Client') returning id into a_client;

  -- ------------------------------------------------------------ as tenant A's server request
  set local role service_role;
  perform set_config('request.headers', json_build_object('x-tenant-id', a)::text, true);
  perform public.pgrst_pre_request();
  r := r || format('%s server request runs as tenant_app (%s)', case when current_user = 'tenant_app' then 'PASS' else 'FAIL' end, current_user);

  select count(*) into n from public.business_hours;
  r := r || format('%s business_hours: A sees none of B''s (%s)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.business_closures;
  r := r || format('%s business_closures: A sees none of B''s (%s)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.tenant_data_keys;
  r := r || format('%s tenant_data_keys: A sees none of B''s (%s)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.client_ssn;
  r := r || format('%s client_ssn: A sees none of B''s (%s)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  -- A's own rows, with tenant_id filled in by the database.
  insert into public.business_hours (week) values ('{"1":{"open":"09:00","close":"17:00"}}'::jsonb);
  insert into public.business_closures (source, holiday_key, holiday_year, name, start_date, end_date) values ('federal', 'christmas', 2026, 'Christmas Day', '2026-12-25', '2026-12-25');
  select count(*) into n from public.business_closures;
  r := r || format('%s A can write its own hours and closures; tenant_id is filled in (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);

  begin
    insert into public.business_closures (source, holiday_key, holiday_year, name, start_date, end_date) values ('federal', 'christmas', 2026, 'Again', '2026-12-25', '2026-12-25');
    outcome := 'allowed';
  exception when unique_violation then outcome := 'refused';
  end;
  r := r || format('%s the same holiday twice in one year is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  begin
    insert into public.business_closures (source, name, start_date, end_date) values ('custom', 'Backwards', '2026-11-05', '2026-11-01');
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s a closure that ends before it starts is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  begin
    insert into public.business_closures (source, name, start_date, end_date) values ('custom', 'Too long', '2026-01-01', '2026-03-31');
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s a closure of 62 days or more is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  begin
    insert into public.business_closures (source, name, start_date, end_date) values ('federal', 'No key', '2026-11-05', '2026-11-05');
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s a federal closure without a holiday key is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  begin
    insert into public.business_closures (tenant_id, source, name, start_date, end_date) values (b, 'custom', 'Planted', '2026-11-05', '2026-11-05');
    outcome := 'allowed';
  exception when others then outcome := 'refused';
  end;
  r := r || format('%s writing a closure into B is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  update public.business_closures set name = 'hijacked' where id = b_closure;
  get diagnostics n = row_count;
  r := r || format('%s A cannot change B''s closure (%s rows)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  delete from public.business_closures where id = b_closure;
  get diagnostics n = row_count;
  r := r || format('%s A cannot delete B''s closure (%s rows)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  -- Data key and encrypted numbers.
  insert into public.tenant_data_keys (master_version, wrapped_key) values (1, 's1:' || repeat('a', 60));
  begin
    insert into public.tenant_data_keys (master_version, wrapped_key) values (2, 's1:' || repeat('z', 60));
    outcome := 'allowed';
  exception when unique_violation then outcome := 'refused';
  end;
  r := r || format('%s a second data key for one tenant is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  insert into public.client_ssn (client_id, ciphertext) values (a_client, 's1:' || repeat('x', 60));
  select count(*) into n from public.client_ssn;
  r := r || format('%s A can store an encrypted number for its own client (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);

  begin
    insert into public.client_ssn (client_id, ciphertext) values (b_client, 's1:' || repeat('x', 60));
    outcome := 'allowed';
  exception when others then outcome := 'refused';
  end;
  r := r || format('%s an encrypted number cannot be attached to B''s client (%s)', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  begin
    insert into public.client_ssn (client_id, ciphertext) values (a_client, '123456789');
    outcome := 'allowed';
  exception when others then outcome := 'refused';
  end;
  r := r || format('%s plain text can''t be stored as a number (%s)', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  update public.tenant_data_keys set wrapped_key = 's1:' || repeat('h', 60) where tenant_id = b;
  get diagnostics n = row_count;
  r := r || format('%s A cannot change B''s data key (%s rows)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  delete from public.client_ssn where client_id = b_client;
  get diagnostics n = row_count;
  r := r || format('%s A cannot delete B''s encrypted number (%s rows)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  -- ------------------------------------------------------------ back as the platform: B is untouched
  reset role;
  select count(*) into n from public.business_closures where tenant_id = b and name in ('B retreat', 'Christmas Day');
  r := r || format('%s B''s closures are untouched (%s of 2)', case when n = 2 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.client_ssn where tenant_id = b and ciphertext = 's1:' || repeat('c', 60);
  select count(*) + n into n from public.tenant_data_keys where tenant_id = b and wrapped_key = 's1:' || repeat('k', 60);
  r := r || format('%s B''s data key and encrypted number are untouched (%s of 2)', case when n = 2 then 'PASS' else 'FAIL' end, n);

  -- A client's number goes with the client.
  delete from public.clients where id = a_client;
  select count(*) into n from public.client_ssn where tenant_id = a;
  r := r || format('%s deleting a client deletes its encrypted number (%s left)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  -- No foreign key leaves the tenant.
  select count(*) into n from pg_constraint c join pg_class t on t.oid = c.conrelid
    where t.relname = 'client_ssn' and c.contype = 'f' and c.conname <> 'client_ssn_client_id_same_tenant' and c.confrelid::regclass::text not in ('tenants', 'public.tenants', 'auth.users');
  r := r || format('%s client_ssn: no foreign key leaves the tenant (%s unexpected)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  select count(*) into n from unnest(array['business_hours', 'business_closures', 'tenant_data_keys', 'client_ssn']) t
    where has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'select');
  r := r || format('%s anon and signed-in users can''t read the new tables directly (%s open)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  select count(*) into n from unnest(array['business_hours', 'business_closures', 'tenant_data_keys', 'client_ssn']) t
    where not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass);
  r := r || format('%s row-level security is on for all four new tables (%s off)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  raise exception E'PHASE 5.0 GATE RESULTS (rolled back, nothing kept):\n%', array_to_string(r, E'\n');
end $$;
