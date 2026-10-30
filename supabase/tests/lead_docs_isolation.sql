-- Lead documents gate: a lead's documents stay inside their tenant.
-- Paste the whole file into the Supabase SQL editor (test project) after the lead_docs migration, and run it. It creates two
-- fake tenants (example.com data only), runs the checks, then stops with an error whose message lists every result.
-- Stopping with an error is deliberate: it rolls everything back, so nothing is ever saved.
-- Each check runs the way the server does: as service_role with an x-tenant-id header, switched by the request hook.

do $$
declare
  msg text; passed int; total int; res text; who text; n bigint; n2 bigint; got uuid;
  a uuid := '00000000-0000-4000-8000-0000000000e1';
  b uuid := '00000000-0000-4000-8000-0000000000e2';
  a_lead uuid; b_lead uuid;
begin
  create temp table gate_results (n serial, check_name text, pass boolean, detail text);
  grant all on gate_results to public;
  grant usage on sequence gate_results_n_seq to public;
  insert into public.tenants (id, slug, name) values (a, 'gate-leaddocs-a', 'Gate Lead Docs A'), (b, 'gate-leaddocs-b', 'Gate Lead Docs B');
  insert into public.leads (tenant_id, full_name, email, source) values (a, 'A Lead', 'gate-ld-a@example.com', 'manual') returning id into a_lead;
  insert into public.leads (tenant_id, full_name, email, source) values (b, 'B Lead', 'gate-ld-b@example.com', 'manual') returning id into b_lead;
  insert into public.lead_docs (tenant_id, lead_id, title, file_path, file_type) values (a, a_lead, 'A doc', 'a/leads/x/1.pdf', 'pdf'), (b, b_lead, 'B doc', 'b/leads/y/1.pdf', 'pdf');

  -- 1. As the server runs for tenant A: none of B's documents are visible, and the list holds only A's.
  set local role service_role;
  perform set_config('request.headers', json_build_object('x-tenant-id', a)::text, true);
  perform public.pgrst_pre_request();
  who := current_user;
  select count(*) into n from public.lead_docs where tenant_id = b;
  select count(*) into n2 from public.lead_docs;
  insert into gate_results (check_name, pass, detail) values ('lead_docs: as tenant_app, 0 of B visible, lists only A', who = 'tenant_app' and n = 0 and n2 = 1, who || ', B visible ' || n || ', listed ' || n2);

  -- 2. A new document without a tenant gets A's.
  insert into public.lead_docs (lead_id, title, file_path, file_type) values (a_lead, 'A second', 'a/leads/x/2.pdf', 'pdf') returning tenant_id into got;
  insert into gate_results (check_name, pass, detail) values ('lead_docs: a new document without tenant_id gets A', got = a, coalesce(got::text, 'null'));

  -- 3. Writing a document into B is refused.
  begin
    insert into public.lead_docs (tenant_id, lead_id, title, file_path, file_type) values (b, b_lead, 'X', 'b/leads/y/2.pdf', 'pdf');
    res := 'allowed';
  exception when insufficient_privilege then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('lead_docs: A writing a document into B', res = 'refused', res);

  -- 4. A deleting B's document changes nothing.
  delete from public.lead_docs where tenant_id = b;
  get diagnostics n = row_count;
  insert into gate_results (check_name, pass, detail) values ('lead_docs: A deleting B''s document changes nothing', n = 0, n || ' rows');

  reset role;
  perform set_config('app.tenant_id', '', true);
  perform set_config('request.headers', '', true);

  -- 5. Even with platform access, a document can't point at another tenant's lead.
  set local role service_role;
  begin
    insert into public.lead_docs (tenant_id, lead_id, title, file_path, file_type) values (a, b_lead, 'Cross', 'a/leads/z/1.pdf', 'pdf');
    res := 'allowed';
  exception when foreign_key_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('lead_docs: a document in A pointing at B''s lead, even as platform', res = 'refused', res);
  reset role;

  select count(*) filter (where g.pass), count(*), string_agg(format('%s. %s  %s  (%s)', g.n, case when g.pass then 'PASS' else 'FAIL' end, g.check_name, g.detail), E'\n' order by g.n)
    into passed, total, msg from gate_results g;
  -- Raising undoes everything above, so nothing is saved.
  raise exception E'GATE RESULT: % of % passed (rolled back, nothing saved)\n%', passed, total, msg;
end $$;
