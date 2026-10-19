-- Phase 5d gate: the website builder. Run it in the SQL editor of the TEST project after 20261115090000_website_builder.
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
  a_site uuid; b_site uuid; a_home uuid; b_home uuid; a_about uuid;
  published_n integer; st text;
begin
  insert into public.tenants (id, slug, name, tier) values (a, 'gate-p5d-a', 'Gate P5d Tenant A', 'bureau'), (b, 'gate-p5d-b', 'Gate P5d Tenant B', 'bureau');
  insert into public.sites (tenant_id, name, slug) values (b, 'B Site', 'gate-b-site') returning id into b_site;
  insert into public.site_pages (tenant_id, site_id, slug, title, is_home, draft) values (b, b_site, '', 'B Home', true, '[{"type":"heading","text":"B draft"}]'::jsonb) returning id into b_home;
  insert into public.site_domains (tenant_id, site_id, hostname, kind, status) values (b, b_site, 'gate-b-site.monarchtaxsuite.com', 'subdomain', 'active'), (b, b_site, 'www.gate-b.example.com', 'custom', 'pending');

  -- ------------------------------------------------------------ as tenant A's server request
  set local role service_role;
  perform set_config('request.headers', json_build_object('x-tenant-id', a)::text, true);
  perform public.pgrst_pre_request();
  r := r || format('%s server request runs as tenant_app (%s)', case when current_user = 'tenant_app' then 'PASS' else 'FAIL' end, current_user);

  select count(*) into n from public.sites;
  r := r || format('%s sites: A sees none of B''s (%s)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.site_pages;
  r := r || format('%s site_pages: A sees none of B''s (%s)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.site_domains;
  r := r || format('%s site_domains: A sees none of B''s (%s)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  insert into public.sites (name, slug) values ('A Site', 'gate-a-site') returning id into a_site;
  insert into public.site_pages (site_id, slug, title, is_home) values (a_site, '', 'A Home', true) returning id into a_home;
  insert into public.site_pages (site_id, slug, title, is_home, draft) values (a_site, 'about', 'About', false, '[{"type":"text","text":"About A"}]'::jsonb) returning id into a_about;
  insert into public.site_domains (site_id, hostname, kind, status) values (a_site, 'gate-a-site.monarchtaxsuite.com', 'subdomain', 'active');
  select count(*) into n from public.site_pages;
  r := r || format('%s A can make its own site, two pages and its address (%s pages)', case when n = 2 then 'PASS' else 'FAIL' end, n);

  begin
    insert into public.sites (name, slug) values ('A Second', 'gate-a-second');
    outcome := 'allowed';
  exception when unique_violation then outcome := 'refused';
  end;
  r := r || format('%s a second site for one office is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  begin
    insert into public.site_pages (site_id, slug, title) values (b_site, 'sneaky', 'Sneaky');
    outcome := 'allowed';
  exception when foreign_key_violation then outcome := 'refused';
  end;
  r := r || format('%s a page on another office''s site is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.site_domains (site_id, hostname, kind, status) values (b_site, 'sneaky.example.com', 'custom', 'pending');
    outcome := 'allowed';
  exception when foreign_key_violation then outcome := 'refused';
  end;
  r := r || format('%s a domain on another office''s site is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  begin
    insert into public.site_domains (site_id, hostname, kind, status) values (a_site, 'www.gate-b.example.com', 'custom', 'pending');
    outcome := 'allowed';
  exception when unique_violation then outcome := 'refused';
  end;
  r := r || format('%s a hostname another office already uses is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.site_domains (site_id, hostname, kind, status) values (a_site, 'WWW.Mixed.example.com', 'custom', 'pending');
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s an upper-case hostname is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.site_domains (site_id, hostname, kind, status) values (a_site, 'second-sub.monarchtaxsuite.com', 'subdomain', 'active');
    outcome := 'allowed';
  exception when unique_violation then outcome := 'refused';
  end;
  r := r || format('%s a second default address for one site is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.sites (name, slug) values ('x', 'ab');
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s a two-letter address label is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  begin
    insert into public.site_pages (site_id, slug, title, is_home) values (a_site, '', 'Another home', true);
    outcome := 'allowed';
  exception when unique_violation or check_violation then outcome := 'refused';
  end;
  r := r || format('%s a second home page is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.site_pages (site_id, slug, title, is_home) values (a_site, '', 'No slug', false);
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s an ordinary page with no address is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.site_pages (site_id, slug, title, is_home) values (a_site, 'about', 'About again', false);
    outcome := 'allowed';
  exception when unique_violation then outcome := 'refused';
  end;
  r := r || format('%s two pages with the same address are %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    update public.site_pages set draft = (select jsonb_agg('{"type":"divider"}'::jsonb) from generate_series(1, 61)) where id = a_about;
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s a page of 61 blocks is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    update public.site_pages set draft = '{"type":"text"}'::jsonb where id = a_about;
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s page content that is not a list is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  -- publishing
  begin
    perform public.site_publish(b_site);
    outcome := 'allowed';
  exception when others then outcome := 'refused';
  end;
  r := r || format('%s A publishing B''s site is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  perform public.site_unpublish(b_site);

  select count(*) into n from public.site_pages where published is not null;
  r := r || format('%s nothing is published before A publishes (%s)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  published_n := public.site_publish(a_site);
  r := r || format('%s publishing A''s site covers its two pages (%s)', case when published_n = 2 then 'PASS' else 'FAIL' end, published_n);
  select count(*) into n from public.site_pages where published = draft and published_title = title and published_at is not null;
  r := r || format('%s every published copy equals its draft (%s of 2)', case when n = 2 then 'PASS' else 'FAIL' end, n);
  select status into st from public.sites where id = a_site;
  r := r || format('%s the site is now live (%s)', case when st = 'published' then 'PASS' else 'FAIL' end, st);
  update public.site_pages set draft = '[{"type":"heading","text":"changed after publishing"}]'::jsonb where id = a_home;
  select count(*) into n from public.site_pages where id = a_home and published = '[]'::jsonb;
  r := r || format('%s editing a draft after publishing leaves the published copy alone (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  perform public.site_unpublish(a_site);
  select status into st from public.sites where id = a_site;
  r := r || format('%s taking the site offline works (%s)', case when st = 'draft' then 'PASS' else 'FAIL' end, st);

  -- ------------------------------------------------------------ back as the platform: B is untouched
  reset role;
  select count(*) into n from public.sites where id = b_site and status = 'draft';
  select count(*) + n into n from public.site_pages where id = b_home and published is null and draft::text like '%B draft%';
  select count(*) + n into n from public.site_domains where site_id = b_site;
  r := r || format('%s B''s site, page and two addresses are untouched (%s of 4)', case when n = 4 then 'PASS' else 'FAIL' end, n);

  select count(*) into n from pg_constraint c join pg_class t on t.oid = c.conrelid
    where t.relname in ('sites', 'site_pages', 'site_domains') and c.contype = 'f' and c.conname not like '%\_same\_tenant'
      and c.confrelid::regclass::text not in ('tenants', 'public.tenants', 'auth.users');
  r := r || format('%s no foreign key leaves the tenant (%s unexpected)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from unnest(array['sites', 'site_pages', 'site_domains']) t
    where has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'select');
  r := r || format('%s anon and signed-in users can''t read the site tables directly (%s open)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from unnest(array['sites', 'site_pages', 'site_domains']) t
    where not exists (select 1 from pg_class where oid = ('public.' || t)::regclass and relrowsecurity);
  r := r || format('%s row-level security is on for all three tables (%s without)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from unnest(array['sites', 'site_pages', 'site_domains']) t
    where (select count(*) from pg_policies where schemaname = 'public' and tablename = t and policyname in ('tenant_isolation', 'tenant_members_only')) <> 2;
  r := r || format('%s each site table has both tenant policies (%s without)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  r := r || format('%s publishing is not callable by signed-in or anonymous users', case when not has_function_privilege('anon', 'public.site_publish(uuid)', 'execute') and not has_function_privilege('authenticated', 'public.site_publish(uuid)', 'execute') and not has_function_privilege('anon', 'public.site_unpublish(uuid)', 'execute') and not has_function_privilege('authenticated', 'public.site_unpublish(uuid)', 'execute') then 'PASS' else 'FAIL' end);

  raise exception E'PHASE 5d GATE RESULTS (rolled back, nothing kept):\n%', array_to_string(r, E'\n');
end $$;
