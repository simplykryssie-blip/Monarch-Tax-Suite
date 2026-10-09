-- Removes Monarch's lead storage (Monarch no longer stores calculator leads).
-- NOT YET APPLIED: Supabase holds DROP statements for owner confirmation.
-- Safeguard: aborts if any lead row exists, so personal data is never removed
-- implicitly; such rows would have to be reviewed in a separate migration.
-- The application no longer reads or writes this table.
set local lock_timeout = '10s';

do $$
begin
  if to_regclass('public.calculator_leads') is not null and exists (select 1 from public.calculator_leads) then
    raise exception 'calculator_leads contains rows. Review them and remove them in a separate, explicit migration before running this one.';
  end if;
end $$;

drop function if exists public.crm_claim_lead(uuid, timestamptz);
drop function if exists public.crm_due_lead_ids(integer, uuid);
drop table if exists public.calculator_leads;

