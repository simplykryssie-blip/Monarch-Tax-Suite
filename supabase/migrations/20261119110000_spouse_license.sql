-- Contacts, third round: a spouse's driver's license, and whether the client filed with their spouse last year.
-- Additive only: new columns. Nothing is dropped and no existing value is changed. Safe to run again.
--
-- client_spouses.dl_number, dl_state, dl_issued_on, dl_expires_on   the spouse's driver's license.
-- clients.filed_with_spouse_last_year                               true or false once answered; empty until then.
--                                                                   Set on the client about their spouse (typed in or linked).

set local lock_timeout = '10s';

alter table public.client_spouses add column if not exists dl_number text check (dl_number is null or length(dl_number) between 1 and 40);
alter table public.client_spouses add column if not exists dl_state text check (dl_state is null or dl_state ~ '^[A-Z]{2}$');
alter table public.client_spouses add column if not exists dl_issued_on date check (dl_issued_on is null or dl_issued_on between date '1900-01-01' and date '2100-01-01');
alter table public.client_spouses add column if not exists dl_expires_on date check (dl_expires_on is null or dl_expires_on between date '1900-01-01' and date '2100-01-01');

alter table public.clients add column if not exists filed_with_spouse_last_year boolean;
