-- My Workspace gate: every client, return, document, message, task, note, invoice and bank import stays inside its tenant.
-- Paste the whole file into the Supabase SQL editor (test project) after the workspace migration, and run it. It
-- creates two fake tenants (example.com data only), runs the checks, then stops with an error whose message lists
-- every result. Stopping with an error is deliberate: it rolls everything back, so nothing is ever saved.
-- Each check runs the way the server does: as service_role with an x-tenant-id header, switched by the request hook.

do $$
declare
  msg text; passed int; total int; res text; who text; n bigint; n2 bigint; got uuid; tbl text;
  a uuid := '00000000-0000-4000-8000-0000000000d1';
  b uuid := '00000000-0000-4000-8000-0000000000d2';
  a_cl uuid; b_cl uuid; a_ret uuid; b_ret uuid; a_inv uuid; b_inv uuid; a_imp uuid; b_imp uuid;
begin
  create temp table gate_results (n serial, check_name text, pass boolean, detail text);
  grant all on gate_results to public;
  grant usage on sequence gate_results_n_seq to public;
  insert into public.tenants (id, slug, name) values (a, 'gate-ws-a', 'Gate Workspace A'), (b, 'gate-ws-b', 'Gate Workspace B');
  insert into public.clients (tenant_id, full_name, ssn_last4) values (a, 'A Client', '1111') returning id into a_cl;
  insert into public.clients (tenant_id, full_name, ssn_last4) values (b, 'B Client', '2222') returning id into b_cl;
  insert into public.client_returns (tenant_id, client_id, tax_year) values (a, a_cl, 2025) returning id into a_ret;
  insert into public.client_returns (tenant_id, client_id, tax_year) values (b, b_cl, 2025) returning id into b_ret;
  insert into public.client_docs (tenant_id, client_id, title, file_path, file_type) values (a, a_cl, 'A doc', 'gate/a-doc.pdf', 'pdf'), (b, b_cl, 'B doc', 'gate/b-doc.pdf', 'pdf');
  insert into public.client_messages (tenant_id, client_id, body) values (a, a_cl, 'A msg'), (b, b_cl, 'B msg');
  insert into public.client_tasks (tenant_id, client_id, title) values (a, a_cl, 'A task'), (b, b_cl, 'B task');
  insert into public.client_notes (tenant_id, client_id, body) values (a, a_cl, 'A note'), (b, b_cl, 'B note');
  insert into public.invoices (tenant_id, client_id, number, tax_year, total_cents) values (a, a_cl, 'INV-0001', 2025, 22300) returning id into a_inv;
  insert into public.invoices (tenant_id, client_id, number, tax_year, total_cents) values (b, b_cl, 'INV-0001', 2025, 22300) returning id into b_inv;
  insert into public.payment_imports (tenant_id, file_name, file_sha256) values (a, 'a.csv', repeat('a', 64)) returning id into a_imp;
  insert into public.payment_imports (tenant_id, file_name, file_sha256) values (b, 'b.csv', repeat('b', 64)) returning id into b_imp;
  insert into public.payment_import_rows (tenant_id, import_id, row_no, amount_cents) values (a, a_imp, 1, 100), (b, b_imp, 1, 100);

  -- 1-9: each table, as the server runs for tenant A.
  foreach tbl in array array['clients', 'client_returns', 'client_docs', 'client_messages', 'client_tasks', 'client_notes', 'invoices', 'payment_imports', 'payment_import_rows'] loop
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

  -- 10. Writing into B is refused.
  begin
    insert into public.clients (tenant_id, full_name) values (b, 'X');
    res := 'allowed';
  exception when insufficient_privilege then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('clients: A writing a client into B', res = 'refused', res);

  -- 11. New rows get A.
  insert into public.client_notes (client_id, body) values (a_cl, 'A note 2') returning tenant_id into got;
  insert into gate_results (check_name, pass, detail) values ('client_notes: a note without tenant_id gets A', got = a, coalesce(got::text, 'null'));

  -- 12-15. Same-tenant keys: A's records can't point at B's client, return or invoice.
  begin
    insert into public.client_returns (client_id, tax_year) values (b_cl, 2024);
    res := 'allowed';
  exception when foreign_key_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('client_returns: A return for B''s client', res = 'refused', res);
  begin
    insert into public.invoices (client_id, return_id, number, tax_year, total_cents) values (a_cl, b_ret, 'INV-0002', 2025, 100);
    res := 'allowed';
  exception when foreign_key_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('invoices: A invoice tied to B''s return', res = 'refused', res);
  begin
    insert into public.payment_import_rows (import_id, row_no, amount_cents, invoice_id) values (a_imp, 2, 100, b_inv);
    res := 'allowed';
  exception when foreign_key_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('payment_import_rows: A row matched to B''s invoice', res = 'refused', res);
  begin
    insert into public.client_docs (client_id, title, file_path, file_type) values (b_cl, 'Cross', 'gate/cross.pdf', 'pdf');
    res := 'allowed';
  exception when foreign_key_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('client_docs: A file on B''s client', res = 'refused', res);

  -- 16-17. The per-year rules.
  begin
    insert into public.client_returns (client_id, tax_year) values (a_cl, 2025);
    res := 'allowed';
  exception when unique_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('client_returns: a second original for the same year', res = 'refused', res);
  begin
    insert into public.client_returns (client_id, tax_year, kind) values (a_cl, 2025, 'amendment'), (a_cl, 2025, 'amendment');
    res := 'both added';
  exception when others then res := 'error: ' || sqlerrm;
  end;
  insert into gate_results (check_name, pass, detail) values ('client_returns: amendments can repeat', res = 'both added', res);

  -- 18. The same invoice number in another tenant is fine; a repeat in the same tenant is not.
  begin
    insert into public.invoices (client_id, number, tax_year, total_cents) values (a_cl, 'INV-0001', 2025, 100);
    res := 'allowed';
  exception when unique_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('invoices: a repeated number in the same tenant', res = 'refused', res);

  reset role;
  perform set_config('app.tenant_id', '', true);
  perform set_config('request.headers', '', true);

  -- 19. Even with platform access, a record can't cross tenants.
  set local role service_role;
  begin
    insert into public.client_returns (tenant_id, client_id, tax_year) values (a, b_cl, 2020);
    res := 'allowed';
  exception when foreign_key_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('client_returns: A return for B''s client, even as platform', res = 'refused', res);
  reset role;

  select count(*) filter (where g.pass), count(*), string_agg(format('%s. %s  %s  (%s)', g.n, case when g.pass then 'PASS' else 'FAIL' end, g.check_name, g.detail), E'\n' order by g.n)
    into passed, total, msg from gate_results g;
  -- Raising undoes everything above, so nothing is saved.
  raise exception E'GATE RESULT: % of % passed (rolled back, nothing saved)\n%', passed, total, msg;
end $$;
