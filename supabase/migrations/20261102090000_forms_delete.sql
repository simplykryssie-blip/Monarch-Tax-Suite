-- Forms: a real Delete. An administrator can delete a form for good, and with it, only when they choose "Delete with
-- submissions", its submission rows (answers, uploads, internal values, events). Leads, contacts, customers and tax
-- offices made from those submissions are separate records and are never touched. Stored files (uploads, PDFs) are
-- purged by the app after the 24-hour delete window.
--
-- Submissions stay protected everywhere else: the guard still refuses to delete a submitted form, except inside
-- delete_form_with_submissions for that one form. The function runs as the caller, so the tenant policies apply and a
-- tenant can only ever delete its own form.

create or replace function public.form_submissions_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status not in ('draft', 'spam') and coalesce(current_setting('app.deleting_form', true), '') <> old.form_id::text then
      raise exception 'SUBMISSION_KEPT: submitted forms cannot be deleted';
    end if;
    return old;
  end if;
  if old.status <> 'draft' then
    if new.status = 'draft' then
      raise exception 'SUBMISSION_LOCKED: a submission cannot become a draft again';
    end if;
    if new.answers is distinct from old.answers or new.form_id is distinct from old.form_id or new.version_id is distinct from old.version_id
       or new.number is distinct from old.number or new.submitted_at is distinct from old.submitted_at or new.started_at is distinct from old.started_at
       or new.signature is distinct from old.signature or new.consent_text is distinct from old.consent_text or new.consented_at is distinct from old.consented_at
       or new.is_test is distinct from old.is_test then
      raise exception 'SUBMISSION_LOCKED: answers cannot be changed after submission';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Deletes one form and all its submission rows. Returns how many submissions went. Uploads, internal values, versions
-- and events go with them (their foreign keys cascade).
create or replace function public.delete_form_with_submissions(p_form_id uuid) returns integer
language plpgsql security invoker set search_path = public as $$
declare
  n integer;
begin
  update public.forms set current_version_id = null where id = p_form_id;
  if not found then
    raise exception 'FORM_NOT_FOUND';
  end if;
  perform set_config('app.deleting_form', p_form_id::text, true);
  delete from public.form_submissions where form_id = p_form_id;
  get diagnostics n = row_count;
  perform set_config('app.deleting_form', '', true);
  delete from public.forms where id = p_form_id;
  return n;
end $$;
revoke all on function public.delete_form_with_submissions(uuid) from public, anon, authenticated;
grant execute on function public.delete_form_with_submissions(uuid) to service_role, tenant_app;

notify pgrst, 'reload schema';
