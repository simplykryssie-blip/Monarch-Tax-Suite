-- Appointments: the reminder and cancellation messages can be edited too, next to the confirmation. Until an office edits them
-- the built-in wording is used.
-- Additive only: new optional columns on appointment_messages. Nothing is dropped and no existing value is changed. Safe to run again.
--
-- appointment_messages (new columns)   reminder_subject, reminder_body, reminder_sms: what the reminder email and text say.
--                                      cancel_subject, cancel_body: the email a client gets when an appointment is cancelled.
--                                      Empty = the built-in wording. Placeholders like {{name}} and {{date_time}} are filled in when sent.

set local lock_timeout = '10s';

alter table public.appointment_messages add column if not exists reminder_subject text check (reminder_subject is null or length(reminder_subject) <= 200);
alter table public.appointment_messages add column if not exists reminder_body text check (reminder_body is null or length(reminder_body) <= 4000);
alter table public.appointment_messages add column if not exists reminder_sms text check (reminder_sms is null or length(reminder_sms) <= 320);
alter table public.appointment_messages add column if not exists cancel_subject text check (cancel_subject is null or length(cancel_subject) <= 200);
alter table public.appointment_messages add column if not exists cancel_body text check (cancel_body is null or length(cancel_body) <= 4000);
