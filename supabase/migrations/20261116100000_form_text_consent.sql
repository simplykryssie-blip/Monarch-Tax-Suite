-- Phase 5e: whether the person ticked "it's OK to text me" on a form that adds respondents to Leads (additive).
alter table public.form_submissions add column if not exists text_consent boolean not null default false;
