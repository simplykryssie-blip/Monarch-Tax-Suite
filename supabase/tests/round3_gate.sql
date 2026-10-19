-- Round 3 gate: Forms Delete (with submissions) and texting billing (credits ledger). Run it in the SQL editor of the
-- TEST project after 20261102090000_forms_delete and 20261103090000_sms_billing. Two throwaway tenants and example.com
-- data only. It never commits: it ends by raising an exception carrying the results, so everything it did is rolled
-- back. Every line of the message should start with PASS.
--
-- Server requests are simulated as PostgREST runs them: SET LOCAL ROLE service_role, request.headers carrying
-- x-tenant-id, then public.pgrst_pre_request() (which switches to tenant_app for that tenant).

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a3';
  b uuid := '00000000-0000-4000-8000-0000000000b4';
  r text[] := '{}';
  n bigint;
  ok boolean;
  outcome text;
  fa uuid := gen_random_uuid(); va uuid := gen_random_uuid(); sa uuid := gen_random_uuid(); sa2 uuid := gen_random_uuid();
  fb uuid := gen_random_uuid(); vb uuid := gen_random_uuid(); sb uuid := gen_random_uuid();
  cust uuid; lead uuid;
  sess_a text := 'cs_test_gateRound3TenantA0001';
  sess_b text := 'cs_test_gateRound3TenantB0001';
