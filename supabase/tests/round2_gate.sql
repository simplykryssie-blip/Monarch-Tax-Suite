-- CRM Round 2 / Part B gate: per-tenant private buckets, the 24-hour delete queue, per-tenant texting and credits.
-- Run it in the SQL editor of the TEST project after 20261031090000 and 20261101090000. It uses two throwaway tenants
-- and example.com data only, and it never commits: it ends by raising an exception that carries the results, so
-- everything it did is rolled back. Read the results in the error message: every line should start with PASS.
--
-- Server requests are simulated as PostgREST runs them: SET LOCAL ROLE service_role, request.headers carrying
-- x-tenant-id, then public.pgrst_pre_request() (which switches to tenant_app for that tenant).

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  b uuid := '00000000-0000-4000-8000-0000000000b2';
  r text[] := '{}';
  who text;
  n bigint;
  ok boolean;
  outcome text;
  cid uuid;
  pid uuid;
begin
  -- 1. A new tenant gets its own private bucket.
  insert into public.tenants (id, slug, name) values (a, 'gate-r2-a', 'Gate R2 Tenant A'), (b, 'gate-r2-b', 'Gate R2 Tenant B');
  select count(*) into n from storage.buckets where id in ('tenant-' || a, 'tenant-' || b) and public = false and file_size_limit = 4194304;
  r := r || format('%s new tenants each get a private bucket (%s of 2)', case when n = 2 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.tenants t where not exists (select 1 from storage.buckets k where k.id = 'tenant-' || t.id and k.public = false);
  r := r || format('%s every tenant has a private bucket (%s without)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from pg_policies where schemaname = 'storage' and tablename = 'objects' and (qual ilike '%tenant-%' or with_check ilike '%tenant-%');
  r := r || format('%s no storage policies open the tenant buckets (%s found)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  -- Seed tenant B's rows as the platform (fake data).
  insert into public.tenant_images (tenant_id, storage_path, content_type, size_bytes, file_name) values (b, 'images/library/00000000-0000-4000-8000-0000000000b9.png', 'image/png', 100, 'b.png');
  insert into public.storage_cleanup (tenant_id, bucket, path, purge_after) values (b, 'tenant-' || b, 'images/library/x.png', now() - interval '1 hour');
  insert into public.tenant_sms_accounts (tenant_id, subaccount_sid, status) values (b, 'AC' || repeat('b', 32), 'setting_up');
  insert into public.sms_credit_ledger (tenant_id, delta, kind, note) values (b, 50, 'grant', 'gate');

  -- 2. As tenant A's server request.
  set local role service_role;
  perform set_config('request.headers', json_build_object('x-tenant-id', a)::text, true);
  perform public.pgrst_pre_request();
  who := current_user;
  r := r || format('%s server request runs as tenant_app (%s)', case when who = 'tenant_app' then 'PASS' else 'FAIL' end, who);

  -- Image library: own rows only; tenant_id filled from the request.
  insert into public.tenant_images (storage_path, content_type, size_bytes, file_name, alt_text) values ('images/library/00000000-0000-4000-8000-0000000000a9.png', 'image/png', 100, 'gate.png', 'Gate');
  select count(*) into n from public.tenant_images;
  r := r || format('%s tenant_images: A sees only its own (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.tenant_images where tenant_id = a;
  r := r || format('%s tenant_images: new row filed under A (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  begin
    insert into public.tenant_images (tenant_id, storage_path, content_type, size_bytes, file_name) values (b, 'images/library/00000000-0000-4000-8000-0000000000a8.png', 'image/png', 100, 'x.png');
    outcome := 'allowed';
  exception when insufficient_privilege then outcome := 'refused';
  end;
  r := r || format('%s tenant_images: A writing into B is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.tenant_images (storage_path, content_type, size_bytes, file_name) values ('../escape.png', 'image/png', 100, 'x.png');
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s tenant_images: a path outside images/ is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  -- 24-hour delete queue: a person's delete is queued for later; the sweep sees only due rows, and only A's.
  insert into public.storage_cleanup (bucket, path, purge_after) values ('tenant-' || a, 'images/library/deleted-now.png', now() + interval '24 hours');
  insert into public.storage_cleanup (bucket, path, purge_after) values ('tenant-' || a, 'images/library/deleted-yesterday.png', now() - interval '1 minute');
  select count(*) into n from public.storage_cleanup where purge_after <= now();
  r := r || format('%s storage_cleanup: only A''s due file is swept, not one deleted just now, not B''s (%s due)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.storage_cleanup;
  r := r || format('%s storage_cleanup: A sees only its own queue (%s)', case when n = 2 then 'PASS' else 'FAIL' end, n);

  -- Texting: A can't see B's account or credits; credits spend only when covered.
  select count(*) into n from public.tenant_sms_accounts;
  r := r || format('%s tenant_sms_accounts: A doesn''t see B''s account (%s)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  insert into public.tenant_sms_accounts (subaccount_sid, status) values ('AC' || repeat('a', 32), 'setting_up');
  begin
    insert into public.tenant_sms_accounts (subaccount_sid) values ('AC' || repeat('c', 32));
    outcome := 'allowed';
  exception when unique_violation then outcome := 'refused';
  end;
  r := r || format('%s tenant_sms_accounts: a second account for A is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  ok := public.spend_sms_credits(1, 'gate-1');
  r := r || format('%s spend_sms_credits: with no credits, nothing is spent (%s)', case when not ok then 'PASS' else 'FAIL' end, ok);
  insert into public.sms_credit_ledger (delta, kind, note) values (3, 'grant', 'gate');
  ok := public.spend_sms_credits(2, 'gate-2');
  r := r || format('%s spend_sms_credits: 2 of 3 credits spent (%s)', case when ok then 'PASS' else 'FAIL' end, ok);
  ok := public.spend_sms_credits(2, 'gate-3');
  r := r || format('%s spend_sms_credits: 2 more with 1 left is refused (%s)', case when not ok then 'PASS' else 'FAIL' end, ok);
  select coalesce(sum(delta), 0) into n from public.sms_credit_ledger;
  r := r || format('%s sms_credit_ledger: A''s balance is 1 and B''s 50 credits aren''t visible (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  begin
    insert into public.sms_credit_ledger (tenant_id, delta, kind) values (b, 1000, 'grant');
    outcome := 'allowed';
  exception when insufficient_privilege then outcome := 'refused';
  end;
  r := r || format('%s sms_credit_ledger: A adding credits to B is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  -- Client messages: a sent text is recorded with its status and segments.
  insert into public.clients (full_name, email, phone) values ('Gate Client', 'gate.client@example.com', '(337) 555-0100') returning id into cid;
  insert into public.client_messages (client_id, direction, channel, body, status, sent_to, provider_id, segments) values (cid, 'out', 'sms', 'Gate text', 'sent', '+13375550100', 'SMgate', 1);
  insert into public.client_messages (client_id, direction, channel, body) values (cid, 'out', 'call', 'Logged call');
  select count(*) into n from public.client_messages where client_id = cid and ((status = 'sent' and segments = 1) or (status = 'logged' and segments is null));
  r := r || format('%s client_messages: sent and logged messages recorded (%s of 2)', case when n = 2 then 'PASS' else 'FAIL' end, n);

  reset role;
  perform set_config('app.tenant_id', '', true);
  perform set_config('request.headers', '', true);

  -- 3. Product images: the new tenant-bucket path is accepted; the old one still is; anything else isn't.
  select id into pid from public.products where tenant_id = (select id from public.tenants order by created_at limit 1) limit 1;
  if pid is null then
    r := r || 'SKIP product_images path check: no product on this project';
  else
    begin
      insert into public.product_images (tenant_id, product_id, storage_path, content_type, size_bytes) select tenant_id, id, 'images/products/' || id || '/00000000-0000-4000-8000-0000000000c1.png', 'image/png', 100 from public.products where id = pid;
      outcome := 'accepted';
    exception when check_violation then outcome := 'refused';
    end;
    r := r || format('%s product_images: images/products/... path is %s', case when outcome = 'accepted' then 'PASS' else 'FAIL' end, outcome);
    begin
      insert into public.product_images (tenant_id, product_id, storage_path, content_type, size_bytes) select tenant_id, id, 'images/../x.png', 'image/png', 100 from public.products where id = pid;
      outcome := 'accepted';
    exception when check_violation then outcome := 'refused';
    end;
    r := r || format('%s product_images: a path outside products/ is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  end if;

  raise exception E'ROUND 2 GATE RESULTS (rolled back, nothing kept):\n%', array_to_string(r, E'\n');
end $$;
