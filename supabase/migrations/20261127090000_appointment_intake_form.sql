-- Appointments: an appointment type can ask the client to fill in one of the office's Forms before the visit.
-- Additive only: one new nullable column. Nothing is dropped and no existing value is changed. Safe to run again.
--
-- appointment_types.intake_form_id   the form (from the Forms tab) clients are asked to complete. Empty = no form.
--                                    Must be a form of the same workspace. If the form is removed for good, the type
--                                    simply stops asking for it.

set local lock_timeout = '10s';

alter table public.appointment_types add column if not exists intake_form_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'appointment_types_intake_form_id_same_tenant') then
    alter table public.appointment_types
      add constraint appointment_types_intake_form_id_same_tenant
      foreign key (tenant_id, intake_form_id) references public.forms (tenant_id, id) on delete set null (intake_form_id);
  end if;
end $$;
