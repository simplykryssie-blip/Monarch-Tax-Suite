-- Phase 2 Step 1, Piece 1 verification gate: the document, sending and package-attribute tables are tenant-scoped.
-- Run against the TEST project only. Everything is rolled back; test data only (example.com).
-- Output: one row per check with pass = true/false.

begin;
create temp table gate_results (n serial, check_name text, pass boolean, detail text) on commit drop;
grant all on gate_results to public;
grant usage on sequence gate_results_n_seq to public;

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  b uuid := '00000000-0000-4000-8000-0000000000b2';
  t uuid; d uuid; v uuid; dl uuid; dom uuid; cid uuid;
  tbl text; who text; n_b bigint; n_list bigint; n_exp bigint; res text; got uuid;
  b_doc uuid;
begin
  insert into public.tenants (id, slug, name) values (a, 'gate-tenant-a', 'Gate Tenant A'), (b, 'gate-tenant-b', 'Gate Tenant B');
  foreach t in array array[a, b] loop
    insert into public.tenant_profiles (tenant_id, legal_name, display_name) values (t, 'Gate Firm ' || right(t::text, 2), 'Gate ' || right(t::text, 2));
    insert into public.calculator_customers (tenant_id, email, full_name, status) values (t, 'gate-docs-' || right(t::text, 2) || '@example.com', 'Gate Client', 'active') returning id into cid;
    insert into public.documents (tenant_id, name, file_type, signature_consent) values (t, 'Gate letter ' || right(t::text, 2), 'pdf', 'I agree to sign this document electronically, for the gate test.') returning id into d;
    insert into public.document_versions (tenant_id, document_id, version, storage_path, file_name, size_bytes, sha256, status)
      values (t, d, 1, t || '/versions/' || d || '/' || gen_random_uuid(), 'gate.pdf', 100, repeat('a', 64), 'ready') returning id into v;
    insert into public.document_deliveries (tenant_id, document_id, version_id, kind, customer_id, recipient_email, storage_path, file_name, sha256, token_hash, expires_at)
      values (t, d, v, 'signature', cid, 'gate@example.com', t || '/deliveries/' || gen_random_uuid() || '.pdf', 'gate.pdf', repeat('b', 64), encode(sha256(gen_random_bytes(16)), 'hex'), now() + interval '1 day') returning id into dl;
    insert into public.signature_requests (tenant_id, delivery_id, document_id, signer_email, consent_text, expires_at, original_sha256)
      values (t, dl, d, 'gate@example.com', 'I agree to sign this document electronically, for the gate test.', now() + interval '1 day', repeat('b', 64));
    insert into public.document_events (tenant_id, document_id, type) values (t, d, 'gate');
    insert into public.email_domains (tenant_id, domain, status) values (t, 'gate-' || right(t::text, 2) || '.example.com', 'verified') returning id into dom;
    insert into public.email_senders (tenant_id, domain_id, from_name, local_part) values (t, dom, 'Gate Sender', 'office');
    insert into public.package_attributes (tenant_id, key, label, kind, options) values (t, 'flow_type', 'Flow type', 'choice', array['one','two']);
    if t = b then b_doc := d; end if;
  end loop;
  insert into gate_results (check_name, pass, detail) values ('same package attribute key in two tenants', true, 'allowed');

  foreach tbl in array array['tenant_profiles', 'documents', 'document_versions', 'document_deliveries', 'signature_requests', 'document_events', 'email_domains', 'email_senders', 'package_attributes'] loop
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

  set local role service_role;
  perform set_config('request.headers', json_build_object('x-tenant-id', a)::text, true);
  perform public.pgrst_pre_request();
  begin
    insert into public.documents (tenant_id, name, file_type) values (b, 'Into B', 'pdf');
    res := 'allowed';
  exception when insufficient_privilege then res := 'refused';
  end;
  insert into public.package_attributes (key, label, kind, options) values ('mentorship', 'Mentorship', 'choice', array['yes','no']) returning tenant_id into got;
  reset role;
  perform set_config('app.tenant_id', '', true);
  perform set_config('request.headers', '', true);
  insert into gate_results (check_name, pass, detail) values ('documents: A inserting a row into B', res = 'refused', res), ('package_attributes: insert without tenant_id gets A', got = a, coalesce(got::text, 'null'));

  set local role service_role;
  begin
    insert into public.document_versions (tenant_id, document_id, version, storage_path, file_name, size_bytes, status)
      values (a, b_doc, 9, a || '/versions/' || b_doc || '/' || gen_random_uuid(), 'xy.pdf', 10, 'pending');
    res := 'allowed';
  exception when foreign_key_violation then res := 'refused';
  end;
  reset role;
  insert into gate_results (check_name, pass, detail) values ('document_versions: A version on B document, even as platform', res = 'refused', res);
end $$;

select check_name, pass, detail from gate_results order by n;
rollback;
