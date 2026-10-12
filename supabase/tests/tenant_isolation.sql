-- Phase 2 Step 0 verification gate: tenant A cannot read, write or list tenant B's products, orders, customers,
-- licenses or checkouts.
--
-- Run against the TEST project only (Supabase SQL editor or `psql`). Everything runs in one transaction and is rolled
-- back: the two gate tenants and their rows never persist. Test data only (example.com addresses, fake Stripe ids).
--
-- The server's requests are simulated exactly as PostgREST runs them: SET LOCAL ROLE service_role, request.headers
-- carrying x-tenant-id, then public.pgrst_pre_request(), then the query, all in one transaction.
--
-- Output: one row per check with pass = true/false. The gate passes only when every row passes.

begin;

create temp table gate_results (n serial, check_name text, pass boolean, detail text) on commit drop;

-- Two gate tenants with one of everything each.
do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  b uuid := '00000000-0000-4000-8000-0000000000b2';
  t uuid;
  pid uuid; cid uuid; oid uuid;
begin
  insert into public.tenants (id, slug, name) values (a, 'gate-tenant-a', 'Gate Tenant A'), (b, 'gate-tenant-b', 'Gate Tenant B');
  foreach t in array array[a, b] loop
    insert into public.products (tenant_id, slug, name, description, product_type, access_type, installation_options, currency, status, category, features, payment_type, metadata)
      values (t, 'gate-product-' || right(t::text, 2), 'Gate product', 'Gate test product.', 'software', 'license', '{}', 'usd', 'draft', 'tax_software', '{}', 'one_time', '{}')
      returning id into pid;
    insert into public.calculator_customers (tenant_id, email, full_name, status)
      values (t, 'gate-buyer-' || right(t::text, 2) || '@example.com', 'Gate Buyer', 'active') returning id into cid;
    insert into public.orders (tenant_id, customer_id, product_id, amount_cents, currency, payment_status, provider, verification_method, order_type, installation_type)
      values (t, cid, pid, 100, 'usd', 'paid', 'stripe', 'stripe_webhook', 'purchase', 'self_service') returning id into oid;
    insert into public.calculator_licenses (tenant_id, customer_id, product_id, order_id, product_code, status, billing_type)
      values (t, cid, pid, oid, 'gate', 'pending', 'one_time');
    insert into public.storefront_checkouts (tenant_id, product_id, stripe_session_id, stripe_price_id, amount_cents, currency, terms_version, terms_accepted_at, status, expires_at)
      values (t, pid, 'cs_gate_' || left(t::text, 8) || right(t::text, 2), 'price_gate', 100, 'usd', 'gate', now(), 'open', now() + interval '1 hour');
  end loop;
  -- Installed defaults are independent per-tenant copies under the same key.
  insert into public.automation_templates (tenant_id, template_key, name, subject, body) values (a, 'gate_template', 'Gate template a1', 'Subject', 'Body');
  begin
    insert into public.automation_templates (tenant_id, template_key, name, subject, body) values (b, 'gate_template', 'Gate template b2', 'Subject', 'Body');
    insert into gate_results (check_name, pass, detail) values ('same template key allowed in a second tenant', true, 'allowed');
  exception when unique_violation then
    insert into gate_results (check_name, pass, detail) values ('same template key allowed in a second tenant', false, 'refused by a global unique index: ' || sqlerrm);
  end;
  begin
    insert into public.products (tenant_id, slug, name, description, product_type, access_type, installation_options, currency, status, category, features, payment_type, metadata)
      values (b, 'gate-product-a1', 'Gate product', 'Same slug as tenant A.', 'software', 'license', '{}', 'usd', 'draft', 'tax_software', '{}', 'one_time', '{}');
    insert into gate_results (check_name, pass, detail) values ('same product slug allowed in a second tenant', true, 'allowed');
  exception when unique_violation then
    insert into gate_results (check_name, pass, detail) values ('same product slug allowed in a second tenant', false, 'refused by a global unique index: ' || sqlerrm);
  end;
end $$;

