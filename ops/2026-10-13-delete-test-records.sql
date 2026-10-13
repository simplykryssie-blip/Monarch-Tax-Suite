-- Production (ftthniovwzxztkwtregz): hard-delete Krystal's test records. Approved by the owner on 2026-10-13.
-- Paste the whole file into the Supabase SQL editor and run it once.
-- All or nothing: if any record isn't exactly as expected, if Danica's records would change, or if the totals
-- afterwards aren't 1 customer / 1 license / 1 order, it stops with an error and nothing is deleted.

do $$
declare
  t uuid := '00000000-0000-4000-8000-000000000001';
  lic uuid := '5dd1947a-9b7e-4530-9bc3-0c80bda130f6';   -- MTS-PJG99, krystal@mkbfinancialgroup.com (revoked)
  ord uuid := '9b82cbc5-2915-4954-81fc-ea94b0ed2188';   -- order #1009, $0.00
  custs uuid[] := array[
    '30eaa5b7-985e-4017-a575-e5ce195d53f4',              -- krystal@mkbfinancialgroup.com
    'c606b68b-d9ee-49a7-9fb4-55e635fbba3c',              -- ghl-reviewer-test@example.com
    '6bbcea49-0646-402c-bf0d-0406034a809f'];             -- info@mkbfinancialgroup.com
  danica uuid := 'cead8985-856b-4abb-8965-9eea7ac82ab5';
  keep_lic uuid := '5671a62d-39bb-4b7e-b72c-1e47301db824';  -- MTS-GH6H3
  keep_ord uuid := '643861ea-1862-47a7-b2aa-d9352d44e37c';  -- order #1005
  danica_before text; danica_after text; n int; execs uuid[];
begin
  -- 1. The records are exactly the ones named.
  select count(*) into n from calculator_licenses where id = lic and tenant_id = t and key_prefix = 'MTS-PJG99' and status = 'revoked' and customer_id = custs[1] and order_id = ord;
  if n <> 1 then raise exception 'Stopped: license MTS-PJG99 is not as expected. Nothing deleted.'; end if;
  select count(*) into n from orders where id = ord and tenant_id = t and order_number = 1009 and amount_cents = 0 and customer_id = custs[1];
  if n <> 1 then raise exception 'Stopped: order #1009 is not as expected. Nothing deleted.'; end if;
  select count(*) into n from calculator_customers where tenant_id = t and (id, lower(email)) in ((custs[1], 'krystal@mkbfinancialgroup.com'), (custs[2], 'ghl-reviewer-test@example.com'), (custs[3], 'info@mkbfinancialgroup.com'));
  if n <> 3 then raise exception 'Stopped: the three customers are not as expected. Nothing deleted.'; end if;
  if exists (select 1 from orders where customer_id = any(custs) and id <> ord) or exists (select 1 from calculator_licenses where customer_id = any(custs) and id <> lic) then
    raise exception 'Stopped: these customers have other orders or licenses. Nothing deleted.';
  end if;
  if exists (select 1 from calculator_customers where id = danica and lower(email) <> 'danica_mckethan@hotmail.com') then raise exception 'Stopped: unexpected record. Nothing deleted.'; end if;

  -- Fingerprint of everything tied to Danica, compared at the end.
  select md5(concat_ws('|',
    (select row_to_json(x)::text from calculator_customers x where id = danica),
    (select row_to_json(x)::text from calculator_licenses x where id = keep_lic),
    (select row_to_json(x)::text from orders x where id = keep_ord),
    (select count(*) from automation_events where customer_id = danica or license_id = keep_lic or order_id = keep_ord),
    (select count(*) from calculator_license_events where customer_id = danica or license_id = keep_lic),
    (select count(*) from calculator_installations where customer_id = danica or license_id = keep_lic),
    (select count(*) from calculator_authorized_domains where license_id = keep_lic),
    (select count(*) from onboarding_profiles where license_id = keep_lic)))
  into danica_before;

  -- 2. Delete, children first.
  select coalesce(array_agg(e.id), '{}') into execs from automation_executions e join automation_events v on v.id = e.event_id
    where v.customer_id = any(custs) or v.license_id = lic or v.order_id = ord;
  if exists (select 1 from document_deliveries where execution_id = any(execs) or customer_id = any(custs) or order_id = ord) then
    raise exception 'Stopped: a document delivery points at these records. Nothing deleted.';
  end if;
  delete from automation_executions where id = any(execs);
  delete from automation_events where customer_id = any(custs) or license_id = lic or order_id = ord;
  delete from installation_events where installation_id in (select id from calculator_installations where customer_id = any(custs) or license_id = lic or order_id = ord);
  delete from calculator_installations where customer_id = any(custs) or license_id = lic or order_id = ord;
  delete from calculator_license_events where customer_id = any(custs) or license_id = lic;
  delete from calculator_authorized_domains where license_id = lic;
  delete from crm_oauth_states where license_id = lic;
  delete from crm_lead_settings where license_id = lic;
  delete from crm_connections where license_id = lic or customer_id = any(custs);
  delete from onboarding_links where license_id = lic;
  delete from onboarding_profiles where license_id = lic;
  delete from calculator_leads where license_id = lic;
  delete from lead_delivery_log where license_id = lic;
  delete from download_events where license_id = lic;
  delete from update_checkout_sessions where license_id = lic;
  delete from calculator_licenses where id = lic;                 -- 1. license MTS-PJG99
  delete from orders where id = ord;                              -- 2. order #1009
  delete from calculator_customers where id = custs[1];           -- 3. krystal@mkbfinancialgroup.com
  delete from calculator_customers where id = custs[2];           -- 4. ghl-reviewer-test@example.com
  delete from calculator_customers where id = custs[3];           -- 5. info@mkbfinancialgroup.com

  -- 3. Verify.
  select md5(concat_ws('|',
    (select row_to_json(x)::text from calculator_customers x where id = danica),
    (select row_to_json(x)::text from calculator_licenses x where id = keep_lic),
    (select row_to_json(x)::text from orders x where id = keep_ord),
    (select count(*) from automation_events where customer_id = danica or license_id = keep_lic or order_id = keep_ord),
    (select count(*) from calculator_license_events where customer_id = danica or license_id = keep_lic),
    (select count(*) from calculator_installations where customer_id = danica or license_id = keep_lic),
    (select count(*) from calculator_authorized_domains where license_id = keep_lic),
    (select count(*) from onboarding_profiles where license_id = keep_lic)))
  into danica_after;
  if danica_after is distinct from danica_before then raise exception 'Stopped: Danica''s records would have changed. Nothing deleted.'; end if;
  if (select count(*) from calculator_customers) <> 1 or (select count(*) from calculator_licenses) <> 1 or (select count(*) from orders) <> 1 then
    raise exception 'Stopped: totals would not be 1 customer, 1 license, 1 order. Nothing deleted.';
  end if;
end $$;

-- Shown after a successful run: should be exactly Danica's customer, license MTS-GH6H3 and order #1005.
select 'customer' as record, email as detail from calculator_customers
union all select 'license', key_prefix || ' (' || status || ')' from calculator_licenses
union all select 'order', '#' || order_number || ' $' || to_char(amount_cents / 100.0, 'FM999990.00') from orders;
