-- Phase 5e gate: campaigns. Run it in the SQL editor of the TEST project after 20261116090000_campaigns.
-- Two throwaway tenants and example.com data only. It never commits: it ends by raising an exception carrying the results,
-- so everything it did is rolled back. Every line of the message should start with PASS.
--
-- Server requests are simulated as PostgREST runs them: SET LOCAL ROLE service_role, request.headers carrying
-- x-tenant-id, then public.pgrst_pre_request() (which switches to tenant_app for that tenant).

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000aa';
  b uuid := '00000000-0000-4000-8000-0000000000bb';
  r text[] := '{}';
  n bigint;
  outcome text;
  a_camp uuid; b_camp uuid;
  hash1 text := repeat('a', 64); hash2 text := repeat('b', 64); hash3 text := repeat('c', 64); hash4 text := repeat('d', 64);
  b_rec uuid; a_rec uuid;
  tn text;
begin
  insert into public.tenants (id, slug, name, tier) values (a, 'gate-p5e-a', 'Gate P5e Tenant A', 'bureau'), (b, 'gate-p5e-b', 'Gate P5e Tenant B', 'bureau');
  insert into public.campaigns (tenant_id, name, channel, subject, body) values (b, 'B campaign', 'email', 'Hello', 'Body') returning id into b_camp;
  insert into public.campaign_recipients (tenant_id, campaign_id, contact_kind, contact_id, address, token_hash) values (b, b_camp, 'client', gen_random_uuid(), 'b1@example.com', hash1) returning id into b_rec;
  insert into public.campaign_recipients (tenant_id, campaign_id, contact_kind, contact_id, address, token_hash) values (b, b_camp, 'client', gen_random_uuid(), 'b2@example.com', hash2);
  insert into public.campaign_links (tenant_id, campaign_id, position, url) values (b, b_camp, 0, 'https://example.com/b');
  insert into public.marketing_consents (tenant_id, email, basis) values (b, 'b1@example.com', 'owner');
  insert into public.marketing_suppressions (tenant_id, channel, address, reason) values (b, 'email', 'shared@example.com', 'unsubscribed');
  insert into public.audience_segments (tenant_id, name, filter) values (b, 'B segment', '{}'::jsonb);

  -- ------------------------------------------------------------ as tenant A's server request
  set local role service_role;
  perform set_config('request.headers', json_build_object('x-tenant-id', a)::text, true);
  perform public.pgrst_pre_request();
  r := r || format('%s server request runs as tenant_app (%s)', case when current_user = 'tenant_app' then 'PASS' else 'FAIL' end, current_user);

  foreach tn in array array['marketing_consents', 'marketing_suppressions', 'audience_segments', 'campaigns', 'campaign_recipients', 'campaign_links'] loop
    execute format('select count(*) from public.%I', tn) into n;
    r := r || format('%s %s: A sees none of B''s (%s)', case when n = 0 then 'PASS' else 'FAIL' end, tn, n);
  end loop;

  insert into public.campaigns (name, channel, subject, body) values ('A campaign', 'email', 'Hi', 'Body') returning id into a_camp;
  insert into public.campaign_recipients (campaign_id, contact_kind, contact_id, address, token_hash) values (a_camp, 'client', gen_random_uuid(), 'a1@example.com', hash3) returning id into a_rec;
  insert into public.campaign_recipients (campaign_id, contact_kind, contact_id, address, token_hash) values (a_camp, 'lead', gen_random_uuid(), 'a2@example.com', hash4);
  insert into public.campaign_links (campaign_id, position, url) values (a_camp, 0, 'https://example.com/a');
  select count(*) into n from public.campaign_recipients;
  r := r || format('%s A can make its own campaign and two recipients (%s)', case when n = 2 then 'PASS' else 'FAIL' end, n);

  -- another office's campaign
  begin
    insert into public.campaign_recipients (campaign_id, contact_kind, contact_id, address, token_hash) values (b_camp, 'client', gen_random_uuid(), 'sneaky@example.com', repeat('e', 64));
    outcome := 'allowed';
  exception when foreign_key_violation then outcome := 'refused';
  end;
  r := r || format('%s a recipient on another office''s campaign is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.campaign_links (campaign_id, position, url) values (b_camp, 5, 'https://example.com/sneaky');
    outcome := 'allowed';
  exception when foreign_key_violation then outcome := 'refused';
  end;
  r := r || format('%s a link on another office''s campaign is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.marketing_consents (tenant_id, email, basis) values (b, 'x@example.com', 'owner');
    outcome := 'allowed';
  exception when others then outcome := 'refused';
  end;
  r := r || format('%s writing a consent into B''s office is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  -- per-office suppression: the same address can be blocked by A without touching B
  insert into public.marketing_suppressions (channel, address, reason) values ('email', 'shared@example.com', 'unsubscribed');
  select count(*) into n from public.marketing_suppressions;
  r := r || format('%s A can block the same address B blocked, and sees only its own row (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  begin
    insert into public.marketing_suppressions (channel, address, reason) values ('email', 'shared@example.com', 'manual');
    outcome := 'allowed';
  exception when unique_violation then outcome := 'refused';
  end;
  r := r || format('%s blocking the same address twice in one office is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.marketing_consents (email, basis, sms_consent) values ('bad@example.com', 'owner', true);
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s text consent without a date is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.campaigns (name, channel, subject, body, status) values ('No subject', 'email', null, 'x', 'scheduled');
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s a scheduled email with no subject is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  -- the claim function: takes only this office's queued rows, once
  select count(*) into n from public.campaign_claim(b_camp, 100);
  r := r || format('%s A claiming B''s campaign takes nothing (%s)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.campaign_claim(a_camp, 1);
  r := r || format('%s A claims one of its two queued recipients (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.campaign_claim(a_camp, 100);
  r := r || format('%s a second claim takes only the one left (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.campaign_claim(a_camp, 100);
  r := r || format('%s a third claim takes nothing (%s)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.campaign_recipients where status = 'sending' and claimed_at is not null;
  r := r || format('%s claimed rows are marked sending with a time (%s of 2)', case when n = 2 then 'PASS' else 'FAIL' end, n);

  -- open and click counting
  perform public.campaign_note_event(a_rec, 'open');
  perform public.campaign_note_event(a_rec, 'open');
  perform public.campaign_note_event(a_rec, 'click', a_camp, 0);
  select count(*) into n from public.campaign_recipients where id = a_rec and open_count = 2 and click_count = 1 and opened_at is not null and clicked_at is not null;
  r := r || format('%s opens and clicks are counted on the recipient (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.campaign_links where campaign_id = a_camp and click_count = 1;
  r := r || format('%s a click is counted on its link (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  perform public.campaign_note_event(b_rec, 'open');
  perform public.campaign_note_event(b_rec, 'click', b_camp, 0);

  -- the platform-wide list is out of reach of an office's server request
  begin
    perform 1 from public.platform_suppressions limit 1;
    outcome := 'readable';
  exception when insufficient_privilege then outcome := 'refused';
  end;
  r := r || format('%s the platform-wide block list is %s to an office''s request', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.platform_suppressions (address_hash, channel, reason) values (repeat('f', 64), 'email', 'complaint');
    outcome := 'allowed';
  exception when insufficient_privilege then outcome := 'refused';
  end;
  r := r || format('%s writing to the platform-wide block list is %s to an office''s request', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  -- ------------------------------------------------------------ back as the platform: B is untouched
  reset role;
  select count(*) into n from public.campaign_recipients where campaign_id = b_camp and status = 'queued';
  r := r || format('%s B''s two recipients are still queued (%s)', case when n = 2 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.marketing_suppressions where tenant_id = b and reason = 'unsubscribed';
  r := r || format('%s B''s block on the shared address is untouched (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.campaign_recipients where id = b_rec and open_count = 0 and click_count = 0 and opened_at is null;
  r := r || format('%s A counting an open and a click on B''s recipient changes nothing (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.campaign_links where campaign_id = b_camp and click_count = 0;
  r := r || format('%s ...and B''s link count is unchanged (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.platform_suppressions where address_hash = repeat('f', 64);
  r := r || format('%s nothing reached the platform-wide list from an office''s request (%s)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  select count(*) into n from pg_constraint c join pg_class cl on cl.oid = c.conrelid
    where cl.relname in ('marketing_consents', 'marketing_suppressions', 'audience_segments', 'campaigns', 'campaign_recipients', 'campaign_links') and c.contype = 'f' and c.conname not like '%\_same\_tenant'
      and c.confrelid::regclass::text not in ('tenants', 'public.tenants', 'auth.users');
  r := r || format('%s no foreign key leaves the tenant (%s unexpected)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from unnest(array['marketing_consents', 'marketing_suppressions', 'audience_segments', 'campaigns', 'campaign_recipients', 'campaign_links', 'platform_suppressions']) t
    where has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'select');
  r := r || format('%s anon and signed-in users can''t read the campaign tables directly (%s open)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from unnest(array['marketing_consents', 'marketing_suppressions', 'audience_segments', 'campaigns', 'campaign_recipients', 'campaign_links', 'platform_suppressions']) t
    where not exists (select 1 from pg_class where oid = ('public.' || t)::regclass and relrowsecurity);
  r := r || format('%s row-level security is on for all seven tables (%s without)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from unnest(array['marketing_consents', 'marketing_suppressions', 'audience_segments', 'campaigns', 'campaign_recipients', 'campaign_links']) t
    where (select count(*) from pg_policies where schemaname = 'public' and tablename = t and policyname in ('tenant_isolation', 'tenant_members_only')) <> 2;
  r := r || format('%s each tenant table has both tenant policies (%s without)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  r := r || format('%s the platform-wide list is closed to tenant_app, anon and signed-in users', case when not has_table_privilege('tenant_app', 'public.platform_suppressions', 'select') and not has_table_privilege('anon', 'public.platform_suppressions', 'select') and not has_table_privilege('authenticated', 'public.platform_suppressions', 'select') and has_table_privilege('service_role', 'public.platform_suppressions', 'select') then 'PASS' else 'FAIL' end);
  r := r || format('%s the claim and counting functions are not callable by signed-in or anonymous users', case when not has_function_privilege('anon', 'public.campaign_claim(uuid,integer)', 'execute') and not has_function_privilege('authenticated', 'public.campaign_claim(uuid,integer)', 'execute') and not has_function_privilege('anon', 'public.campaign_note_event(uuid,text,uuid,integer)', 'execute') and not has_function_privilege('authenticated', 'public.campaign_note_event(uuid,text,uuid,integer)', 'execute') then 'PASS' else 'FAIL' end);

  raise exception E'PHASE 5e GATE RESULTS (rolled back, nothing kept):\n%', array_to_string(r, E'\n');
end $$;