-- Tenant A, through the server path, against each of tenant B's tables.
do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  b uuid := '00000000-0000-4000-8000-0000000000b2';
  tbl text;
  who text;
  n_b bigint; n_list bigint; n_list_expected bigint; n_upd bigint; n_del bigint;
  ins_b text; ins_default uuid;
  results text[] := '{}';
begin
  foreach tbl in array array['products', 'orders', 'calculator_customers', 'calculator_licenses', 'storefront_checkouts'] loop
    execute format('select count(*) from public.%I where tenant_id = $1', tbl) into n_list_expected using a;

    set local role service_role;
    perform set_config('request.headers', json_build_object('x-tenant-id', a)::text, true);
    perform public.pgrst_pre_request();
    who := current_user;

    execute format('select count(*) from public.%I where tenant_id = $1', tbl) into n_b using b;
    execute format('select count(*) from public.%I', tbl) into n_list;
    execute format('update public.%I set tenant_id = tenant_id where tenant_id = $1', tbl) using b;
    get diagnostics n_upd = row_count;
    execute format('delete from public.%I where tenant_id = $1', tbl) using b;
    get diagnostics n_del = row_count;
    -- Writing a row into tenant B is refused.
    begin
      execute format('update public.%I set tenant_id = $1 where tenant_id = $2', tbl) using b, a;
      ins_b := 'allowed';
    exception when insufficient_privilege then ins_b := 'refused';
    end;

    reset role;
    perform set_config('app.tenant_id', '', true);
    perform set_config('request.headers', '', true);

    insert into gate_results (check_name, pass, detail) values
      (tbl || ': server runs as tenant_app', who = 'tenant_app', who),
      (tbl || ': read tenant B rows', n_b = 0, n_b || ' visible'),
      (tbl || ': list shows only tenant A', n_list = n_list_expected, n_list || ' listed, ' || n_list_expected || ' are A''s'),
      (tbl || ': update tenant B rows', n_upd = 0, n_upd || ' updated'),
      (tbl || ': delete tenant B rows', n_del = 0, n_del || ' deleted'),
      (tbl || ': move a row into tenant B', ins_b = 'refused', ins_b);
  end loop;
end $$;

-- Inserts: the request's tenant is the only tenant a row can get.
do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  b uuid := '00000000-0000-4000-8000-0000000000b2';
  got uuid; explicit_b text; platform_no_tenant text; cross_ref text; b_product uuid; a_customer uuid;
begin
  select id into b_product from public.products where tenant_id = b;
  select id into a_customer from public.calculator_customers where tenant_id = a;

  set local role service_role;
  perform set_config('request.headers', json_build_object('x-tenant-id', a)::text, true);
  perform public.pgrst_pre_request();
  insert into public.calculator_customers (email, status) values ('gate-default@example.com', 'active') returning tenant_id into got;
  begin
    insert into public.calculator_customers (tenant_id, email, status) values (b, 'gate-into-b@example.com', 'active');
    explicit_b := 'allowed';
  exception when insufficient_privilege then explicit_b := 'refused';
  end;
  reset role;
  perform set_config('app.tenant_id', '', true);
  perform set_config('request.headers', '', true);

  -- Platform access (service role, no tenant header) must still say which tenant a row belongs to.
  set local role service_role;
  begin
    insert into public.calculator_customers (email, status) values ('gate-nobody@example.com', 'active');
    platform_no_tenant := 'allowed';
  exception when not_null_violation then platform_no_tenant := 'refused';
  end;
  -- Even the platform cannot link tenant A's order to tenant B's product.
  begin
    insert into public.orders (tenant_id, customer_id, product_id, amount_cents, currency, payment_status, provider, verification_method, order_type, installation_type)
      values (a, a_customer, b_product, 100, 'usd', 'paid', 'stripe', 'stripe_webhook', 'purchase', 'self_service');
    cross_ref := 'allowed';
  exception when foreign_key_violation then cross_ref := 'refused';
  end;
  reset role;

  insert into gate_results (check_name, pass, detail) values
    ('insert without tenant_id gets the request tenant', got = a, coalesce(got::text, 'null')),
    ('insert with tenant B''s id from tenant A', explicit_b = 'refused', explicit_b),
    ('platform insert without a tenant', platform_no_tenant = 'refused', platform_no_tenant),
    ('tenant A order pointing at tenant B product', cross_ref = 'refused', cross_ref);
