-- Fees & Statements gate: fee schedules, returns, imports, payments and the fee history stay inside each tenant.
-- Paste the whole file into the Supabase SQL editor (test project) after the fees migration, and run it. It creates two
-- fake tenants (example.com data only), runs the checks, then stops with an error whose message lists every result.
-- Stopping with an error is deliberate: it rolls everything back, so nothing is ever saved.
-- Each check runs the way the server does: as service_role with an x-tenant-id header, switched by the request hook.

do $$
declare
  msg text; passed int; total int; res text; who text; n bigint; n2 bigint; got uuid; tbl text;
  a uuid := '00000000-0000-4000-8000-0000000000f1';
  b uuid := '00000000-0000-4000-8000-0000000000f2';
  a_org uuid; b_org uuid; a_bank uuid; b_bank uuid; a_soft uuid;
  a_sched uuid; b_sched uuid; a_ret uuid; b_ret uuid; a_imp uuid; b_imp uuid; a_pay uuid; a_rec uuid;
begin
  create temp table gate_results (n serial, check_name text, pass boolean, detail text);
  grant all on gate_results to public;
  grant usage on sequence gate_results_n_seq to public;
  insert into public.tenants (id, slug, name) values (a, 'gate-fees-a', 'Gate Fees A'), (b, 'gate-fees-b', 'Gate Fees B');
  insert into public.organizations (tenant_id, legal_name) values (a, 'Gate Office A') returning id into a_org;
  insert into public.organizations (tenant_id, legal_name) values (b, 'Gate Office B') returning id into b_org;
  insert into public.bureau_options (tenant_id, kind, name) values (a, 'bank_product', 'Gate Bank A') returning id into a_bank;
  insert into public.bureau_options (tenant_id, kind, name) values (b, 'bank_product', 'Gate Bank B') returning id into b_bank;
  insert into public.bureau_options (tenant_id, kind, name) values (a, 'tax_software', 'Gate Software A') returning id into a_soft;
  insert into public.fee_schedules (tenant_id, name) values (a, 'A fees') returning id into a_sched;
  insert into public.fee_schedules (tenant_id, name) values (b, 'B fees') returning id into b_sched;
  insert into public.fee_lines (tenant_id, schedule_id, code, label, amount_cents) values (a, a_sched, 'service', 'Service', 7900), (b, b_sched, 'service', 'Service', 5000);
  insert into public.tax_returns (tenant_id, organization_id, tax_year, return_ref, taxpayer_name, bank_option_id) values (a, a_org, 2025, 'GATE-1', 'A Person', a_bank) returning id into a_ret;
  insert into public.tax_returns (tenant_id, organization_id, tax_year, return_ref, taxpayer_name, bank_option_id) values (b, b_org, 2025, 'GATE-1', 'B Person', b_bank) returning id into b_ret;
  insert into public.return_fees (tenant_id, return_id, code, label, amount_cents, applies) values (a, a_ret, 'service', 'Service', 7900, 'every_return'), (b, b_ret, 'service', 'Service', 5000, 'every_return');
  insert into public.bank_imports (tenant_id, bank_option_id, file_name, file_sha256, row_count, matched_count, unmatched_count) values (a, a_bank, 'a.csv', repeat('a', 64), 1, 1, 0) returning id into a_imp;
  insert into public.bank_imports (tenant_id, bank_option_id, file_name, file_sha256, row_count, matched_count, unmatched_count) values (b, b_bank, 'b.csv', repeat('b', 64), 1, 1, 0) returning id into b_imp;
  insert into public.fee_receipts (tenant_id, kind, organization_id, return_id, import_id, bank_option_id, collected_cents) values (a, 'bank', a_org, a_ret, a_imp, a_bank, 7900) returning id into a_rec;
  insert into public.fee_receipts (tenant_id, kind, organization_id, return_id, import_id, bank_option_id, collected_cents) values (b, 'bank', b_org, b_ret, b_imp, b_bank, 5000);
  insert into public.fee_csv_mappings (tenant_id, kind, mapping) values (a, 'bank', '{}'), (b, 'bank', '{}');
  insert into public.fee_events (tenant_id, entity, action) values (a, 'schedule', 'gate'), (b, 'schedule', 'gate');

  -- 1-8: each table, as the server runs for tenant A.
  foreach tbl in array array['fee_schedules', 'fee_lines', 'tax_returns', 'return_fees', 'bank_imports', 'fee_receipts', 'fee_csv_mappings', 'fee_events'] loop
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

  -- 9. A can't change B's return.
  update public.tax_returns set taxpayer_name = 'changed' where id = b_ret;
  get diagnostics n = row_count;
  insert into gate_results (check_name, pass, detail) values ('tax_returns: A changing B''s return changes nothing', n = 0, n || ' rows');

  -- 10. Writing into B is refused.
  begin
    insert into public.tax_returns (tenant_id, organization_id, tax_year, return_ref, taxpayer_name) values (b, b_org, 2025, 'X', 'X');
    res := 'allowed';
  exception when insufficient_privilege then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('tax_returns: A writing a return into B', res = 'refused', res);

  -- 11. New rows get A.
  insert into public.tax_returns (organization_id, tax_year, return_ref, taxpayer_name) values (a_org, 2025, 'GATE-2', 'A Two') returning tenant_id into got;
  insert into gate_results (check_name, pass, detail) values ('tax_returns: a return without tenant_id gets A', got = a, coalesce(got::text, 'null'));

  -- 12-14. Same-tenant keys: A's rows can't point at B's office, bank or return.
  begin
    insert into public.tax_returns (organization_id, tax_year, return_ref, taxpayer_name) values (b_org, 2025, 'GATE-3', 'Cross');
    res := 'allowed';
  exception when foreign_key_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('tax_returns: A return for B''s office', res = 'refused', res);
  begin
    insert into public.fee_lines (schedule_id, code, label, amount_cents, applies, bank_option_id) values (a_sched, 'bank_b', 'Bank B', 100, 'bank_product', b_bank);
    res := 'allowed';
  exception when foreign_key_violation or raise_exception then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('fee_lines: A line for B''s bank', res = 'refused', res);
  begin
    insert into public.fee_receipts (kind, organization_id, return_id, import_id, collected_cents) values ('bank', a_org, b_ret, a_imp, 1);
    res := 'allowed';
  exception when foreign_key_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('fee_receipts: A money linked to B''s return', res = 'refused', res);

  -- 15. The fee history can't be changed or deleted.
  begin
    update public.fee_events set action = 'changed' where tenant_id = a;
    res := 'allowed';
  exception when raise_exception then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('fee_events: history can''t be changed', res = 'refused', res);

  -- 16-17. Recorded money stays: amounts can't be edited, an ERO payment can't be deleted.
  begin
    update public.fee_receipts set collected_cents = 1 where id = a_rec;
    res := 'allowed';
  exception when raise_exception then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('fee_receipts: a collected amount can''t be edited', res = 'refused', res);
  insert into public.fee_receipts (kind, organization_id, return_id, collected_cents) values ('ero_payment', a_org, a_ret, 100) returning id into a_pay;
  begin
    delete from public.fee_receipts where id = a_pay;
    res := 'allowed';
  exception when raise_exception then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('fee_receipts: an ERO payment can''t be deleted', res = 'refused', res);

  -- 18. A bank line must name a bank product, not tax software.
  begin
    insert into public.fee_lines (schedule_id, code, label, amount_cents, applies, bank_option_id) values (a_sched, 'soft', 'Software', 100, 'bank_product', a_soft);
    res := 'allowed';
  exception when raise_exception then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('fee_lines: a "bank" that is tax software', res = 'refused', res);

  -- 19. A deleting B's schedule changes nothing.
  delete from public.fee_schedules where id = b_sched;
  get diagnostics n = row_count;
  insert into gate_results (check_name, pass, detail) values ('fee_schedules: A deleting B''s schedule changes nothing', n = 0, n || ' rows');

  reset role;
  perform set_config('app.tenant_id', '', true);
  perform set_config('request.headers', '', true);

  -- 20. Even with platform access, a return can't cross tenants.
  set local role service_role;
  begin
    insert into public.tax_returns (tenant_id, organization_id, tax_year, return_ref, taxpayer_name) values (a, b_org, 2025, 'GATE-4', 'Cross');
    res := 'allowed';
  exception when foreign_key_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('tax_returns: A return for B''s office, even as platform', res = 'refused', res);
  reset role;

  select count(*) filter (where g.pass), count(*), string_agg(format('%s. %s  %s  (%s)', g.n, case when g.pass then 'PASS' else 'FAIL' end, g.check_name, g.detail), E'\n' order by g.n)
    into passed, total, msg from gate_results g;
  -- Raising undoes everything above, so nothing is saved.
  raise exception E'GATE RESULT: % of % passed (rolled back, nothing saved)\n%', passed, total, msg;
end $$;
