-- Documents: match the boxes of an official fillable PDF (Form 8879, Form 8821...) to client and firm details.
-- Additive only: one new column on documents. Nothing is dropped and no existing value is changed; every existing document
-- keeps working exactly as before (an empty list means each box is used under its own name). Safe to run again.
--
-- documents.field_map   for a PDF: its own box names matched to what goes in them, such as {"f1_01[0]": "client_name"}.

set local lock_timeout = '10s';

alter table public.documents add column if not exists field_map jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'documents_field_map_is_object') then
    alter table public.documents add constraint documents_field_map_is_object check (jsonb_typeof(field_map) = 'object');
  end if;
end $$;