end $$;

-- The request hook only narrows the service role, and only to a real tenant.
do $$
declare
  as_anon text; unknown text; invalid text; no_header text;
begin
  set local role anon;
  perform set_config('request.headers', json_build_object('x-tenant-id', '00000000-0000-4000-8000-0000000000a1')::text, true);
  perform public.pgrst_pre_request();
  as_anon := current_user;
  reset role;

  set local role service_role;
  perform set_config('request.headers', '', true);
  perform public.pgrst_pre_request();
  no_header := current_user;
  begin
    perform set_config('request.headers', json_build_object('x-tenant-id', '00000000-0000-4000-8000-00000000dead')::text, true);
    perform public.pgrst_pre_request();
    unknown := 'accepted';
  exception when invalid_authorization_specification then unknown := 'refused';
  end;
  begin
    perform set_config('request.headers', json_build_object('x-tenant-id', 'not-a-uuid')::text, true);
    perform public.pgrst_pre_request();
    invalid := 'accepted';
  exception when invalid_authorization_specification then invalid := 'refused';
  end;
  reset role;
  perform set_config('request.headers', '', true);

  insert into gate_results (check_name, pass, detail) values
    ('anon sending x-tenant-id stays anon', as_anon = 'anon', as_anon),
    ('service role without a header is unchanged (platform)', no_header = 'service_role', no_header),
    ('unknown tenant id refused', unknown = 'refused', unknown),
    ('malformed tenant id refused', invalid = 'refused', invalid);
end $$;

-- Automation defaults are per-tenant copies: tenant A's key lookup finds only tenant A's template.
do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  n bigint; nm text;
begin
  set local role service_role;
  perform set_config('request.headers', json_build_object('x-tenant-id', a)::text, true);
  perform public.pgrst_pre_request();
  select count(*), max(name) into n, nm from public.automation_templates where template_key = 'gate_template';
  reset role;
  perform set_config('app.tenant_id', '', true);
  perform set_config('request.headers', '', true);
  insert into gate_results (check_name, pass, detail) values
    ('same template key installed in both tenants; A finds only its own', n = 1 and nm = 'Gate template a1', n || ' found: ' || coalesce(nm, '-'));
end $$;

-- Signed-in users: no direct access to commerce tables, and tenant membership never shows another tenant.
do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  b uuid := '00000000-0000-4000-8000-0000000000b2';
  u uuid := '00000000-0000-4000-8000-0000000000c3';
  u2 uuid := '00000000-0000-4000-8000-0000000000d4';
  m_a bigint; m_b bigint; t text; res text;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
    (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gate-member-a@example.com', now(), now()),
    (u2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gate-member-b@example.com', now(), now());
  insert into public.tenant_members (tenant_id, user_id, role) values (a, u, 'owner'), (b, u2, 'owner');
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  select count(*) filter (where tenant_id = a), count(*) filter (where tenant_id = b) into m_a, m_b from public.tenant_members;
  foreach t in array array['products', 'orders', 'calculator_customers', 'calculator_licenses', 'storefront_checkouts'] loop
    begin
      execute format('select count(*) from public.%I', t);
      res := 'readable';
    exception when insufficient_privilege then res := 'no access';
    end;
    reset role;
    insert into gate_results (check_name, pass, detail) values ('signed-in user cannot query ' || t || ' directly', res = 'no access', res);
    set local role authenticated;
  end loop;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into gate_results (check_name, pass, detail) values
    ('signed-in member of A sees own membership', m_a = 1, m_a || ' visible'),
    ('signed-in member of A sees no B memberships', m_b = 0, m_b || ' visible');
end $$;

select check_name, pass, detail from gate_results order by n;

rollback;
