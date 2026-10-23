-- Gate: a workspace's storefront Stripe keys. Run it in the SQL editor of the TEST project after 20261118100000_tenant_store_stripe.
-- Two throwaway tenants and example data only (the "keys" below are made-up strings). It never commits: it ends by raising an
-- exception carrying the results, so everything it did is rolled back. Every line of the message should start with PASS.

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a7';
  b uuid := '00000000-0000-4000-8000-0000000000b7';
  r text[] := '{}';
  n bigint;
  outcome text;
begin
  insert into public.tenants (id, slug, name, tier) values (a, 'gate-ss-a', 'Gate SS Tenant A', 'bureau'), (b, 'gate-ss-b', 'Gate SS Tenant B', 'bureau');
  insert into public.tenant_store_stripe (tenant_id, secret_key_enc, secret_key_hint, mode, webhook_secret_enc, webhook_secret_hint) values
    (a, 'v1:ZXhhbXBsZS1hLWNpcGhlcnRleHQ=', 'aaaa', 'test', 'v1:ZXhhbXBsZS1hLWhvb2s=', 'hhhh'),
    (b, 'v1:ZXhhbXBsZS1iLWNpcGhlcnRleHQ=', 'bbbb', 'live', null, null);

  -- as tenant A's server request
  set local role service_role;
  perform set_config('request.headers', json_build_object('x-tenant-id', a)::text, true);
  perform public.pgrst_pre_request();
  r := r || format('%s server request runs as tenant_app (%s)', case when current_user = 'tenant_app' then 'PASS' else 'FAIL' end, current_user);

  select count(*) into n from public.tenant_store_stripe;
  r := r || format('%s A sees only its own keys row (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.tenant_store_stripe where tenant_id = b;
  r := r || format('%s A sees nothing of B''s keys (%s)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  update public.tenant_store_stripe set secret_key_hint = 'a2a2' where tenant_id = a;
  get diagnostics n = row_count;
  r := r || format('%s A can replace its own key (%s row)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  update public.tenant_store_stripe set secret_key_hint = 'zzzz' where tenant_id = b;
  get diagnostics n = row_count;
  r := r || format('%s A changing B''s key touches nothing (%s rows)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  begin
    insert into public.tenant_store_stripe (tenant_id, secret_key_enc, secret_key_hint, mode) values (b, 'v1:eHh4', 'xxxx', 'test');
    outcome := 'allowed';
  exception when others then outcome := 'refused';
  end;
  r := r || format('%s A writing a keys row for B is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    update public.tenant_store_stripe set secret_key_enc = 'sk_test_plaintext_not_allowed' where tenant_id = a;
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s saving a plaintext key is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    update public.tenant_store_stripe set webhook_secret_enc = null where tenant_id = a;
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s a webhook secret without its hint (or the reverse) is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  -- back as the platform
  reset role;
  select count(*) into n from public.tenant_store_stripe where tenant_id in (a, b) and ((tenant_id = a and secret_key_hint = 'a2a2') or (tenant_id = b and secret_key_hint = 'bbbb'));
  r := r || format('%s B''s row is exactly as it was and A''s change stood (%s of 2)', case when n = 2 then 'PASS' else 'FAIL' end, n);

  r := r || format('%s anon and signed-in users can''t read or write the keys table', case when not (has_table_privilege('anon', 'public.tenant_store_stripe', 'select') or has_table_privilege('authenticated', 'public.tenant_store_stripe', 'select') or has_table_privilege('anon', 'public.tenant_store_stripe', 'insert') or has_table_privilege('authenticated', 'public.tenant_store_stripe', 'insert')) then 'PASS' else 'FAIL' end);
  r := r || format('%s row-level security is on', case when (select relrowsecurity from pg_class where oid = 'public.tenant_store_stripe'::regclass) then 'PASS' else 'FAIL' end);
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'tenant_store_stripe' and policyname in ('tenant_isolation', 'tenant_members_only');
  r := r || format('%s both tenant policies are there (%s of 2)', case when n = 2 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from pg_constraint c where c.conrelid = 'public.tenant_store_stripe'::regclass and c.contype = 'f' and c.confrelid::regclass::text not in ('tenants', 'public.tenants', 'auth.users');
  r := r || format('%s no foreign key leaves the tenant or the user list (%s unexpected)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  raise exception E'STORE STRIPE GATE RESULTS (rolled back, nothing kept):\n%', array_to_string(r, E'\n');
end $$;