begin
  insert into public.tenants (id, slug, name) values (a, 'gate-r3-a', 'Gate R3 Tenant A'), (b, 'gate-r3-b', 'Gate R3 Tenant B');
  -- Tenant B: a form with a submission, and a credit-pack checkout (fake).
  insert into public.forms (id, tenant_id, name, public_id) values (fb, b, 'Gate B form', 'GateR3FormBBBBBB');
  insert into public.form_versions (id, tenant_id, form_id, version, definition) values (vb, b, fb, 1, '{}');
  insert into public.form_submissions (id, tenant_id, form_id, version_id, number, status, submitted_at) values (sb, b, fb, vb, 1, 'new', now());
  insert into public.sms_checkouts (tenant_id, stripe_session_id, purpose, packs, credits, amount_cents) values (b, sess_b, 'credits', 1, 1000, 2500);

  set local role service_role;
  perform set_config('request.headers', json_build_object('x-tenant-id', a)::text, true);
  perform public.pgrst_pre_request();
  r := r || format('%s server request runs as tenant_app (%s)', case when current_user = 'tenant_app' then 'PASS' else 'FAIL' end, current_user);

  -- ---------------------------------------------------------------- Forms: Delete with submissions
  insert into public.calculator_customers (email, full_name) values ('gate.r3@example.com', 'Gate Customer') returning id into cust;
  insert into public.leads (full_name, email, source) values ('Gate Lead', 'gate.r3@example.com', 'manual') returning id into lead;
  insert into public.forms (id, name, public_id) values (fa, 'Gate A form', 'GateR3FormAAAAAA');
  insert into public.form_versions (id, form_id, version, definition) values (va, fa, 1, '{}');
  update public.forms set current_version_id = va where id = fa;
  insert into public.form_submissions (id, form_id, version_id, number, status, submitted_at, customer_id) values (sa, fa, va, 1, 'new', now(), cust), (sa2, fa, va, 2, 'done', now(), cust);
  insert into public.form_uploads (form_id, submission_id, field_key, storage_path, file_name, content_type, size_bytes)
    values (fa, sa, 'photo_id', a || '/forms/' || fa || '/' || sa || '/' || gen_random_uuid(), 'id.jpg', 'image/jpeg', 100);

  begin
    delete from public.form_submissions where id = sa;
    outcome := 'allowed';
  exception when others then outcome := case when sqlerrm like 'SUBMISSION_KEPT%' then 'refused' else sqlerrm end;
  end;
  r := r || format('%s a submitted form can''t be deleted directly (%s)', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  begin
    perform public.delete_form_with_submissions(fb);
    outcome := 'allowed';
  exception when others then outcome := case when sqlerrm like 'FORM_NOT_FOUND%' then 'refused' else sqlerrm end;
  end;
  r := r || format('%s A deleting B''s form is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  n := public.delete_form_with_submissions(fa);
  r := r || format('%s Delete with submissions removes the form''s %s submissions', case when n = 2 then 'PASS' else 'FAIL' end, n);
  select (select count(*) from public.forms where id = fa) + (select count(*) from public.form_versions where form_id = fa) + (select count(*) from public.form_submissions where form_id = fa) + (select count(*) from public.form_uploads where form_id = fa) into n;
  r := r || format('%s the form, its versions, submissions and uploads are gone (%s left)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select (select count(*) from public.calculator_customers where id = cust) + (select count(*) from public.leads where id = lead) into n;
  r := r || format('%s the customer and the lead are kept (%s of 2)', case when n = 2 then 'PASS' else 'FAIL' end, n);
  r := r || format('%s the delete permission doesn''t outlive the call (%s)', case when coalesce(current_setting('app.deleting_form', true), '') = '' then 'PASS' else 'FAIL' end, coalesce(current_setting('app.deleting_form', true), ''));

  -- ---------------------------------------------------------------- Texting credits: read-only ledger
  begin
    insert into public.sms_credit_ledger (delta, kind, note) values (5000, 'purchase', 'manual');
    outcome := 'allowed';
  exception when insufficient_privilege then outcome := 'refused';
  end;
  r := r || format('%s writing credits into the ledger directly is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  insert into public.sms_checkouts (stripe_session_id, purpose, packs, credits, amount_cents) values (sess_a, 'credits', 1, 1000, 2500);
  n := public.credit_sms_purchase(sess_a);
  n := public.credit_sms_purchase(sess_a);
  select coalesce(sum(delta), 0) into n from public.sms_credit_ledger;
  r := r || format('%s a paid pack is credited once (%s credits after two calls)', case when n = 1000 then 'PASS' else 'FAIL' end, n);
  begin
    perform public.credit_sms_purchase(sess_b);
    outcome := 'allowed';
  exception when others then outcome := case when sqlerrm like 'SMS_CHECKOUT_NOT_FOUND%' then 'refused' else sqlerrm end;
  end;
  r := r || format('%s A claiming B''s checkout is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  ok := public.spend_sms_credits(2, 'gate-text-1');
  n := public.reverse_sms_send('gate-text-1');
  n := public.reverse_sms_send('gate-text-1');
  select coalesce(sum(delta), 0) into n from public.sms_credit_ledger;
  r := r || format('%s a refused text gets its credits back once (%s)', case when ok and n = 1000 then 'PASS' else 'FAIL' end, n);

  ok := public.charge_sms_renewal(110, '2026-11-16', 'Toll-free texting number, monthly');
  ok := ok and public.charge_sms_renewal(110, '2026-11-16', 'Toll-free texting number, monthly');
  select coalesce(sum(delta), 0) into n from public.sms_credit_ledger;
  r := r || format('%s the monthly renewal is taken once per period (%s left)', case when ok and n = 890 then 'PASS' else 'FAIL' end, n);
  ok := public.charge_sms_renewal(5000, '2026-12-16', 'Toll-free texting number, monthly');
  r := r || format('%s a renewal the balance doesn''t cover takes nothing (%s)', case when not ok then 'PASS' else 'FAIL' end, ok);

  n := public.forfeit_sms_credits('forfeit:2026-11-16');
  r := r || format('%s forfeiting takes the whole balance (%s)', case when n = 890 then 'PASS' else 'FAIL' end, n);
  select coalesce(sum(delta), 0) into n from public.sms_credit_ledger;
  r := r || format('%s the balance is then 0 (%s), and B''s ledger is never seen', case when n = 0 then 'PASS' else 'FAIL' end, n);

  reset role;
  perform set_config('app.tenant_id', '', true);
  perform set_config('request.headers', '', true);

  select count(*) into n from public.sms_credit_ledger where tenant_id = b;
  r := r || format('%s B''s ledger untouched by A (%s rows)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  r := r || format('%s anon and signed-in users can''t run the credit functions (%s)',
    case when not has_function_privilege('anon', 'public.credit_sms_purchase(text)', 'execute') and not has_function_privilege('authenticated', 'public.spend_sms_credits(integer,text)', 'execute')
      and not has_function_privilege('authenticated', 'public.delete_form_with_submissions(uuid)', 'execute') then 'PASS' else 'FAIL' end, 'checked');

  raise exception E'ROUND 3 GATE RESULTS (rolled back, nothing kept):\n%', array_to_string(r, E'\n');
end $$;
