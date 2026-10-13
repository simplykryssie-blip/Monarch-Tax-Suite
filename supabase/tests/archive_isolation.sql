-- Platform gate: archive, restore and the archive history stay inside each tenant.
-- Paste the whole file into the Supabase SQL editor (test project) after the archive migration, and run it. It creates
-- three fake tenants (example.com data only), runs 14 checks, then stops with an error whose message lists every
-- result. Stopping with an error is deliberate: it rolls everything back, so nothing is ever saved.
-- Each check runs the way the server does: as service_role with an x-tenant-id header, switched by the request hook.

do $$
declare
  msg text; passed int; total int; res text; who text; n bigint; n2 bigint;
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  b uuid := '00000000-0000-4000-8000-0000000000b2';
  c uuid := '00000000-0000-4000-8000-0000000000c3';
  a_cust uuid; a_old uuid; b_cust uuid; b_arch uuid; a_form uuid; got uuid; stamped_at timestamptz; stamped_by uuid;
begin
  create temp table gate_results (n serial, check_name text, pass boolean, detail text);
  grant all on gate_results to public;
  grant usage on sequence gate_results_n_seq to public;
  insert into public.tenants (id, slug, name) values (a, 'gate-archive-a', 'Gate Archive A'), (b, 'gate-archive-b', 'Gate Archive B'), (c, 'gate-archive-c', 'Gate Archive C');
  insert into public.calculator_customers (tenant_id, email, full_name, status) values (a, 'gate-a-current@example.com', 'A Current', 'active') returning id into a_cust;
  insert into public.calculator_customers (tenant_id, email, full_name, status, archived_at, archive_reason) values (a, 'gate-a-old@example.com', 'A Old', 'active', now(), 'test record') returning id into a_old;
  insert into public.calculator_customers (tenant_id, email, full_name, status) values (b, 'gate-b-current@example.com', 'B Current', 'active') returning id into b_cust;
  insert into public.calculator_customers (tenant_id, email, full_name, status, archived_at) values (b, 'gate-b-old@example.com', 'B Old', 'active', now()) returning id into b_arch;
  insert into public.archive_log (tenant_id, entity, record_id, action, label) values (a, 'customer', a_old, 'archived', 'A Old'), (b, 'customer', b_arch, 'archived', 'B Old');
  insert into public.forms (tenant_id, name, public_id, status) values (a, 'Gate archive form', 'GateArchiveFormA1', 'draft') returning id into a_form;

  -- 1. The columns are on every archivable table, so every tenant (new ones included) has them.
  select count(*) into n from information_schema.columns where table_schema = 'public' and column_name in ('archived_at', 'archived_by', 'archive_reason')
    and table_name in ('calculator_customers', 'orders', 'calculator_licenses', 'products', 'service_orders', 'documents', 'automation_workflows', 'forms');
  insert into gate_results (check_name, pass, detail) values ('8 tables carry archived_at, archived_by, archive_reason', n = 24, n || ' of 24 columns');

  -- As tenant A.
  set local role service_role;
  perform set_config('request.headers', json_build_object('x-tenant-id', a)::text, true);
  perform public.pgrst_pre_request();
  who := current_user;

  select count(*) into n from public.archive_log where tenant_id = b;
  select count(*) into n2 from public.archive_log;
  insert into gate_results (check_name, pass, detail) values ('archive_log: as tenant_app, 0 of B visible, lists only A', who = 'tenant_app' and n = 0 and n2 = 1, who || ', B visible ' || n || ', listed ' || n2);

  select count(*) into n from public.calculator_customers where archived_at is not null and tenant_id = b;
  insert into gate_results (check_name, pass, detail) values ('customers: none of B''s archived records visible to A', n = 0, n || ' visible');

  select count(*) into n from public.calculator_customers where archived_at is null;
  select count(*) into n2 from public.calculator_customers where archived_at is not null;
  insert into gate_results (check_name, pass, detail) values ('customers: A''s default list hides its archived row; the Archived tab has it', n = 1 and n2 = 1, n || ' current, ' || n2 || ' archived');

  update public.calculator_customers set archived_at = now(), archived_by = a where id = b_cust;
  get diagnostics n = row_count;
  insert into gate_results (check_name, pass, detail) values ('customers: A archiving B''s customer changes nothing', n = 0, n || ' rows');

  update public.calculator_customers set archived_at = null where id = b_arch;
  get diagnostics n = row_count;
  insert into gate_results (check_name, pass, detail) values ('customers: A restoring B''s archived customer changes nothing', n = 0, n || ' rows');

  delete from public.calculator_customers where id in (b_cust, b_arch);
  get diagnostics n = row_count;
  insert into gate_results (check_name, pass, detail) values ('customers: A deleting B''s customers changes nothing', n = 0, n || ' rows');

  begin
    insert into public.archive_log (tenant_id, entity, record_id, action, label) values (b, 'customer', b_cust, 'archived', 'Into B');
    res := 'allowed';
  exception when insufficient_privilege then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('archive_log: A writing history into B', res = 'refused', res);

  insert into public.archive_log (entity, record_id, action, label) values ('customer', a_cust, 'archived', 'No tenant given') returning tenant_id into got;
  insert into gate_results (check_name, pass, detail) values ('archive_log: history without tenant_id gets A', got = a, coalesce(got::text, 'null'));

  begin
    update public.archive_log set reason = 'changed' where tenant_id = a;
    res := 'allowed';
  exception when raise_exception or insufficient_privilege then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('archive_log: history can''t be changed', res = 'refused', res);

  begin
    delete from public.archive_log where tenant_id = a;
    res := 'allowed';
  exception when raise_exception or insufficient_privilege then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('archive_log: history can''t be deleted', res = 'refused', res);

  update public.forms set status = 'archived', archived_by = a, archive_reason = 'gate' where id = a_form;
  select f.archived_at, f.archived_by into stamped_at, stamped_by from public.forms f where f.id = a_form;
  insert into gate_results (check_name, pass, detail) values ('forms: archiving by status stamps archived_at', stamped_at is not null and stamped_by = a, coalesce(stamped_at::text, 'null'));
  update public.forms set status = 'draft' where id = a_form;
  select f.archived_at, f.archived_by into stamped_at, stamped_by from public.forms f where f.id = a_form;
  insert into gate_results (check_name, pass, detail) values ('forms: restoring by status clears archived_at/by', stamped_at is null and stamped_by is null, coalesce(stamped_at::text, 'null'));

  reset role;
  perform set_config('app.tenant_id', '', true);
  perform set_config('request.headers', '', true);

  -- A brand-new tenant has the whole pattern from its first request.
  set local role service_role;
  perform set_config('request.headers', json_build_object('x-tenant-id', c)::text, true);
  perform public.pgrst_pre_request();
  insert into public.calculator_customers (email, full_name, status) values ('gate-c@example.com', 'C New', 'active') returning id into got;
  update public.calculator_customers set archived_at = now(), archived_by = c, archive_reason = 'new tenant' where id = got;
  get diagnostics n = row_count;
  insert into public.archive_log (entity, record_id, action, label) values ('customer', got, 'archived', 'C New');
  select count(*) into n2 from public.archive_log;
  insert into gate_results (check_name, pass, detail) values ('new tenant C: archives and records history from day one, sees only its own', n = 1 and n2 = 1, n || ' archived, ' || n2 || ' history rows visible');
  reset role;
  perform set_config('app.tenant_id', '', true);
  perform set_config('request.headers', '', true);

  select count(*) filter (where g.pass), count(*), string_agg(format('%s. %s  %s  (%s)', g.n, case when g.pass then 'PASS' else 'FAIL' end, g.check_name, g.detail), E'\n' order by g.n)
    into passed, total, msg from gate_results g;
  -- Raising undoes everything above, so nothing is saved.
  raise exception E'GATE RESULT: % of % passed (rolled back, nothing saved)\n%', passed, total, msg;
end $$;
