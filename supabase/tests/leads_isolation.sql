-- Leads gate: leads and their history stay inside each tenant.
-- Paste the whole file into the Supabase SQL editor (test project) after the leads migration, and run it. It creates
-- two fake tenants (example.com data only), runs the checks, then stops with an error whose message lists every
-- result. Stopping with an error is deliberate: it rolls everything back, so nothing is ever saved.
-- Each check runs the way the server does: as service_role with an x-tenant-id header, switched by the request hook.

do $$
declare
  msg text; passed int; total int; res text; who text; n bigint; n2 bigint; got uuid; tbl text;
  a uuid := '00000000-0000-4000-8000-0000000000d1';
  b uuid := '00000000-0000-4000-8000-0000000000d2';
  b_org uuid; b_cust uuid; a_lead uuid; b_lead uuid;
begin
  create temp table gate_results (n serial, check_name text, pass boolean, detail text);
  grant all on gate_results to public;
  grant usage on sequence gate_results_n_seq to public;
  insert into public.tenants (id, slug, name) values (a, 'gate-leads-a', 'Gate Leads A'), (b, 'gate-leads-b', 'Gate Leads B');
  insert into public.organizations (tenant_id, legal_name) values (b, 'Gate Firm B') returning id into b_org;
  insert into public.calculator_customers (tenant_id, email) values (b, 'gate-cust-b@example.com') returning id into b_cust;
  insert into public.leads (tenant_id, full_name, email, source) values (a, 'A Lead', 'gate-a@example.com', 'manual') returning id into a_lead;
  insert into public.leads (tenant_id, full_name, email, source) values (b, 'B Lead', 'gate-b@example.com', 'wisp_audit') returning id into b_lead;
  insert into public.lead_events (tenant_id, lead_id, action) values (a, a_lead, 'gate'), (b, b_lead, 'gate');

  -- 1-2: each table, as the server runs for tenant A.
  foreach tbl in array array['leads', 'lead_events'] loop
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

  -- 3. A looking up B's lead by email finds nothing (the WISP audit and the webhook look leads up by email).
  select count(*) into n from public.leads where email = 'gate-b@example.com';
  insert into gate_results (check_name, pass, detail) values ('leads: A looking up B''s email finds nothing', n = 0, n || ' rows');

  -- 4. The same email can be a lead in both tenants (one email per tenant, not per platform).
  insert into public.leads (full_name, email, source) values ('A copy', 'gate-b@example.com', 'manual') returning tenant_id into got;
  insert into gate_results (check_name, pass, detail) values ('leads: a new lead without tenant_id gets A, even with B''s email', got = a, coalesce(got::text, 'null'));

  -- 5. Writing into B is refused.
  begin
    insert into public.leads (tenant_id, full_name, email, source) values (b, 'X', 'x@example.com', 'manual');
    res := 'allowed';
  exception when insufficient_privilege then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('leads: A writing a lead into B', res = 'refused', res);

  -- 6. One email is one lead within a tenant.
  begin
    insert into public.leads (full_name, email, source) values ('A again', 'gate-a@example.com', 'other');
    res := 'allowed';
  exception when unique_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('leads: a second lead for the same email', res = 'refused', res);

  -- 7-8. Same-tenant keys: A's lead can't point at B's firm or customer.
  begin
    insert into public.leads (full_name, email, source, organization_id) values ('Cross', 'cross1@example.com', 'manual', b_org);
    res := 'allowed';
  exception when foreign_key_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('leads: A lead linked to B''s firm', res = 'refused', res);
  begin
    insert into public.leads (full_name, email, source, customer_id) values ('Cross', 'cross2@example.com', 'manual', b_cust);
    res := 'allowed';
  exception when foreign_key_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('leads: A lead linked to B''s customer', res = 'refused', res);

  -- 9. A history row can't point at B's lead.
  begin
    insert into public.lead_events (lead_id, action) values (b_lead, 'cross');
    res := 'allowed';
  exception when foreign_key_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('lead_events: A history about B''s lead', res = 'refused', res);

  -- 10. A changing B's lead changes nothing.
  update public.leads set status = 'lost' where id = b_lead;
  get diagnostics n = row_count;
  insert into gate_results (check_name, pass, detail) values ('leads: A changing B''s lead changes nothing', n = 0, n || ' rows');

  -- 11. The history can't be changed.
  begin
    update public.lead_events set action = 'changed' where tenant_id = a;
    res := 'allowed';
  exception when raise_exception then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('lead_events: history can''t be changed', res = 'refused', res);

  -- 12. A deleting B's lead changes nothing.
  delete from public.leads where id = b_lead;
  get diagnostics n = row_count;
  insert into gate_results (check_name, pass, detail) values ('leads: A deleting B''s lead changes nothing', n = 0, n || ' rows');

  reset role;
  perform set_config('app.tenant_id', '', true);
  perform set_config('request.headers', '', true);

  -- 13. Even with platform access, a lead can't cross tenants.
  set local role service_role;
  begin
    insert into public.leads (tenant_id, full_name, email, source, organization_id) values (a, 'Cross', 'cross3@example.com', 'manual', b_org);
    res := 'allowed';
  exception when foreign_key_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('leads: A lead linked to B''s firm, even as platform', res = 'refused', res);
  reset role;

  select count(*) filter (where g.pass), count(*), string_agg(format('%s. %s  %s  (%s)', g.n, case when g.pass then 'PASS' else 'FAIL' end, g.check_name, g.detail), E'\n' order by g.n)
    into passed, total, msg from gate_results g;
  -- Raising undoes everything above, so nothing is saved.
  raise exception E'GATE RESULT: % of % passed (rolled back, nothing saved)\n%', passed, total, msg;
end $$;
