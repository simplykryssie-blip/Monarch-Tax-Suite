-- Phase 5a gate: the calendar. Run it in the SQL editor of the TEST project after 20261109090000_calendar. Two
-- throwaway tenants and example.com data only. It never commits: it ends by raising an exception carrying the results,
-- so everything it did is rolled back. Every line of the message should start with PASS.
--
-- Server requests are simulated as PostgREST runs them: SET LOCAL ROLE service_role, request.headers carrying
-- x-tenant-id, then public.pgrst_pre_request() (which switches to tenant_app for that tenant).
--
-- What this proves is the database's side: one tenant cannot see or write another's appointment types, availability,
-- appointments or reminders; a booking cannot point at another tenant's type; two booked appointments for the same
-- staff member cannot overlap (buffers included) but a cancelled one, another staff member, or another tenant can use
-- the same time; the table rules (end after start, text consent has a timestamp, one kind of availability row) hold;
-- and signed-in and anonymous users cannot read these tables. Slot offering, reminders and booking rules are in the
-- app and are tested in tests/appointment-slots.test.ts and tests/appointments-service.test.ts.

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000a6';
  b uuid := '00000000-0000-4000-8000-0000000000b7';
  s1 uuid := '00000000-0000-4000-8000-0000000000d1';
  s2 uuid := '00000000-0000-4000-8000-0000000000d2';
  r text[] := '{}';
  n bigint;
  outcome text;
  b_type uuid; a_type uuid; b_appt uuid; a_appt uuid; a_appt2 uuid; b_rule uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
    (s1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gate5a-s1@example.com', now(), now()),
    (s2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gate5a-s2@example.com', now(), now());
  insert into public.tenants (id, slug, name, tier) values (a, 'gate-p5a-a', 'Gate P5a Tenant A', 'ero'), (b, 'gate-p5a-b', 'Gate P5a Tenant B', 'ero');

  -- ------------------------------------------------------------ seed tenant B (as the platform)
  insert into public.appointment_types (tenant_id, slug, name, duration_minutes) values (b, 'consult', 'B Consult', 30) returning id into b_type;
  insert into public.availability_rules (tenant_id, weekday, start_time, end_time) values (b, 1, '09:00', '17:00') returning id into b_rule;
  insert into public.appointments (tenant_id, type_id, starts_at, ends_at, block_start, block_end, office_time_zone, contact_name, contact_email)
    values (b, b_type, '2027-03-01 15:00+00', '2027-03-01 15:30+00', '2027-03-01 15:00+00', '2027-03-01 15:45+00', 'America/New_York', 'B Person', 'b@example.com') returning id into b_appt;
  insert into public.appointment_reminders (tenant_id, appointment_id, channel, send_at) values (b, b_appt, 'email', '2027-02-28 15:00+00');

  -- ------------------------------------------------------------ as tenant A's server request
  set local role service_role;
  perform set_config('request.headers', json_build_object('x-tenant-id', a)::text, true);
  perform public.pgrst_pre_request();
  r := r || format('%s server request runs as tenant_app (%s)', case when current_user = 'tenant_app' then 'PASS' else 'FAIL' end, current_user);

  select count(*) into n from public.appointment_types;
  r := r || format('%s appointment_types: A sees none of B''s (%s)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.availability_rules;
  r := r || format('%s availability_rules: A sees none of B''s (%s)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.appointments;
  r := r || format('%s appointments: A sees none of B''s (%s)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.appointment_reminders;
  r := r || format('%s appointment_reminders: A sees none of B''s (%s)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  -- A's own rows, with tenant_id filled in; the same link name and the same time as B are fine.
  insert into public.appointment_types (slug, name, duration_minutes) values ('consult', 'A Consult', 30) returning id into a_type;
  select count(*) into n from public.appointment_types;
  r := r || format('%s A can use the same link name as B; tenant_id is filled in (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  begin
    insert into public.appointment_types (slug, name, duration_minutes) values ('consult', 'Again', 30);
    outcome := 'allowed';
  exception when unique_violation then outcome := 'refused';
  end;
  r := r || format('%s the same link name twice in one office is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.appointment_types (slug, name, duration_minutes) values ('Bad Slug!', 'Bad', 30);
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s a link name with capitals or spaces is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.appointment_types (slug, name, duration_minutes) values ('too-short', 'Short', 2);
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s a 2-minute appointment is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  insert into public.appointments (type_id, assignee_id, starts_at, ends_at, block_start, block_end, office_time_zone, contact_name, contact_email)
    values (a_type, s1, '2027-03-01 15:00+00', '2027-03-01 15:30+00', '2027-03-01 15:00+00', '2027-03-01 15:45+00', 'America/New_York', 'A Person', 'a@example.com') returning id into a_appt;
  select count(*) into n from public.appointments;
  r := r || format('%s A can book the same time B has booked (%s)', case when n = 1 then 'PASS' else 'FAIL' end, n);

  begin
    insert into public.appointments (type_id, assignee_id, starts_at, ends_at, block_start, block_end, office_time_zone, contact_name, contact_email)
      values (a_type, s1, '2027-03-01 15:30+00', '2027-03-01 16:00+00', '2027-03-01 15:30+00', '2027-03-01 16:15+00', 'America/New_York', 'Overlap', 'o@example.com');
    outcome := 'allowed';
  exception when exclusion_violation then outcome := 'refused';
  end;
  r := r || format('%s an overlapping booking for the same staff member is %s (the first one''s buffer runs to 15:45)', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  begin
    insert into public.appointments (type_id, assignee_id, starts_at, ends_at, block_start, block_end, office_time_zone, contact_name, contact_email)
      values (a_type, s2, '2027-03-01 15:30+00', '2027-03-01 16:00+00', '2027-03-01 15:30+00', '2027-03-01 16:15+00', 'America/New_York', 'Other staff', 'o2@example.com');
    outcome := 'allowed';
  exception when exclusion_violation then outcome := 'refused';
  end;
  r := r || format('%s the same time for a different staff member is %s', case when outcome = 'allowed' then 'PASS' else 'FAIL' end, outcome);

  begin
    insert into public.appointments (type_id, assignee_id, starts_at, ends_at, block_start, block_end, office_time_zone, contact_name, contact_email)
      values (a_type, null, '2027-03-01 15:00+00', '2027-03-01 15:30+00', '2027-03-01 15:00+00', '2027-03-01 15:45+00', 'America/New_York', 'Office one', 'o3@example.com'),
             (a_type, null, '2027-03-01 15:15+00', '2027-03-01 15:45+00', '2027-03-01 15:15+00', '2027-03-01 16:00+00', 'America/New_York', 'Office two', 'o4@example.com');
    outcome := 'allowed';
  exception when exclusion_violation then outcome := 'refused';
  end;
  r := r || format('%s two overlapping bookings for the office itself (no staff member) are %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  update public.appointments set status = 'cancelled', cancelled_at = now() where id = a_appt;
  begin
    insert into public.appointments (type_id, assignee_id, starts_at, ends_at, block_start, block_end, office_time_zone, contact_name, contact_email)
      values (a_type, s1, '2027-03-01 15:00+00', '2027-03-01 15:30+00', '2027-03-01 15:00+00', '2027-03-01 15:45+00', 'America/New_York', 'Takes the freed time', 'f@example.com') returning id into a_appt2;
    outcome := 'allowed';
  exception when exclusion_violation then outcome := 'refused';
  end;
  r := r || format('%s a cancelled booking frees its time (%s)', case when outcome = 'allowed' then 'PASS' else 'FAIL' end, outcome);

  begin
    insert into public.appointments (type_id, starts_at, ends_at, block_start, block_end, office_time_zone, contact_name, contact_email)
      values (a_type, '2027-04-01 15:30+00', '2027-04-01 15:00+00', '2027-04-01 15:00+00', '2027-04-01 15:30+00', 'America/New_York', 'Backwards', 'x@example.com');
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s an appointment that ends before it starts is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  begin
    insert into public.appointments (type_id, starts_at, ends_at, block_start, block_end, office_time_zone, contact_name, contact_email, sms_consent)
      values (a_type, '2027-04-02 15:00+00', '2027-04-02 15:30+00', '2027-04-02 15:00+00', '2027-04-02 15:30+00', 'America/New_York', 'No proof', 'y@example.com', true);
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s text consent without the time it was given is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  begin
    insert into public.appointments (type_id, starts_at, ends_at, block_start, block_end, office_time_zone, contact_name, contact_email)
      values (a_type, '2027-04-03 15:00+00', '2027-04-03 15:30+00', '2027-04-03 15:00+00', '2027-04-03 15:30+00', 'America/New_York', 'Caps', 'Caps@Example.com');
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s a contact email that is not lower-case is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  begin
    insert into public.appointments (type_id, starts_at, ends_at, block_start, block_end, office_time_zone, contact_name, contact_email)
      values (b_type, '2027-04-04 15:00+00', '2027-04-04 15:30+00', '2027-04-04 15:00+00', '2027-04-04 15:30+00', 'America/New_York', 'Cross', 'z@example.com');
    outcome := 'allowed';
  exception when others then outcome := 'refused';
  end;
  r := r || format('%s a booking for B''s appointment type is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  begin
    insert into public.appointments (tenant_id, type_id, starts_at, ends_at, block_start, block_end, office_time_zone, contact_name, contact_email)
      values (b, b_type, '2027-04-05 15:00+00', '2027-04-05 15:30+00', '2027-04-05 15:00+00', '2027-04-05 15:30+00', 'America/New_York', 'Planted', 'p@example.com');
    outcome := 'allowed';
  exception when others then outcome := 'refused';
  end;
  r := r || format('%s writing an appointment into B is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  begin
    insert into public.appointment_reminders (appointment_id, channel, send_at) values (b_appt, 'email', '2027-02-27 15:00+00');
    outcome := 'allowed';
  exception when others then outcome := 'refused';
  end;
  r := r || format('%s a reminder for B''s appointment is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  insert into public.appointment_reminders (appointment_id, channel, send_at) values (a_appt2, 'email', '2027-02-28 15:00+00');
  begin
    insert into public.appointment_reminders (appointment_id, channel, send_at) values (a_appt2, 'email', '2027-02-28 15:00+00');
    outcome := 'allowed';
  exception when unique_violation then outcome := 'refused';
  end;
  r := r || format('%s the same reminder twice is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  -- Availability rows: a weekly row or a date row, never both; a closed date has no times.
  begin
    insert into public.availability_rules (weekday, on_date, start_time, end_time) values (1, '2027-03-01', '09:00', '10:00');
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s an availability row that is both weekly and for one date is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.availability_rules (on_date, closed, start_time, end_time) values ('2027-03-02', true, '09:00', '10:00');
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s a closed date that still has hours is %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);
  begin
    insert into public.availability_rules (weekday, start_time, end_time) values (2, '17:00', '09:00');
    outcome := 'allowed';
  exception when check_violation then outcome := 'refused';
  end;
  r := r || format('%s hours that end before they start are %s', case when outcome = 'refused' then 'PASS' else 'FAIL' end, outcome);

  update public.appointments set contact_name = 'hijacked' where id = b_appt;
  get diagnostics n = row_count;
  r := r || format('%s A cannot change B''s appointment (%s rows)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  update public.appointment_types set name = 'hijacked' where id = b_type;
  get diagnostics n = row_count;
  r := r || format('%s A cannot change B''s appointment type (%s rows)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  delete from public.appointments where id = b_appt;
  get diagnostics n = row_count;
  r := r || format('%s A cannot delete B''s appointment (%s rows)', case when n = 0 then 'PASS' else 'FAIL' end, n);
  delete from public.availability_rules where id = b_rule;
  get diagnostics n = row_count;
  r := r || format('%s A cannot delete B''s availability (%s rows)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  -- ------------------------------------------------------------ back as the platform: B is untouched
  reset role;
  select count(*) into n from public.appointments where tenant_id = b and contact_name = 'B Person';
  select count(*) + n into n from public.appointment_types where tenant_id = b and name = 'B Consult';
  select count(*) + n into n from public.availability_rules where tenant_id = b and id = b_rule;
  select count(*) + n into n from public.appointment_reminders where tenant_id = b;
  r := r || format('%s B''s type, availability, appointment and reminder are untouched (%s of 4)', case when n = 4 then 'PASS' else 'FAIL' end, n);

  -- Reminders go with their appointment.
  delete from public.appointments where id = a_appt2;
  select count(*) into n from public.appointment_reminders where tenant_id = a;
  r := r || format('%s deleting an appointment deletes its reminders (%s left)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  select count(*) into n from pg_constraint c join pg_class t on t.oid = c.conrelid
    where t.relname in ('appointments', 'appointment_reminders', 'appointment_types', 'availability_rules') and c.contype = 'f'
      and c.conname not like '%\_same\_tenant' and c.confrelid::regclass::text not in ('tenants', 'public.tenants', 'auth.users');
  r := r || format('%s no foreign key leaves the tenant (%s unexpected)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  select count(*) into n from unnest(array['appointment_types', 'availability_rules', 'appointments', 'appointment_reminders']) t
    where has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'select');
  r := r || format('%s anon and signed-in users can''t read the new tables directly (%s open)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  select count(*) into n from unnest(array['appointment_types', 'availability_rules', 'appointments', 'appointment_reminders']) t
    where not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass);
  r := r || format('%s row-level security is on for all four new tables (%s off)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  raise exception E'PHASE 5a GATE RESULTS (rolled back, nothing kept):\n%', array_to_string(r, E'\n');
end $$;
