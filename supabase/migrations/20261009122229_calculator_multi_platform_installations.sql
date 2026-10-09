-- Multi-platform calculator installations and platform-neutral embed licensing.
--
-- * calculator_installations.platform: widened to add 'shopify' and 'wix'.
--   Existing values ('ghl', 'website', 'jotform', 'other') stay valid, so no
--   existing row can be invalidated. 'website' = custom HTML website.
-- * New installation fields: platform_other, installation_method, website_url,
--   requirements, and a single-use customer intake token (hash only).
-- * calculator_licenses.embed_id: public, non-secret id used in embed code.
--
-- Additive except for replacing the platform CHECK constraint with a superset.
-- Safe to re-run.

set local lock_timeout = '10s';

alter table public.calculator_installations
  drop constraint if exists calculator_installations_platform_check,
  add constraint calculator_installations_platform_check
    check (platform in ('ghl','shopify','wix','jotform','website','other'));

alter table public.calculator_installations
  add column if not exists platform_other text check (platform_other is null or char_length(platform_other) <= 80),
  add column if not exists installation_method text not null default 'iframe_embed'
    check (installation_method in ('iframe_embed','ghl_custom_code','shopify_custom_liquid','wix_embed_site','wix_html_embed','jotform_iframe_widget','other')),
  add column if not exists website_url text check (website_url is null or char_length(website_url) <= 500),
  add column if not exists requirements text,
  add column if not exists intake_token_hash text,
  add column if not exists intake_expires_at timestamptz,
  add column if not exists intake_submitted_at timestamptz;
create unique index if not exists calculator_installations_intake_token_hash_key
  on public.calculator_installations (intake_token_hash) where intake_token_hash is not null;

alter table public.calculator_licenses
  add column if not exists embed_id text check (embed_id is null or embed_id ~ '^emb_[A-Za-z0-9_-]{16,64}$');
create unique index if not exists calculator_licenses_embed_id_key on public.calculator_licenses (embed_id);

-- Accurate public description: embeddable via standard HTML iframe; no native
-- platform apps. Only replaces the original seeded text, never an edited one.
update public.products
set description = 'Embeddable federal income tax estimator (tax years 2025 and 2026) for compatible websites, funnels, and forms. Installs with a standard HTML embed on sites that allow custom code, licensed to your authorized domain, with self-service or Done For You installation. Not a native Shopify, Wix, or Jotform app.'
where slug = 'monarch-basic-tax-calculator'
  and description = 'Embeddable federal income tax estimator (tax years 2025 and 2026) for tax professionals'' websites, funnels and forms. Licensed per domain, with self-service or Done For You installation.';

-- Compatibility check (always rolled back): every platform value and the new
-- columns must be writable, including the pre-existing values.
do $$
declare
  c uuid; p uuid; o uuid; l uuid; i uuid; v text;
begin
  begin
    select id into p from public.products where slug = 'monarch-basic-tax-calculator';
    insert into public.calculator_customers (email, full_name) values ('migration-check@invalid.local', 'Migration check') returning id into c;
    insert into public.orders (customer_id, product_id, amount_cents, currency, payment_status, provider_payment_intent_id, installation_type, verification_method)
      values (c, p, 0, 'usd', 'paid', 'pi_migrationcheck0001', 'self_service', 'admin_manual') returning id into o;
    insert into public.calculator_licenses (customer_id, order_id, product_id, status, embed_id)
      values (c, o, p, 'active', 'emb_migrationcheck00000000') returning id into l;
    insert into public.calculator_installations (customer_id, order_id, license_id, product_id, installation_type, platform, installation_method, website_url, domain, requirements, intake_token_hash, intake_expires_at)
      values (c, o, l, p, 'self_service', 'ghl', 'ghl_custom_code', 'https://example.com/calc', 'example.com', 'check', repeat('a', 64), now()) returning id into i;
    foreach v in array array['ghl','shopify','wix','jotform','website','other'] loop
      update public.calculator_installations set platform = v, platform_other = case when v = 'other' then 'Squarespace' end where id = i;
    end loop;
    raise exception 'monarch_compat_ok';
  exception when others then
    if sqlerrm <> 'monarch_compat_ok' then
      raise exception 'Multi-platform compatibility check failed: %', sqlerrm;
    end if;
  end;
end $$;
