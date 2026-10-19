-- Compliance Center gate: every compliance record stays inside its tenant, history can't be rewritten, and the 8879
-- retention date is worked out by the database.
-- Paste the whole file into the Supabase SQL editor (test project) after the compliance migration, and run it. It
-- creates two fake tenants (example.com data only), runs the checks, then stops with an error whose message lists
-- every result. Stopping with an error is deliberate: it rolls everything back, so nothing is ever saved.
-- Each check runs the way the server does: as service_role with an x-tenant-id header, switched by the request hook.

do $$
declare
  msg text; passed int; total int; res text; who text; n bigint; n2 bigint; got uuid; tbl text; d date;
  a uuid := '00000000-0000-4000-8000-0000000000c1';
  b uuid := '00000000-0000-4000-8000-0000000000c2';
  a_org uuid; b_org uuid; a_mem uuid; b_mem uuid; a_doc uuid; b_doc uuid; a_att uuid; b_att uuid; b_ret uuid; b_inc uuid; a_doc2 uuid;
begin
  create temp table gate_results (n serial, check_name text, pass boolean, detail text);
  grant all on gate_results to public;
  grant usage on sequence gate_results_n_seq to public;
  insert into public.tenants (id, slug, name) values (a, 'gate-comp-a', 'Gate Compliance A'), (b, 'gate-comp-b', 'Gate Compliance B');
  insert into public.organizations (tenant_id, legal_name) values (a, 'Gate Office A') returning id into a_org;
  insert into public.organizations (tenant_id, legal_name) values (b, 'Gate Office B') returning id into b_org;
  insert into public.office_members (tenant_id, organization_id, role, email, full_name, status) values (a, a_org, 'ero', 'gate-a@example.com', 'A Ero', 'active') returning id into a_mem;
  insert into public.office_members (tenant_id, organization_id, role, email, full_name, status) values (b, b_org, 'ero', 'gate-b@example.com', 'B Ero', 'active') returning id into b_mem;
  insert into public.tax_returns (tenant_id, organization_id, tax_year, return_ref, taxpayer_name) values (b, b_org, 2025, 'GATE-B', 'B Person') returning id into b_ret;
  insert into public.compliance_settings (tenant_id, organization_id) values (a, a_org), (b, b_org);
  insert into public.vault_documents (tenant_id, organization_id, kind, title, file_path, file_type, status) values (a, a_org, 'wisp', 'A WISP', 'gate/a.pdf', 'pdf', 'stored') returning id into a_doc;
  insert into public.vault_documents (tenant_id, organization_id, kind, title, file_path, file_type, status) values (b, b_org, 'wisp', 'B WISP', 'gate/b.pdf', 'pdf', 'stored') returning id into b_doc;
  insert into public.compliance_attestations (tenant_id, organization_id, source, document_id, statement, attested_name, review_due) values (a, a_org, 'uploaded', a_doc, 'Gate', 'A Ero', '2027-01-01') returning id into a_att;
  insert into public.compliance_attestations (tenant_id, organization_id, source, document_id, statement, attested_name, review_due) values (b, b_org, 'uploaded', b_doc, 'Gate', 'B Ero', '2027-01-01') returning id into b_att;
  insert into public.compliance_acks (tenant_id, organization_id, attestation_id, member_id, member_name) values (a, a_org, a_att, a_mem, 'A Ero'), (b, b_org, b_att, b_mem, 'B Ero');
  insert into public.form_8879_records (tenant_id, organization_id, tax_year, return_ref, taxpayer_name, signed_on, location, due_date) values (a, a_org, 2025, 'A-1', 'A Person', '2026-02-01', 'paper', '2026-04-15'), (b, b_org, 2025, 'B-1', 'B Person', '2026-02-01', 'paper', '2026-04-15');
  insert into public.ptin_renewals (tenant_id, organization_id, member_id, renewal_year, renewed) values (a, a_org, a_mem, 2027, false), (b, b_org, b_mem, 2027, false);
  insert into public.compliance_incidents (tenant_id, organization_id, title, discovered_on) values (a, a_org, 'A incident', '2026-10-01');
  insert into public.compliance_incidents (tenant_id, organization_id, title, discovered_on) values (b, b_org, 'B incident', '2026-10-01') returning id into b_inc;
  insert into public.compliance_items (tenant_id, organization_id, title) values (a, a_org, 'A item'), (b, b_org, 'B item');
  insert into public.compliance_events (tenant_id, organization_id, entity, action) values (a, a_org, 'settings', 'gate'), (b, b_org, 'settings', 'gate');
  insert into public.compliance_notices (tenant_id, organization_id, notice_key, recipient) values (a, a_org, 'gate', 'gate-a@example.com'), (b, b_org, 'gate', 'gate-b@example.com');

  -- 1-10: each table, as the server runs for tenant A.
  foreach tbl in array array['compliance_settings', 'vault_documents', 'compliance_attestations', 'compliance_acks', 'form_8879_records', 'ptin_renewals', 'compliance_incidents', 'compliance_items', 'compliance_events', 'compliance_notices'] loop
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

  -- 11. Writing into B is refused.
  begin
    insert into public.compliance_incidents (tenant_id, organization_id, title, discovered_on) values (b, b_org, 'X', '2026-10-01');
    res := 'allowed';
  exception when insufficient_privilege then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('compliance_incidents: A writing an incident into B', res = 'refused', res);

  -- 12. New rows get A.
  insert into public.compliance_items (organization_id, title) values (a_org, 'A item 2') returning tenant_id into got;
  insert into gate_results (check_name, pass, detail) values ('compliance_items: an item without tenant_id gets A', got = a, coalesce(got::text, 'null'));

  -- 13-15. Same-tenant keys: A's records can't point at B's return, member or office.
  begin
    insert into public.form_8879_records (organization_id, return_id, tax_year, return_ref, taxpayer_name, signed_on, location, due_date) values (a_org, b_ret, 2025, 'X', 'X', '2026-02-01', 'paper', '2026-04-15');
    res := 'allowed';
  exception when foreign_key_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('form_8879_records: A record for B''s return', res = 'refused', res);
  begin
    insert into public.compliance_acks (organization_id, attestation_id, member_id, member_name) values (a_org, a_att, b_mem, 'Cross');
    res := 'allowed';
  exception when foreign_key_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('compliance_acks: A acknowledgment by B''s member', res = 'refused', res);
  begin
    insert into public.vault_documents (organization_id, kind, title, file_path, file_type) values (b_org, 'other', 'Cross', 'gate/cross.pdf', 'pdf');
    res := 'allowed';
  exception when foreign_key_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('vault_documents: A file in B''s office', res = 'refused', res);

  -- 16-17. Attestations and history can't be rewritten.
  begin
    update public.compliance_attestations set attested_name = 'changed' where id = a_att;
    res := 'allowed';
  exception when raise_exception then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('compliance_attestations: an attestation can''t be changed', res = 'refused', res);
  begin
    delete from public.compliance_events where tenant_id = a;
    res := 'allowed';
  exception when raise_exception then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('compliance_events: history can''t be deleted', res = 'refused', res);

  -- 18-19. The 8879 retention date is the database's: the later of due date and IRS received date, plus 3 years.
  insert into public.form_8879_records (organization_id, tax_year, return_ref, taxpayer_name, signed_on, location, due_date, received_date, retention_until)
    values (a_org, 2025, 'A-2', 'A Two', '2026-02-01', 'vault', '2026-04-15', '2026-05-01', '2026-06-01') returning retention_until into d;
  insert into gate_results (check_name, pass, detail) values ('form_8879_records: received after due date, 3 years from received (typed date ignored)', d = '2029-05-01', d::text);
  insert into public.form_8879_records (organization_id, tax_year, return_ref, taxpayer_name, signed_on, location, due_date, received_date)
    values (a_org, 2025, 'A-3', 'A Three', '2026-02-01', 'software', '2026-10-15', '2026-04-10') returning retention_until into d;
  insert into gate_results (check_name, pass, detail) values ('form_8879_records: extended due date later, 3 years from due date', d = '2029-10-15', d::text);

  -- 20-21. A changing or deleting B's records changes nothing.
  update public.compliance_incidents set status = 'closed' where id = b_inc;
  get diagnostics n = row_count;
  insert into gate_results (check_name, pass, detail) values ('compliance_incidents: A closing B''s incident changes nothing', n = 0, n || ' rows');
  delete from public.vault_documents where id = b_doc;
  get diagnostics n = row_count;
  insert into gate_results (check_name, pass, detail) values ('vault_documents: A deleting B''s vault file changes nothing', n = 0, n || ' rows');

  -- 22. Removing a WISP file from the vault only unlinks it from the attestation, which is kept.
  insert into public.vault_documents (organization_id, kind, title, file_path, file_type, status) values (a_org, 'wisp', 'A WISP 2', 'gate/a2.pdf', 'pdf', 'stored') returning id into a_doc2;
  insert into public.compliance_attestations (organization_id, source, document_id, statement, attested_name, review_due) values (a_org, 'uploaded', a_doc2, 'Gate', 'A Ero', '2027-06-01') returning id into got;
  begin
    delete from public.vault_documents where id = a_doc2;
    select count(*) into n from public.compliance_attestations where id = got and document_id is null;
    res := case when n = 1 then 'kept, unlinked' else 'missing' end;
  exception when others then res := 'error: ' || sqlerrm;
  end;
  insert into gate_results (check_name, pass, detail) values ('compliance_attestations: deleting its vault file keeps the attestation', res = 'kept, unlinked', res);

  reset role;
  perform set_config('app.tenant_id', '', true);
  perform set_config('request.headers', '', true);

  -- 23. Even with platform access, a record can't cross tenants.
  set local role service_role;
  begin
    insert into public.compliance_incidents (tenant_id, organization_id, title, discovered_on) values (a, b_org, 'Cross', '2026-10-01');
    res := 'allowed';
  exception when foreign_key_violation then res := 'refused';
  end;
  insert into gate_results (check_name, pass, detail) values ('compliance_incidents: A incident in B''s office, even as platform', res = 'refused', res);
  reset role;

  select count(*) filter (where g.pass), count(*), string_agg(format('%s. %s  %s  (%s)', g.n, case when g.pass then 'PASS' else 'FAIL' end, g.check_name, g.detail), E'\n' order by g.n)
    into passed, total, msg from gate_results g;
  -- Raising undoes everything above, so nothing is saved.
  raise exception E'GATE RESULT: % of % passed (rolled back, nothing saved)\n%', passed, total, msg;
end $$;
