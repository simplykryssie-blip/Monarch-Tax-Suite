-- Phase 4 gate: PTIN-holder operations. Run it in the SQL editor of the TEST project after 20261104090000_practice_access,
-- 20261105090000_prep_assignment and 20261106090000_independent_wisp. Two throwaway tenants and example.com data only. It
-- never commits: it ends by raising an exception carrying the results, so everything it did is rolled back. Every line
-- of the message should start with PASS.
--
-- Server requests are simulated as PostgREST runs them: SET LOCAL ROLE service_role, request.headers carrying
-- x-tenant-id, then public.pgrst_pre_request() (which switches to tenant_app for that tenant).
--
-- What this proves is the database's side: tenants cannot see or write each other's clients, returns, checklists,
-- handoffs, WISPs, sign-ins or audit rows; a handoff cannot point across tenants; the audit history and archived
-- WISPs cannot be changed; and "linked to an ERO" is exactly an active office_members row. Which of a tenant's own
-- people sees which client (per-user scoping) and the assignment rules are enforced in the app and are tested in
-- tests/prep.test.ts, not here.

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a4';
  b uuid := '00000000-0000-4000-8000-0000000000b5';
  ua uuid := '00000000-0000-4000-8000-0000000000c1';
  ub uuid := '00000000-0000-4000-8000-0000000000c2';
  u_active uuid := '00000000-0000-4000-8000-0000000000c3';
  u_invited uuid := '00000000-0000-4000-8000-0000000000c4';
  u_suspended uuid := '00000000-0000-4000-8000-0000000000c5';
  u_none uuid := '00000000-0000-4000-8000-0000000000c6';
  r text[] := '{}';
  n bigint;
  outcome text;
  msg text;
  org uuid;
  b_client uuid; b_return uuid; b_wisp uuid; b_member uuid;
  a_client uuid; a_return uuid; a_wisp uuid; a_audit uuid;
  hash_b text := repeat('b', 64);
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
    (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gate4-a@example.com', now(), now()),
    (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gate4-b@example.com', now(), now()),
    (u_active, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gate4-active@example.com', now(), now()),
    (u_invited, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gate4-invited@example.com', now(), now()),
    (u_suspended, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gate4-suspended@example.com', now(), now()),
    (u_none, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gate4-none@example.com', now(), now());

  -- ------------------------------------------------------------ tenants and tiers
  insert into public.tenants (id, slug, name, tier) values (a, 'gate-p4-a', 'Gate P4 Tenant A', 'ptin'), (b, 'gate-p4-b', 'Gate P4 Tenant B', 'ptin');
  select count(*) into n from public.tenants where id in (a, b) and tier = 'ptin';
  r := r || format('%s ptin-tier workspaces can be created (%s of 2)', case when n = 2 then 'PASS' else 'FAIL' end, n);
  begin
    insert into public.tenants (id, slug, name, tier) values ('00000000-0000-4000-8000-0000000000e9', 'gate-p4-bad', 'Gate P4 Bad', 'free');
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s an unknown tier is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  -- ------------------------------------------------------------ seed tenant B (as the platform)
  insert into public.practice_members (tenant_id, email, full_name, invite_token_hash) values (b, 'owner@example.com', 'B Owner', hash_b) returning id into b_member;
  insert into public.clients (tenant_id, full_name, owner_id) values (b, 'B Client', ub) returning id into b_client;
  insert into public.client_returns (tenant_id, client_id, tax_year, assignee_id) values (b, b_client, 2025, ub) returning id into b_return;
  insert into public.return_checklist_items (tenant_id, return_id, label) values (b, b_return, 'B item');
  insert into public.return_handoffs (tenant_id, return_id, to_email, file_name, file_sha256, status) values (b, b_return, 'ero@example.com', 'b.csv', repeat('0', 64), 'sent');
  insert into public.practice_wisps (tenant_id, practice_name, holder_name, answers_sealed) values (b, 'B Practice', 'B Owner', 'sealed') returning id into b_wisp;
  insert into public.workspace_audit_events (tenant_id, actor_id, action) values (b, ub, 'gate_b_event');

  -- ------------------------------------------------------------ as tenant A's server request
  set local role service_role;
  perform set_config('request.headers', json_build_object('x-tenant-id', a)::text, true);
  perform public.pgrst_pre_request();
  r := r || format('%s server request runs as tenant_app (%s)', case when current_user = 'tenant_app' then 'PASS' else 'FAIL' end, current_user);

  -- Sign-in records.
  insert into public.practice_members (email, full_name, invite_token_hash) values ('owner@example.com', 'A Owner', repeat('a', 64));
  select count(*) into n from public.practice_members;
  r := r || format('%s practice_members: A sees only its own sign-in (%s); the same email in B is allowed', case when n = 1 then 'PASS' else 'FAIL' end, n);
  begin
    insert into public.practice_members (email, full_name) values ('OWNER@example.com', 'Again');
    outcome := 'allowed';
  exception when unique_violation then outcome := 'refused';
  end;
  r := r || format('%s practice_members: the same email twice in one workspace is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.practice_members (email, full_name, invite_token_hash) values ('other@example.com', 'Other', hash_b);
    outcome := 'allowed';
  exception when unique_violation then outcome := 'refused';
  end;
  r := r || format('%s practice_members: another workspace''s invite link can''t be reused (%s)', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.practice_members (tenant_id, email, full_name) values (b, 'intruder@example.com', 'Intruder');
    outcome := 'allowed';
  exception when insufficient_privilege then outcome := 'refused';
  end;
  r := r || format('%s practice_members: A adding a sign-in to B is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  update public.practice_members set status = 'suspended' where id = b_member;
  get diagnostics n = row_count;
  r := r || format('%s practice_members: A suspending B''s owner changes %s rows', case when n = 0 then 'PASS' else 'FAIL' end, n);

  -- Clients and returns.
  insert into public.clients (full_name, owner_id) values ('A Client', ua) returning id into a_client;
  select count(*) into n from public.clients;
  r := r || format('%s clients: A sees only its own (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.clients where tenant_id = a and owner_id = ua;
  r := r || format('%s clients: the new client is filed under A and owned by its preparer (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  begin
    insert into public.clients (tenant_id, full_name) values (b, 'Planted');
    outcome := 'allowed';
  exception when insufficient_privilege then outcome := 'refused';
  end;
  r := r || format('%s clients: A writing a client into B is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  insert into public.client_returns (client_id, tax_year, assignee_id) values (a_client, 2025, ua) returning id into a_return;
  select count(*) into n from public.client_returns;
  r := r || format('%s client_returns: A sees only its own (%s); a new return starts "not_started"', case when n = 1 and (select prep_status from public.client_returns where id = a_return) = 'not_started' then 'PASS' else 'FAIL' end, n);
  begin
    insert into public.client_returns (client_id, tax_year) values (b_client, 2024);
    outcome := 'allowed';
  exception when foreign_key_violation then outcome := 'refused';
  end;
  r := r || format('%s client_returns: a return on B''s client is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    update public.client_returns set prep_status = 'bogus' where id = a_return;
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s client_returns: an unknown prep status is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  update public.client_returns set prep_status = 'handed_off', handed_off_at = now() where id = b_return;
  get diagnostics n = row_count;
  r := r || format('%s client_returns: A handing off B''s return changes %s rows', case when n = 0 then 'PASS' else 'FAIL' end, n);

  -- Checklist.
  insert into public.return_checklist_items (return_id, label) values (a_return, 'A item');
  select count(*) into n from public.return_checklist_items;
  r := r || format('%s return_checklist_items: A sees only its own (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  begin
    insert into public.return_checklist_items (return_id, label) values (b_return, 'Planted');
    outcome := 'allowed';
  exception when foreign_key_violation then outcome := 'refused';
  end;
  r := r || format('%s return_checklist_items: an item on B''s return is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  -- Handoffs: a record of a file sent, never a link into another tenant.
  insert into public.return_handoffs (return_id, to_email, file_name, file_sha256, status) values (a_return, 'ero@example.com', 'a.csv', repeat('1', 64), 'sent');
  select count(*) into n from public.return_handoffs;
  r := r || format('%s return_handoffs: A sees only its own (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  begin
    insert into public.return_handoffs (return_id, to_email, file_name, file_sha256, status) values (b_return, 'ero@example.com', 'x.csv', repeat('2', 64), 'sent');
    outcome := 'allowed';
  exception when foreign_key_violation then outcome := 'refused';
  end;
  r := r || format('%s return_handoffs: a handoff of B''s return is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  -- Independent WISPs.
  insert into public.practice_wisps (practice_name, holder_name, answers_sealed) values ('A Practice', 'A Owner', 'sealed') returning id into a_wisp;
  select count(*) into n from public.practice_wisps;
  r := r || format('%s practice_wisps: A sees only its own (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  begin
    insert into public.practice_wisps (practice_name, holder_name, answers_sealed) values ('A Second', 'A Owner', 'sealed');
    outcome := 'allowed';
  exception when unique_violation then outcome := 'refused';
  end;
  r := r || format('%s practice_wisps: a second live WISP for A is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.practice_wisps (tenant_id, practice_name, holder_name, answers_sealed) values (b, 'Planted', 'x', 'sealed');
    outcome := 'allowed';
  exception when insufficient_privilege then outcome := 'refused';
  end;
  r := r || format('%s practice_wisps: A writing a WISP into B is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  update public.practice_wisps set status = 'paid' where id = b_wisp;
  get diagnostics n = row_count;
  r := r || format('%s practice_wisps: A marking B''s WISP paid changes %s rows', case when n = 0 then 'PASS' else 'FAIL' end, n);

  update public.practice_wisps set status = 'active', attested_at = now(), attested_name = 'A Owner', review_due_on = current_date + 365 where id = a_wisp;
  begin
    delete from public.practice_wisps where id = a_wisp;
    outcome := 'allowed';
  exception when raise_exception then outcome := case when sqlerrm like 'WISP_HISTORY_KEPT%' then 'refused' else sqlerrm end;
  end;
  r := r || format('%s practice_wisps: deleting an attested WISP is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  update public.practice_wisps set status = 'archived', archived_at = now(), archived_reason = 'linked_to_ero' where id = a_wisp;
  begin
    update public.practice_wisps set holder_name = 'Changed' where id = a_wisp;
    outcome := 'allowed';
  exception when raise_exception then outcome := case when sqlerrm like 'WISP_HISTORY_KEPT%' then 'refused' else sqlerrm end;
  end;
  r := r || format('%s practice_wisps: changing an archived WISP is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    delete from public.practice_wisps where id = a_wisp;
    outcome := 'allowed';
  exception when raise_exception then outcome := case when sqlerrm like 'WISP_HISTORY_KEPT%' then 'refused' else sqlerrm end;
  end;
  r := r || format('%s practice_wisps: deleting an archived WISP is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  insert into public.practice_wisps (practice_name, holder_name, answers_sealed) values ('A New Practice', 'A Owner', 'sealed');
  select count(*) into n from public.practice_wisps;
  r := r || format('%s practice_wisps: after archiving, A can start a new live WISP and the archived one is kept (%s rows)', case when n = 2 then 'PASS' else 'FAIL' end, n);

  -- Audit history.
  insert into public.workspace_audit_events (actor_id, action, subject_type, detail) values (ua, 'gate_a_event', 'client', '{"k":"v"}') returning id into a_audit;
  select count(*) into n from public.workspace_audit_events;
  r := r || format('%s workspace_audit_events: A sees only its own (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  begin
    update public.workspace_audit_events set action = 'rewritten' where id = a_audit;
    outcome := 'allowed';
  exception when raise_exception then outcome := case when sqlerrm like 'AUDIT_HISTORY_KEPT%' then 'refused' else sqlerrm end;
  end;
  r := r || format('%s workspace_audit_events: changing a row is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    delete from public.workspace_audit_events where id = a_audit;
    outcome := 'allowed';
  exception when raise_exception then outcome := case when sqlerrm like 'AUDIT_HISTORY_KEPT%' then 'refused' else sqlerrm end;
  end;
  r := r || format('%s workspace_audit_events: deleting a row is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.workspace_audit_events (tenant_id, actor_id, action) values (b, ua, 'planted');
    outcome := 'allowed';
  exception when insufficient_privilege then outcome := 'refused';
  end;
  r := r || format('%s workspace_audit_events: A writing an audit row into B is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  reset role;
  perform set_config('app.tenant_id', '', true);
  perform set_config('request.headers', '', true);

  -- ------------------------------------------------------------ B's data is untouched
  select (select count(*) from public.practice_members where tenant_id = b and status = 'invited')
       + (select count(*) from public.client_returns where tenant_id = b and prep_status = 'not_started')
       + (select count(*) from public.practice_wisps where tenant_id = b and status = 'draft')
       + (select count(*) from public.clients where tenant_id = b)
       + (select count(*) from public.workspace_audit_events where tenant_id = b)
       + (select count(*) from public.return_handoffs where tenant_id = b) into n;
  r := r || format('%s B''s sign-in, client, return, WISP, audit and handoff rows are untouched by A (%s of 6)', case when n = 6 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.workspace_audit_events where action = 'planted';
  r := r || format('%s no audit row was planted into B (%s)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  -- The handoff table has the same-tenant key and nothing else that reaches another tenant.
  select count(*) into n from pg_constraint c join pg_class t on t.oid = c.conrelid where t.relname = 'return_handoffs' and c.contype = 'f' and c.conname <> 'return_handoffs_return_id_same_tenant' and c.confrelid::regclass::text not in ('tenants', 'public.tenants', 'auth.users', 'client_returns');
  r := r || format('%s return_handoffs: no foreign key leaves the tenant (%s unexpected)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  -- Signed-in and anonymous users have no direct access to the new tables.
  select count(*) into n from unnest(array['practice_members', 'workspace_audit_events', 'return_checklist_items', 'return_handoffs', 'practice_wisps']) t
    where has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'select');
  r := r || format('%s anon and signed-in users can''t read the new tables directly (%s open)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  -- ------------------------------------------------------------ "linked to an ERO" is an active office_members row
  insert into public.organizations (tenant_id, legal_name) values (a, 'Gate Office A') returning id into org;
  insert into public.office_members (tenant_id, organization_id, role, email, full_name, status, user_id) values
    (a, org, 'preparer', 'gate4-active@example.com', 'Active', 'active', u_active),
    (a, org, 'preparer', 'gate4-invited@example.com', 'Invited', 'invited', u_invited),
    (a, org, 'preparer', 'gate4-suspended@example.com', 'Suspended', 'suspended', u_suspended);
  r := r || format('%s is_linked_to_ero: an active office member is linked (%s)', case when public.is_linked_to_ero(u_active) then 'PASS' else 'FAIL' end, public.is_linked_to_ero(u_active));
  r := r || format('%s is_linked_to_ero: a pending invite is not linked (%s)', case when not public.is_linked_to_ero(u_invited) then 'PASS' else 'FAIL' end, public.is_linked_to_ero(u_invited));
  r := r || format('%s is_linked_to_ero: a suspended member is not linked (%s)', case when not public.is_linked_to_ero(u_suspended) then 'PASS' else 'FAIL' end, public.is_linked_to_ero(u_suspended));
  r := r || format('%s is_linked_to_ero: someone with no office is not linked (%s)', case when not public.is_linked_to_ero(u_none) then 'PASS' else 'FAIL' end, public.is_linked_to_ero(u_none));
  r := r || format('%s anon and signed-in users can''t ask who is linked (%s)', case when not has_function_privilege('anon', 'public.is_linked_to_ero(uuid)', 'execute') and not has_function_privilege('authenticated', 'public.is_linked_to_ero(uuid)', 'execute') then 'PASS' else 'FAIL' end, 'checked');

  raise exception E'PHASE 4 GATE RESULTS (rolled back, nothing kept):\n%', array_to_string(r, E'\n');
end $$;
