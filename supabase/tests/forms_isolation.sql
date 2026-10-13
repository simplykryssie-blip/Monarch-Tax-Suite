-- Phase 2, Step 1, Piece 2 gate: tenant isolation and record-keeping rules for the Form Builder tables.
-- Runs inside a transaction that is rolled back; it creates two fake tenants (example.com data only) and leaves nothing.
-- Each check runs the way the server does: as service_role with an x-tenant-id header, switched by the request hook.

begin;
create temp table gate_results (n serial, check_name text, pass boolean, detail text) on commit drop;
grant all on gate_results to public;
grant usage on sequence gate_results_n_seq to public;
do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  b uuid := '00000000-0000-4000-8000-0000000000b2';
  t uuid; f uuid; v uuid; s uuid; cid uuid; got uuid; n integer;
  b_form uuid; b_version uuid; b_customer uuid; a_sub uuid; a_spam uuid;
  tbl text; who text; n_b bigint; n_list bigint; n_exp bigint; res text;
  def jsonb := '{"version":1,"pages":[],"rules":[]}';
begin
  insert into public.tenants (id, slug, name) values (a, 'gate-forms-a', 'Gate Forms A'), (b, 'gate-forms-b', 'Gate Forms B');
  foreach t in array array[a, b] loop
    insert into public.calculator_customers (tenant_id, email, full_name, status) values (t, 'gate-forms-' || right(t::text, 2) || '@example.com', 'Gate Client', 'active') returning id into cid;
    insert into public.forms (tenant_id, name, public_id, status) values (t, 'Gate form ' || right(t::text, 2), 'GateForm' || upper(right(t::text, 2)) || 'xxxxxx', 'published') returning id into f;
    insert into public.form_versions (tenant_id, form_id, version, definition) values (t, f, 1, def) returning id into v;
    s := gen_random_uuid();
    insert into public.form_submissions (id, tenant_id, form_id, version_id, number, status, answers, submitted_at, customer_id) values (s, t, f, v, 1, 'new', '{"full_name":"Gate"}', now(), cid);
    insert into public.form_uploads (tenant_id, form_id, submission_id, field_key, storage_path, file_name, content_type, size_bytes, status)
      values (t, f, s, 'photo_id', t || '/forms/' || f || '/' || s || '/' || gen_random_uuid(), 'id.png', 'image/png', 100, 'attached');
    insert into public.form_events (tenant_id, form_id, submission_id, type) values (t, f, s, 'submitted');
    if t = a then a_sub := s; end if;
    if t = b then b_form := f; b_version := v; b_customer := cid; end if;
  end loop;

  -- 1-5: each table, as the server runs for tenant A.
  foreach tbl in array array['forms', 'form_versions', 'form_submissions', 'form_uploads', 'form_events'] loop
    execute format('select count(*) from public.%I where tenant_id = $1', tbl) into n_exp using a;
    set local role service_role;
    perform set_config('request.headers', json_build_object('x-tenant-id', a)::text, true);
    perform public.pgrst_pre_request();
    who := current_user;
    execute format('select count(*) from public.%I where tenant_id = $1', tbl) into n_b using b;
    execute format('select count(*) from public.%I', tbl) into n_list;
    reset role;
    perform set_config('app.tenant_id', '', true);
    perform set_config('request.headers', '', true);
    insert into gate_results (check_name, pass, detail) values
      (tbl || ': as tenant_app, 0 of B visible, lists only A', who = 'tenant_app' and n_b = 0 and n_list = n_exp, who || ', B visible ' || n_b || ', listed ' || n_list || '/' || n_exp);
  end loop;

  -- 6-10: writes as tenant A.
  set local role service_role;
  perform set_config('request.headers', json_build_object('x-tenant-id', a)::text, true);
  perform public.pgrst_pre_request();
  begin
    insert into public.forms (tenant_id, name, public_id) values (b, 'Into B', 'GateIntoBxxxxxxx');
    res := 'allowed';
  exception when insufficient_privilege then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('forms: A inserting a form into B', res = 'refused', res);
  insert into public.forms (name, public_id) values ('No tenant given', 'GateNoTenantxxxx') returning tenant_id into got;
  insert into gate_results (check_name, pass, detail) values ('forms: insert without tenant_id gets A', got = a, coalesce(got::text, 'null'));
  n := public.form_take_number(b_form);
  insert into gate_results (check_name, pass, detail) values ('form_take_number: A cannot number B''s form', n is null, coalesce(n::text, 'null'));
  update public.forms set name = 'Changed by A' where id = b_form;
  get diagnostics n = row_count;
  insert into gate_results (check_name, pass, detail) values ('forms: A updating B''s form changes nothing', n = 0, n || ' rows');
  begin
    perform public.firm_from_submission(jsonb_build_object('org_id', gen_random_uuid(), 'loc_id', gen_random_uuid(), 'legal_name', 'Gate Firm LLC', 'office_name', 'Main', 'customer_id', b_customer,
      'people', jsonb_build_array(jsonb_build_object('person_id', gen_random_uuid(), 'full_name', 'Gate Person', 'role', 'ero'))));
    res := 'allowed';
  exception when foreign_key_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('firm_from_submission: A cannot link a firm to B''s customer', res = 'refused', res);
  got := public.firm_from_submission(jsonb_build_object('org_id', gen_random_uuid(), 'loc_id', gen_random_uuid(), 'legal_name', 'Gate Firm LLC', 'office_name', 'Main', 'relationship', 'partner',
      'people', jsonb_build_array(jsonb_build_object('person_id', gen_random_uuid(), 'full_name', 'Gate Person', 'role', 'ero'))));
  select count(*) into n from public.organizations o where o.id = got and o.tenant_id = a and exists (select 1 from public.office_locations l where l.organization_id = o.id) and exists (select 1 from public.organization_roles r where r.organization_id = o.id and r.role = 'responsible_official');
  insert into gate_results (check_name, pass, detail) values ('firm_from_submission: creates the firm in A with office and roles', n = 1, n || ' firm');
  reset role;
  perform set_config('app.tenant_id', '', true);
  perform set_config('request.headers', '', true);

  -- 11-12: same-tenant references hold even with platform access.
  set local role service_role;
  begin
    insert into public.form_submissions (id, tenant_id, form_id, version_id, status, answers) values (gen_random_uuid(), a, b_form, b_version, 'draft', '{}');
    res := 'allowed';
  exception when foreign_key_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('form_submissions: A submission on B''s form, even as platform', res = 'refused', res);
  begin
    update public.organizations set customer_id = b_customer where id = got;
    res := 'allowed';
  exception when foreign_key_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('organizations: A firm linked to B''s customer, even as platform', res = 'refused', res);

  -- 13-16: submissions are kept and locked; versions never change.
  begin
    update public.form_submissions set answers = '{"full_name":"Changed"}' where id = a_sub;
    res := 'allowed';
  exception when raise_exception then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('form_submissions: answers locked after submission', res = 'refused', res);
  begin
    delete from public.form_submissions where id = a_sub;
    res := 'allowed';
  exception when raise_exception then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('form_submissions: a real submission cannot be deleted', res = 'refused', res);
  select id into a_spam from public.form_submissions where id = a_sub;
  update public.form_submissions set status = 'spam' where id = a_sub;
  delete from public.form_submissions where id = a_sub;
  get diagnostics n = row_count;
  insert into gate_results (check_name, pass, detail) values ('form_submissions: spam can be emptied (with its uploads)', n = 1 and not exists (select 1 from public.form_uploads where submission_id = a_spam), n || ' deleted');
  begin
    update public.form_versions set definition = '{"version":1,"pages":[{"id":"x"}],"rules":[]}' where tenant_id = a;
    res := 'allowed';
  exception when raise_exception then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('form_versions: a published version cannot be changed', res = 'refused', res);
  reset role;
end $$;
select check_name, pass, detail from gate_results order by n;
rollback;
