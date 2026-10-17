-- Phase 5b gate: workflows with branches and waits. Run it in the SQL editor of the TEST project after
-- 20261110090000_automation_steps. Two throwaway tenants and example.com data only. It never commits: it ends by raising
-- an exception carrying the results, so everything it did is rolled back. Every line of the message should start with PASS.
--
-- Server requests are simulated as PostgREST runs them: SET LOCAL ROLE service_role, request.headers carrying
-- x-tenant-id, then public.pgrst_pre_request() (which switches to tenant_app for that tenant).
--
-- What this proves is the database's side: one tenant cannot see or write another's workflows, events, runs or tasks;
-- a task cannot point at another tenant's client, lead or run; a run can be suspended ("waiting") and carries its next
-- step number; events can name what they are about but only from the allowed kinds; a workflow makes a task once; client
-- tags are limited; and signed-in and anonymous users cannot read the tasks table. The engine itself (waits, branches,
-- retries, limits) is tested in tests/automation-steps.test.ts.

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a7';
  b uuid := '00000000-0000-4000-8000-0000000000b8';
  r text[] := '{}';
  n bigint;
  outcome text;
  b_wf uuid; b_ev uuid; b_ex uuid; b_client uuid; b_lead uuid; b_task uuid;
  a_wf uuid; a_ev uuid; a_ex uuid; a_client uuid; a_lead uuid;
