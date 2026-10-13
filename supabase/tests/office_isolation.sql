-- Office area gate: office members and the office history stay inside each tenant.
-- Paste the whole file into the Supabase SQL editor (test project) after the office access migration, and run it. It
-- creates two fake tenants (example.com data only), runs the checks, then stops with an error whose message lists
-- every result. Stopping with an error is deliberate: it rolls everything back, so nothing is ever saved.
-- Each check runs the way the server does: as service_role with an x-tenant-id header, switched by the request hook.

do $$
declare
  msg text; passed int; total int; res text; who text; n bigint; n2 bigint; got uuid; tbl text;
  a uuid := '00000000-0000-4000-8000-0000000000e1';
  b uuid := '00000000-0000-4000-8000-0000000000e2';
  a_org uuid; b_org uuid; a_mem uuid; b_mem uuid;
begin
  create temp table gate_results (n serial, check_name text, pass boolean, detail text);
  grant all on gate_results to public;
  grant usage on sequence gate_results_n_seq to public;
  insert into public.tenants (id, slug, name) values (a, 'gate-office-a', 'Gate Office A'), (b, 'gate-office-b', 'Gate Office B');
  insert into public.organizations (tenant_id, legal_name) values (a, 'Gate Firm A') returning id into a_org;
  insert into public.organizations (tenant_id, legal_name) values (b, 'Gate Firm B') returning id into b_org;
  insert into public.office_members (tenant_id, organization_id, role, email, full_name) values (a, a_org, 'ero', 'gate-a@example.com', 'A Ero') returning id into a_mem;
  insert into public.office_members (tenant_id, organization_id, role, email, full_name) values (b, b_org, 'ero', 'gate-b@example.com', 'B Ero') returning id into b_mem;
  insert into public.office_events (tenant_id, organization_id, member_id, action) values (a, a_org, a_mem, 'gate'), (b, b_org, b_mem, 'gate');

  -- 1-2: each table, as the server runs for tenant A.
  foreach tbl in array array['office_members', 'office_events'] loop
    set local role service_role;
    perform set_config('request.headers', json_build_object('x-tenant-id', a)::text, true);
    perform public.pgrst_pre_request();
    who := current_user;
    execute format('select count(*) from public.%I where tenant_id = $1', tbl) into n using b;
    execute format('select count(*) from public.%I', tbl) into n2;
    reset role;
    perform set_config('app.tenant_id', '', true);
    perform set_config('request.headers', '', true);
    insert into gate_results (check_name, pass, detail) values (tbl || ': as tenant_app, 0 of B visible, lists only A', who = 'tenant_app' and n = 0 and n2 = 1, who || ', B visible ' || n || ', listed ' || n2);
  end loop;

  set local role service_role;
  perform set_config('request.headers', json_build_object('x-tenant-id', a)::text, true);
  perform public.pgrst_pre_request();

  -- 3. A can't change B's member (for example, to take over their sign-in).
  update public.office_members set user_id = null, status = 'suspended' where id = b_mem;
  get diagnostics n = row_count;
  insert into gate_results (check_name, pass, detail) values ('office_members: A changing B''s member changes nothing', n = 0, n || ' rows');

  -- 4. Writing into B is refused.
  begin
    insert into public.office_members (tenant_id, organization_id, role, email, full_name) values (b, b_org, 'preparer', 'x@example.com', 'X');
    res := 'allowed';
  exception when insufficient_privilege then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('office_members: A writing a member into B', res = 'refused', res);

  -- 5. New rows get A.
  insert into public.office_members (organization_id, role, email, full_name) values (a_org, 'preparer', 'gate-a2@example.com', 'A Prep') returning tenant_id into got;
  insert into gate_results (check_name, pass, detail) values ('office_members: a member without tenant_id gets A', got = a, coalesce(got::text, 'null'));

  -- 6. A's member can't belong to B's office (same-tenant key).
  begin
    insert into public.office_members (organization_id, role, email, full_name) values (b_org, 'preparer', 'cross@example.com', 'Cross');
    res := 'allowed';
  exception when foreign_key_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('office_members: A member in B''s office', res = 'refused', res);

  -- 7. A history row can't point at B's member.
  begin
    insert into public.office_events (organization_id, member_id, action) values (a_org, b_mem, 'cross');
    res := 'allowed';
  exception when foreign_key_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('office_events: A history about B''s member', res = 'refused', res);

  -- 8. The office history can't be changed.
  begin
    update public.office_events set action = 'changed' where tenant_id = a;
    res := 'allowed';
  exception when raise_exception then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('office_events: history can''t be changed', res = 'refused', res);

  -- 9. A deleting B's member changes nothing.
  delete from public.office_members where id = b_mem;
  get diagnostics n = row_count;
  insert into gate_results (check_name, pass, detail) values ('office_members: A deleting B''s member changes nothing', n = 0, n || ' rows');

  reset role;
  perform set_config('app.tenant_id', '', true);
  perform set_config('request.headers', '', true);

  -- 10. Even with platform access, a member can't cross tenants.
  set local role service_role;
  begin
    insert into public.office_members (tenant_id, organization_id, role, email, full_name) values (a, b_org, 'preparer', 'cross2@example.com', 'Cross');
    res := 'allowed';
  exception when foreign_key_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('office_members: A member in B''s office, even as platform', res = 'refused', res);
  reset role;

  select count(*) filter (where g.pass), count(*), string_agg(format('%s. %s  %s  (%s)', g.n, case when g.pass then 'PASS' else 'FAIL' end, g.check_name, g.detail), E'\n' order by g.n)
    into passed, total, msg from gate_results g;
  -- Raising undoes everything above, so nothing is saved.
  raise exception E'GATE RESULT: % of % passed (rolled back, nothing saved)\n%', passed, total, msg;
end $$;
