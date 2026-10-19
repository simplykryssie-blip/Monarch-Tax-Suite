-- Phase 5c gate: client portal, documents, signing and online payments. Run it in the SQL editor of the TEST project after
-- 20261111090000 .. 20261114090000. Two throwaway tenants and example.com data only. It never commits: it ends by raising
-- an exception carrying the results, so everything it did is rolled back. Every line of the message should start with PASS.
--
-- Server requests are simulated as PostgREST runs them: SET LOCAL ROLE service_role, request.headers carrying
-- x-tenant-id, then public.pgrst_pre_request() (which switches to tenant_app for that tenant).

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a9';
  b uuid := '00000000-0000-4000-8000-0000000000b9';
  r text[] := '{}';
  n bigint;
  outcome text;
  a_client uuid; a_client2 uuid; b_client uuid; b_inv uuid; a_inv uuid; a_req uuid; b_req uuid; b_member uuid; b_pay uuid; a_pay uuid; a_pay2 uuid;
  paid_total integer; inv_status text;
begin
  insert into public.tenants (id, slug, name, tier) values (a, 'gate-p5c-a', 'Gate P5c Tenant A', 'bureau'), (b, 'gate-p5c-b', 'Gate P5c Tenant B', 'bureau');
  insert into public.clients (tenant_id, full_name, email) values (a, 'A Client', 'a-client@example.com') returning id into a_client;
  insert into public.clients (tenant_id, full_name, email) values (a, 'A Client Two', 'a-client2@example.com') returning id into a_client2;
  insert into public.clients (tenant_id, full_name, email) values (b, 'B Client', 'b-client@example.com') returning id into b_client;
  insert into public.invoices (tenant_id, client_id, number, tax_year, status, lines, total_cents) values (b, b_client, 'INV-9001', 2025, 'sent', '[]'::jsonb, 22300) returning id into b_inv;
  insert into public.invoices (tenant_id, client_id, number, tax_year, status, lines, total_cents) values (a, a_client, 'INV-9002', 2025, 'sent', '[]'::jsonb, 22300) returning id into a_inv;
  insert into public.portal_members (tenant_id, client_id, email, full_name) values (b, b_client, 'b-client@example.com', 'B Client') returning id into b_member;
  insert into public.portal_doc_requests (tenant_id, client_id, title) values (b, b_client, 'B request') returning id into b_req;
  insert into public.payment_connections (tenant_id, stripe_account_id, livemode, charges_enabled) values (b, 'acct_1GateBBBBBB', false, true);
  insert into public.invoice_payments (tenant_id, invoice_id, client_id, stripe_account_id, stripe_session_id, amount_cents) values (b, b_inv, b_client, 'acct_1GateBBBBBB', 'cs_test_gateB0001', 22300) returning id into b_pay;
  insert into public.tenant_profiles (tenant_id, legal_name, display_name) values (a, 'Gate A LLC', 'Gate A');

  -- ------------------------------------------------------------ as tenant A's server request
  set local role service_role;
  perform set_config('request.headers', json_build_object('x-tenant-id', a)::text, true);
  perform public.pgrst_pre_request();
  r := r || format('%s server request runs as tenant_app (%s)', case when current_user = 'tenant_app' then 'PASS' else 'FAIL' end, current_user);

  select count(*) into n from public.portal_members;
  r := r || format('%s portal_members: A sees none of B''s (%s)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.portal_doc_requests;
  r := r || format('%s portal_doc_requests: A sees none of B''s (%s)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.payment_connections;
  r := r || format('%s payment_connections: A sees none of B''s (%s)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.invoice_payments;
  r := r || format('%s invoice_payments: A sees none of B''s (%s)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  -- portal sign-in
  insert into public.portal_members (client_id, email, full_name, invite_token_hash) values (a_client, 'a-client@example.com', 'A Client', repeat('a', 64));
  select count(*) into n from public.portal_members;
  r := r || format('%s A can invite its own client (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  begin
    insert into public.portal_members (client_id, email, full_name) values (b_client, 'x@example.com', 'x');
    outcome := 'allowed';
  exception when foreign_key_violation then outcome := 'refused';
  end;
  r := r || format('%s a portal login for another tenant''s client is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.portal_members (client_id, email, full_name) values (a_client, 'again@example.com', 'again');
    outcome := 'allowed';
  exception when unique_violation then outcome := 'refused';
  end;
  r := r || format('%s a second portal login for the same client is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.portal_members (client_id, email, full_name, invite_token_hash) values (a_client2, 'a2@example.com', 'a2', repeat('a', 64));
    outcome := 'allowed';
  exception when unique_violation then outcome := 'refused';
  end;
  r := r || format('%s a reused invite token is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.portal_members (client_id, email, full_name, invite_token_hash) values (a_client2, 'a3@example.com', 'a3', 'not-a-hash');
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s a malformed token hash is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.portal_members (client_id, email, full_name) values (a_client2, 'Mixed@Example.com', 'mixed');
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s a mixed-case email is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  -- documents
  insert into public.portal_doc_requests (client_id, title) values (a_client, 'A request') returning id into a_req;
  begin
    insert into public.portal_doc_requests (client_id, title) values (b_client, 'x');
    outcome := 'allowed';
  exception when foreign_key_violation then outcome := 'refused';
  end;
  r := r || format('%s a document request for another tenant''s client is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.client_docs (client_id, title, file_path, file_type, status, request_id) values (a_client, 't', 'gate/p5c/x.pdf', 'pdf', 'stored', b_req);
    outcome := 'allowed';
  exception when foreign_key_violation then outcome := 'refused';
  end;
  r := r || format('%s a document answering another tenant''s request is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  insert into public.client_docs (client_id, title, file_path, file_type, status, request_id) values (a_client, 'ok', 'gate/p5c/y.pdf', 'pdf', 'stored', a_req);
  select count(*) into n from public.client_docs where title = 'ok' and shared_with_client = false and source = 'staff';
  r := r || format('%s a new document is not shared with the client by default (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  begin
    insert into public.client_docs (client_id, title, file_path, file_type, status, source) values (a_client, 't', 'gate/p5c/z.pdf', 'pdf', 'stored', 'stranger');
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s an unknown document source is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  -- signing
  begin
    update public.tenant_profiles set ptin = 'P1234' where tenant_id = a;
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s a malformed PTIN is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    update public.tenant_profiles set caf_number = 'abc' where tenant_id = a;
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s a malformed CAF number is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  -- payments
  begin
    insert into public.invoice_payments (invoice_id, client_id, stripe_account_id, amount_cents) values (b_inv, a_client, 'acct_1GateAAAAAA', 22300);
    outcome := 'allowed';
  exception when foreign_key_violation then outcome := 'refused';
  end;
  r := r || format('%s a payment against another tenant''s invoice is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  insert into public.payment_connections (stripe_account_id, livemode, charges_enabled) values ('acct_1GateAAAAAA', false, true);
  insert into public.invoice_payments (invoice_id, client_id, stripe_account_id, stripe_session_id, amount_cents) values (a_inv, a_client, 'acct_1GateAAAAAA', 'cs_test_gateA0001', 12300) returning id into a_pay;
  begin
    insert into public.invoice_payments (invoice_id, client_id, stripe_account_id, amount_cents) values (a_inv, a_client, 'acct_1GateAAAAAA', 5000);
    outcome := 'allowed';
  exception when unique_violation then outcome := 'refused';
  end;
  r := r || format('%s a second open payment for one invoice is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.invoice_payments (invoice_id, client_id, stripe_account_id, stripe_session_id, amount_cents) values (a_inv, a_client, 'acct_1GateAAAAAA', 'cs_test_gateA0001', 100);
    outcome := 'allowed';
  exception when unique_violation then outcome := 'refused';
  end;
  r := r || format('%s one Checkout Session on two payments is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.invoice_payments (invoice_id, client_id, stripe_account_id, amount_cents, status) values (a_inv, a_client, 'acct_1GateAAAAAA', 10, 'paid');
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s a payment under 50 cents is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  -- applying a payment
  perform public.portal_apply_payment(b_pay, 'pi_gate_b');
  reset role;
  select count(*) into n from public.invoice_payments where id = b_pay and status = 'open';
  r := r || format('%s A cannot apply B''s payment (still open: %s)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  set local role service_role;
  perform set_config('request.headers', json_build_object('x-tenant-id', a)::text, true);
  perform public.pgrst_pre_request();

  select count(*) into n from public.portal_apply_payment(a_pay, 'pi_gate_a');
  r := r || format('%s the first apply returns the invoice (%s row)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  select paid_cents, status into paid_total, inv_status from public.invoices where id = a_inv;
  r := r || format('%s the invoice has the partial payment and stays open (%s, %s)', case when paid_total = 12300 and inv_status = 'sent' then 'PASS' else 'FAIL' end, paid_total, inv_status);
  select count(*) into n from public.portal_apply_payment(a_pay, 'pi_gate_a');
  r := r || format('%s a repeat apply does nothing (%s rows)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select paid_cents into paid_total from public.invoices where id = a_inv;
  r := r || format('%s and the invoice is not charged twice (%s)', case when paid_total = 12300 then 'PASS' else 'FAIL' end, paid_total);
  insert into public.invoice_payments (invoice_id, client_id, stripe_account_id, stripe_session_id, amount_cents) values (a_inv, a_client, 'acct_1GateAAAAAA', 'cs_test_gateA0002', 20000) returning id into a_pay2;
  perform public.portal_apply_payment(a_pay2, null);
  select paid_cents, status into paid_total, inv_status from public.invoices where id = a_inv;
  r := r || format('%s an over-payment is capped at the total and the invoice becomes paid (%s, %s)', case when paid_total = 22300 and inv_status = 'paid' then 'PASS' else 'FAIL' end, paid_total, inv_status);

  -- ------------------------------------------------------------ back as the platform
  reset role;
  select count(*) into n from public.portal_members where id = b_member;
  r := r || format('%s B''s portal login is untouched (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  begin
    insert into public.payment_connections (tenant_id, stripe_account_id, livemode) values (b, 'acct_1GateCCCCCC', false);
    outcome := 'allowed';
  exception when unique_violation then outcome := 'refused';
  end;
  r := r || format('%s a second Stripe account for one office is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.payment_connections (tenant_id, stripe_account_id, livemode) values (a, 'acct_1GateBBBBBB', false);
    outcome := 'allowed';
  exception when unique_violation then outcome := 'refused';
  end;
  r := r || format('%s one Stripe account connected to two offices is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  select count(*) into n from pg_constraint c join pg_class t on t.oid = c.conrelid
    where t.relname in ('portal_members', 'portal_doc_requests', 'invoice_payments') and c.contype = 'f' and c.conname not like '%\_same\_tenant'
      and c.confrelid::regclass::text not in ('tenants', 'public.tenants', 'auth.users');
  r := r || format('%s the new tables have no foreign key that leaves the tenant (%s unexpected)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  select count(*) into n from unnest(array['portal_members', 'portal_doc_requests', 'payment_connections', 'invoice_payments']) t
    where has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'select');
  r := r || format('%s anon and signed-in users can''t read the new tables directly (%s open)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from unnest(array['portal_members', 'portal_doc_requests', 'payment_connections', 'invoice_payments']) t
    where not exists (select 1 from pg_class where oid = ('public.' || t)::regclass and relrowsecurity);
  r := r || format('%s row-level security is on for all four new tables (%s without)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from unnest(array['portal_members', 'portal_doc_requests', 'payment_connections', 'invoice_payments']) t
    where (select count(*) from pg_policies where schemaname = 'public' and tablename = t and policyname in ('tenant_isolation', 'tenant_members_only')) <> 2;
  r := r || format('%s each new table has both tenant policies (%s without)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  r := r || format('%s the apply function is not callable by signed-in or anonymous users', case when not has_function_privilege('anon', 'public.portal_apply_payment(uuid, text)', 'execute') and not has_function_privilege('authenticated', 'public.portal_apply_payment(uuid, text)', 'execute') then 'PASS' else 'FAIL' end);
  select count(*) into n from storage.buckets where id = 'tenant-documents' and public = false and 'image/png' = any(allowed_mime_types) and 'image/jpeg' = any(allowed_mime_types);
  r := r || format('%s the documents bucket is private and accepts JPG and PNG (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);

  raise exception E'PHASE 5c GATE RESULTS (rolled back, nothing kept):\n%', array_to_string(r, E'\n');
end $$;
