-- Phase 5c.3: signing in the portal, Form 8879 and Form 8821 (additive).
--
-- document_deliveries.client_id   the client a signature request was made for, so the portal can list "to sign" and
--                                 "signed" for that client only. Same-tenant key.
-- tenant_profiles.ptin            the firm's preparer tax identification number (merge field {{firm_ptin}}).
-- tenant_profiles.caf_number      the firm's CAF number (merge field {{firm_caf_number}}, used on Form 8821).
--
-- Same tenant rules as every table since Step 0.

alter table public.document_deliveries add column if not exists client_id uuid;
alter table public.tenant_profiles add column if not exists ptin text;
alter table public.tenant_profiles add column if not exists caf_number text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'document_deliveries_client_same_tenant') then
    alter table public.document_deliveries add constraint document_deliveries_client_same_tenant foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete set null (client_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_profiles_ptin_check') then
    alter table public.tenant_profiles add constraint tenant_profiles_ptin_check check (ptin is null or ptin ~ '^P[0-9]{8}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_profiles_caf_check') then
    alter table public.tenant_profiles add constraint tenant_profiles_caf_check check (caf_number is null or caf_number ~ '^[0-9]{4}-?[0-9]{5}$');
  end if;
end $$;
create index if not exists document_deliveries_client_idx on public.document_deliveries (tenant_id, client_id, created_at desc) where client_id is not null;