begin
  insert into public.tenants (id, slug, name, tier) values (a, 'gate-p5b-a', 'Gate P5b Tenant A', 'bureau'), (b, 'gate-p5b-b', 'Gate P5b Tenant B', 'bureau');

  -- ------------------------------------------------------------ seed tenant B (as the platform)
  insert into public.automation_workflows (tenant_id, name, trigger_event, steps, trigger_config) values (b, 'B flow', 'appointment.booked', '[{"type":"record_note","note":"b"}]'::jsonb, '{"offset_days":-7}'::jsonb) returning id into b_wf;
  insert into public.automation_events (tenant_id, event_key, event_type, subject_type, subject_id) values (b, 'gate5b-b-event', 'appointment.booked', 'appointment', gen_random_uuid()) returning id into b_ev;
  insert into public.automation_executions (tenant_id, workflow_id, event_id, status, pc, next_attempt_at) values (b, b_wf, b_ev, 'waiting', 2, now() + interval '1 day') returning id into b_ex;
  insert into public.clients (tenant_id, full_name) values (b, 'B Client') returning id into b_client;
  insert into public.leads (tenant_id, full_name, email, source) values (b, 'B Lead', 'b-lead@example.com', 'manual') returning id into b_lead;
  insert into public.automation_tasks (tenant_id, title, client_id, lead_id, execution_id) values (b, 'B task', b_client, b_lead, b_ex) returning id into b_task;
  insert into public.clients (tenant_id, full_name) values (a, 'A Client') returning id into a_client;
  insert into public.leads (tenant_id, full_name, email, source) values (a, 'A Lead', 'a-lead@example.com', 'manual') returning id into a_lead;

  -- ------------------------------------------------------------ as tenant A's server request
  set local role service_role;
  perform set_config('request.headers', json_build_object('x-tenant-id', a)::text, true);
  perform public.pgrst_pre_request();
  r := r || format('%s server request runs as tenant_app (%s)', case when current_user = 'tenant_app' then 'PASS' else 'FAIL' end, current_user);

  select count(*) into n from public.automation_workflows;
  r := r || format('%s automation_workflows: A sees none of B''s (%s)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.automation_events;
  r := r || format('%s automation_events: A sees none of B''s (%s)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.automation_executions;
  r := r || format('%s automation_executions (including waiting runs): A sees none of B''s (%s)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.automation_tasks;
  r := r || format('%s automation_tasks: A sees none of B''s (%s)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  -- A's own workflow with a step tree, an event about something, and a run that waits.
  insert into public.automation_workflows (name, trigger_event, steps, trigger_config)
    values ('A flow', 'date.return_due', '[{"type":"wait","amount":2,"unit":"days","mode":"business"},{"type":"branch","conditions":[],"then":[],"else":[]}]'::jsonb, '{"offset_days":3}'::jsonb) returning id into a_wf;
  insert into public.automation_events (event_key, event_type, subject_type, subject_id) values ('gate5b-a-event', 'date.return_due', 'return', gen_random_uuid()) returning id into a_ev;
  insert into public.automation_executions (workflow_id, event_id, status, pc, next_attempt_at) values (a_wf, a_ev, 'waiting', 3, now() + interval '2 days') returning id into a_ex;
  select count(*) into n from public.automation_executions where status = 'waiting' and pc = 3;
  r := r || format('%s A can save a step tree, an event about a return, and a waiting run with its next step (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);

  begin
    insert into public.automation_executions (workflow_id, event_id, status, is_test) values (a_wf, a_ev, 'sleeping', true);
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s a run with an unknown status is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.automation_executions (workflow_id, event_id, pc, is_test) values (a_wf, a_ev, 201, true);
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s a run past step 200 is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.automation_events (event_key, event_type, subject_type, subject_id) values ('gate5b-a-bad', 'appointment.booked', 'planet', gen_random_uuid());
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s an event about an unknown kind of thing is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.automation_workflows (name, trigger_event, steps) values ('Bad steps', 'appointment.booked', '{"not":"a list"}'::jsonb);
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s steps that are not a list are %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.automation_workflows (name, trigger_event, trigger_config) values ('Bad config', 'date.return_due', '[1]'::jsonb);
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s trigger settings that are not an object are %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  -- Tasks.
  insert into public.automation_tasks (title, client_id, lead_id, execution_id) values ('A task', a_client, a_lead, a_ex);
  select count(*) into n from public.automation_tasks;
  r := r || format('%s A can add a task for its own client, lead and run; tenant_id is filled in (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  begin
    insert into public.automation_tasks (title, execution_id) values ('A task', a_ex);
    outcome := 'allowed';
  exception when unique_violation then outcome := 'refused';
  end;
  r := r || format('%s the same task twice from one run is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.automation_tasks (title) values ('');
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s a task with no title is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.automation_tasks (title, client_id) values ('Cross client', b_client);
    outcome := 'allowed';
  exception when others then outcome := 'refused';
  end;
  r := r || format('%s a task for B''s client is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.automation_tasks (title, lead_id) values ('Cross lead', b_lead);
    outcome := 'allowed';
  exception when others then outcome := 'refused';
  end;
  r := r || format('%s a task for B''s lead is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.automation_tasks (title, execution_id) values ('Cross run', b_ex);
    outcome := 'allowed';
  exception when others then outcome := 'refused';
  end;
  r := r || format('%s a task from B''s workflow run is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.automation_tasks (tenant_id, title) values (b, 'Planted');
    outcome := 'allowed';
  exception when others then outcome := 'refused';
  end;
  r := r || format('%s writing a task into B is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  update public.automation_tasks set done_at = now() where id = b_task;
  get diagnostics n = row_count;
  r := r || format('%s A cannot complete B''s task (%s rows)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  update public.automation_executions set status = 'failed' where id = b_ex;
  get diagnostics n = row_count;
  r := r || format('%s A cannot change B''s waiting run (%s rows)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  delete from public.automation_tasks where id = b_task;
  get diagnostics n = row_count;
  r := r || format('%s A cannot delete B''s task (%s rows)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  -- Client tags.
  update public.clients set tags = array['a', 'b'] where id = a_client;
  begin
    update public.clients set tags = array_fill('t'::text, array[13]) where id = a_client;
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s more than 12 tags on a client is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    update public.clients set tags = array['a', null] where id = a_client;
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s an empty tag on a client is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  -- ------------------------------------------------------------ back as the platform: B is untouched
  reset role;
  select count(*) into n from public.automation_tasks where id = b_task and done_at is null;
  select count(*) + n into n from public.automation_executions where id = b_ex and status = 'waiting' and pc = 2;
  select count(*) + n into n from public.automation_workflows where id = b_wf and trigger_config = '{"offset_days":-7}'::jsonb;
  r := r || format('%s B''s task, waiting run and workflow are untouched (%s of 3)', case when n = 3 then 'PASS' else 'FAIL' end, n);

  select count(*) into n from pg_constraint c join pg_class t on t.oid = c.conrelid
    where t.relname = 'automation_tasks' and c.contype = 'f' and c.conname not like '%\_same\_tenant' and c.confrelid::regclass::text not in ('tenants', 'public.tenants');
  r := r || format('%s automation_tasks: no foreign key leaves the tenant (%s unexpected)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  select count(*) into n from unnest(array['automation_tasks']) t
    where has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'select');
  r := r || format('%s anon and signed-in users can''t read the tasks table directly (%s open)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  select count(*) into n from pg_class where oid = 'public.automation_tasks'::regclass and relrowsecurity;
  r := r || format('%s row-level security is on for automation_tasks (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);

  raise exception E'PHASE 5b GATE RESULTS (rolled back, nothing kept):\n%', array_to_string(r, E'\n');
end $$;
