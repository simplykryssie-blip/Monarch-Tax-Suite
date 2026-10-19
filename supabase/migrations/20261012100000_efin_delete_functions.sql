-- EFIN Management: permanent deletion functions (all or nothing).
-- Kept in their own file because they contain DELETE statements, which some SQL tools refuse to run unattended.
-- Run this in the Supabase SQL editor AFTER 20261011100000_efin_management.sql. Safe to run more than once.
-- Until it is run, "Delete permanently" shows a message naming this file; archive, restore and every other feature work.

-- ------------------------------------------------------------------------------------------ permanent deletion (atomic)
-- Only for records that never went live: an EFIN with an assignment that was ever activated (or later suspended, revoked or
-- expired) must be archived instead, so its history stays. Audit events are kept either way and never contain identifiers.
create or replace function public.efin_delete_efin(p_efin uuid, p_actor uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare e record;
begin
  select * into e from efin_records where id = p_efin;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists (select 1 from efin_assignments where efin_id = p_efin and (activated_at is not null or state in ('active','suspended','revoked','expired'))) then
    raise exception 'HAS_HISTORY';
  end if;
  delete from renewal_tasks where subject_type = 'efin' and subject_id = p_efin;
  delete from compliance_documents where subject_type = 'efin' and subject_id = p_efin;
  delete from filing_relationships where efin_id = p_efin;
  delete from efin_assignments where efin_id = p_efin;
  delete from efin_records where id = p_efin;
  insert into audit_events (actor_id, actor_email, event_type, target_type, target_id, organization_id, changes)
  values (p_actor, p_email, 'efin.deleted', 'efin', p_efin, e.organization_id, jsonb_build_object('last4', e.efin_last4));
end $$;

create or replace function public.efin_delete_organization(p_org uuid, p_actor uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare o record; ef uuid; pids uuid[]; n_efin int := 0;
begin
  select * into o from organizations where id = p_org;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists (select 1 from efin_assignments a join efin_records r on r.id = a.efin_id where a.organization_id = p_org and r.organization_id <> p_org) then
    raise exception 'ASSIGNED_ELSEWHERE';
  end if;
  select coalesce(array_agg(distinct person_id), '{}') into pids from organization_roles where organization_id = p_org;
  for ef in select id from efin_records where organization_id = p_org loop
    perform public.efin_delete_efin(ef, p_actor, p_email);
    n_efin := n_efin + 1;
  end loop;
  delete from renewal_tasks where organization_id = p_org;
  delete from organizations where id = p_org;
  -- people who only ever belonged to this organization and have no login go with it (their PTIN credentials cascade)
  delete from people where id = any(pids) and user_id is null and not exists (select 1 from organization_roles r where r.person_id = people.id);
  insert into audit_events (actor_id, actor_email, event_type, target_type, target_id, organization_id, changes)
  values (p_actor, p_email, 'organization.deleted', 'organization', p_org, p_org, jsonb_build_object('legal_name', o.legal_name, 'efins_deleted', n_efin));
end $$;

revoke execute on function public.efin_delete_efin(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.efin_delete_organization(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.efin_delete_efin(uuid, uuid, text) to service_role;
grant execute on function public.efin_delete_organization(uuid, uuid, text) to service_role;
