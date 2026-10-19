-- Phase 6 gate: subscription billing. Run it in the SQL editor of the TEST project after 20261117090000_billing.
-- Two throwaway tenants and example data only. It never commits: it ends by raising an exception carrying the results,
-- so everything it did is rolled back. Every line of the message should start with PASS.

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000aa';
  b uuid := '00000000-0000-4000-8000-0000000000bb';
  r text[] := '{}';
  n bigint;
  outcome text;
begin
  insert into public.tenants (id, slug, name, tier) values (a, 'gate-p6-a', 'Gate P6 Tenant A', 'ptin'), (b, 'gate-p6-b', 'Gate P6 Tenant B', 'ptin');
  insert into public.tenant_subscriptions (tenant_id, plan, status, stripe_customer_id, stripe_subscription_id) values
    (a, 'ptin', 'active', 'cus_gateA', 'sub_gateA'), (b, 'ptin', 'suspended', 'cus_gateB', 'sub_gateB');
  insert into public.billing_events (stripe_event_id, tenant_id, type) values ('evt_gateA', a, 'invoice.paid'), ('evt_gateB', b, 'invoice.paid');

  -- as tenant A's server request
  set local role service_role;
  perform set_config('request.headers', json_build_object('x-tenant-id', a)::text, true);
  perform public.pgrst_pre_request();
  r := r || format('%s server request runs as tenant_app (%s)', case when current_user = 'tenant_app' then 'PASS' else 'FAIL' end, current_user);

  select count(*) into n from public.tenant_subscriptions;
  r := r || format('%s A sees only its own subscription (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.tenant_subscriptions where tenant_id = b;
  r := r || format('%s A sees nothing of B''s subscription (%s)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  begin
    update public.tenant_subscriptions set status = 'active' where tenant_id = a;
    outcome := 'allowed';
  exception when insufficient_privilege then outcome := 'refused';
  end;
  r := r || format('%s a workspace changing its own subscription is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    update public.tenant_subscriptions set status = 'active' where tenant_id = b;
    outcome := 'allowed';
  exception when insufficient_privilege then outcome := 'refused';
  end;
  r := r || format('%s a workspace changing another''s subscription is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.tenant_subscriptions (plan, status, stripe_subscription_id) values ('bureau', 'active', 'sub_sneaky');
    outcome := 'allowed';
  exception when insufficient_privilege then outcome := 'refused';
  end;
  r := r || format('%s a workspace making itself a subscription is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    perform 1 from public.billing_events limit 1;
    outcome := 'readable';
  exception when insufficient_privilege then outcome := 'refused';
  end;
  r := r || format('%s the processed-events table is %s to a workspace', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  -- back as the platform
  reset role;
  select count(*) into n from public.tenant_subscriptions where tenant_id in (a, b) and ((tenant_id = a and status = 'active') or (tenant_id = b and status = 'suspended'));
  r := r || format('%s both subscriptions are exactly as they were (%s of 2)', case when n = 2 then 'PASS' else 'FAIL' end, n);

  begin
    insert into public.tenant_subscriptions (tenant_id, plan, status, stripe_subscription_id) values (a, 'ero', 'active', 'sub_other');
    outcome := 'allowed';
  exception when unique_violation then outcome := 'refused';
  end;
  r := r || format('%s a second subscription for one workspace is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    update public.tenant_subscriptions set stripe_subscription_id = 'sub_gateA' where tenant_id = b;
    outcome := 'allowed';
  exception when unique_violation then outcome := 'refused';
  end;
  r := r || format('%s one Stripe subscription shared by two workspaces is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    update public.tenant_subscriptions set status = 'canceled' where tenant_id = b;
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s cancelling without the retention dates is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  update public.tenant_subscriptions set status = 'canceled', canceled_at = now(), delete_after = now() + interval '90 days' where tenant_id = b;
  select count(*) into n from public.tenant_subscriptions where tenant_id = b and status = 'canceled' and delete_after - canceled_at = interval '90 days';
  r := r || format('%s cancelling with the 90 day retention date works (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  begin
    insert into public.tenant_subscriptions (tenant_id, plan, status) values ('00000000-0000-4000-8000-0000000000cc', 'ptin', 'active');
    outcome := 'allowed';
  exception when others then outcome := 'refused';
  end;
  r := r || format('%s a billed workspace with no Stripe subscription (or no such tenant) is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.billing_events (stripe_event_id, tenant_id, type) values ('evt_gateA', a, 'invoice.paid');
    outcome := 'allowed';
  exception when unique_violation then outcome := 'refused';
  end;
  r := r || format('%s handling the same Stripe event twice is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  select count(*) into n from public.tenant_subscriptions where tenant_id = '00000000-0000-4000-8000-000000000001' and status = 'internal';
  r := r || format('%s Monarch (tenant #1) is on the free internal plan (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);

  select count(*) into n from unnest(array['tenant_subscriptions', 'billing_events']) t
    where has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'select');
  r := r || format('%s anon and signed-in users can''t read the billing tables (%s open)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from unnest(array['tenant_subscriptions', 'billing_events']) t
    where has_table_privilege('tenant_app', 'public.' || t, 'insert') or has_table_privilege('tenant_app', 'public.' || t, 'update');
  r := r || format('%s the tenant role can''t write the billing tables (%s writable)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  r := r || format('%s the tenant role can read its subscription but not the events table', case when has_table_privilege('tenant_app', 'public.tenant_subscriptions', 'select') and not has_table_privilege('tenant_app', 'public.billing_events', 'select') then 'PASS' else 'FAIL' end);
  select count(*) into n from unnest(array['tenant_subscriptions', 'billing_events']) t
    where not exists (select 1 from pg_class where oid = ('public.' || t)::regclass and relrowsecurity);
  r := r || format('%s row-level security is on for both tables (%s without)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from unnest(array['tenant_subscriptions', 'billing_events']) t
    where (select count(*) from pg_policies where schemaname = 'public' and tablename = t and policyname in ('tenant_isolation', 'tenant_members_only')) <> 2;
  r := r || format('%s both tables have both tenant policies (%s without)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from pg_constraint c join pg_class cl on cl.oid = c.conrelid
    where cl.relname in ('tenant_subscriptions', 'billing_events') and c.contype = 'f' and c.confrelid::regclass::text not in ('tenants', 'public.tenants');
  r := r || format('%s no foreign key leaves the tenant (%s unexpected)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  raise exception E'PHASE 6 GATE RESULTS (rolled back, nothing kept):\n%', array_to_string(r, E'\n');
end $$;
