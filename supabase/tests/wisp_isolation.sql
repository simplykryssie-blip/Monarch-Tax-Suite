-- WISP Generator gate: leads, plans and the delivery history stay inside each tenant.
-- Paste the whole file into the Supabase SQL editor (test project) after the WISP migration, and run it. It creates two
-- fake tenants (example.com data only), runs 12 checks, then stops with an error whose message lists every result.
-- Stopping with an error is deliberate: it rolls everything back, so nothing is ever saved.
-- Each check runs the way the server does: as service_role with an x-tenant-id header, switched by the request hook.

do $$
declare
  msg text; passed int; total int; res text; who text; n bigint; n2 bigint; got uuid;
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  b uuid := '00000000-0000-4000-8000-0000000000b2';
  tok text := repeat('a', 64);
  b_cust uuid; b_audit uuid; b_plan uuid; a_plan uuid; a_audit uuid; tbl text;
begin
  create temp table gate_results (n serial, check_name text, pass boolean, detail text);
  grant all on gate_results to public;
  grant usage on sequence gate_results_n_seq to public;
  insert into public.tenants (id, slug, name) values (a, 'gate-wisp-a', 'Gate WISP A'), (b, 'gate-wisp-b', 'Gate WISP B');
  insert into public.calculator_customers (tenant_id, email, full_name, status) values (b, 'gate-wisp-b@example.com', 'B Buyer', 'active') returning id into b_cust;
  insert into public.wisp_audits (tenant_id, score, breakdown, answers) values (a, 40, '{}', '[]') returning id into a_audit;
  insert into public.wisp_audits (tenant_id, score, breakdown, answers) values (b, 60, '{}', '[]') returning id into b_audit;
  insert into public.wisp_plans (tenant_id, audit_id, firm_name, email, answers_sealed, access_token_hash) values (a, a_audit, 'A Firm', 'a@example.com', 'v1:x', tok) returning id into a_plan;
  insert into public.wisp_plans (tenant_id, audit_id, firm_name, email, answers_sealed, access_token_hash, customer_id) values (b, b_audit, 'B Firm', 'b@example.com', 'v1:x', tok, b_cust) returning id into b_plan;
  insert into public.wisp_deliveries (tenant_id, plan_id, kind, status, actor) values (a, a_plan, 'email', 'sent', 'system'), (b, b_plan, 'email', 'sent', 'system');

  -- 1-3: each table, as the server runs for tenant A.
  foreach tbl in array array['wisp_audits', 'wisp_plans', 'wisp_deliveries'] loop
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

  -- 4. A can't find B's plan by its checkout or link, or read B's sealed answers.
  update public.wisp_plans set stripe_session_id = 'cs_gate_b' where id = b_plan;
  get diagnostics n = row_count;
  insert into gate_results (check_name, pass, detail) values ('wisp_plans: A changing B''s plan changes nothing', n = 0, n || ' rows');

  -- 5. Writing into B is refused.
  begin
    insert into public.wisp_audits (tenant_id, score, breakdown, answers) values (b, 1, '{}', '[]');
    res := 'allowed';
  exception when insufficient_privilege then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('wisp_audits: A writing a lead into B', res = 'refused', res);

  -- 6. New rows get A.
  insert into public.wisp_audits (score, breakdown, answers) values (10, '{}', '[]') returning tenant_id into got;
  insert into gate_results (check_name, pass, detail) values ('wisp_audits: a lead without tenant_id gets A', got = a, coalesce(got::text, 'null'));

  -- 7. A's plan can't point at B's customer, audit or order (same-tenant keys).
  begin
    update public.wisp_plans set customer_id = b_cust where id = a_plan;
    res := 'allowed';
  exception when foreign_key_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('wisp_plans: A plan linked to B''s customer', res = 'refused', res);
  begin
    update public.wisp_plans set audit_id = b_audit where id = a_plan;
    res := 'allowed';
  exception when foreign_key_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('wisp_plans: A plan linked to B''s audit', res = 'refused', res);

  -- 9. A delivery can't be logged against B's plan.
  begin
    insert into public.wisp_deliveries (plan_id, kind, status, actor) values (b_plan, 'email', 'sent', 'system');
    res := 'allowed';
  exception when foreign_key_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('wisp_deliveries: A logging a delivery on B''s plan', res = 'refused', res);

  -- 10. The delivery history can't be changed.
  begin
    update public.wisp_deliveries set status = 'failed' where plan_id = a_plan;
    res := 'allowed';
  exception when raise_exception then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('wisp_deliveries: history can''t be changed', res = 'refused', res);

  -- 11. A deleting B's rows changes nothing.
  delete from public.wisp_plans where id = b_plan;
  get diagnostics n = row_count;
  insert into gate_results (check_name, pass, detail) values ('wisp_plans: A deleting B''s plan changes nothing', n = 0, n || ' rows');

  reset role;
  perform set_config('app.tenant_id', '', true);
  perform set_config('request.headers', '', true);

  -- 12. Even with platform access, a plan can't cross tenants.
  set local role service_role;
  begin
    insert into public.wisp_plans (tenant_id, firm_name, email, answers_sealed, access_token_hash, customer_id) values (a, 'Cross', 'x@example.com', 'v1:x', tok, b_cust);
    res := 'allowed';
  exception when foreign_key_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('wisp_plans: A plan for B''s customer, even as platform', res = 'refused', res);
  reset role;

  select count(*) filter (where g.pass), count(*), string_agg(format('%s. %s  %s  (%s)', g.n, case when g.pass then 'PASS' else 'FAIL' end, g.check_name, g.detail), E'\n' order by g.n)
    into passed, total, msg from gate_results g;
  -- Raising undoes everything above, so nothing is saved.
  raise exception E'GATE RESULT: % of % passed (rolled back, nothing saved)\n%', passed, total, msg;
end $$;
