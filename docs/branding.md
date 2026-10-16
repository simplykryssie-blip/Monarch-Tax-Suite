# Branding: Verexa HQ (platform) and tenants

**The product is Verexa HQ.** Its name, logo and tagline ("Streamline. Automate. Grow.") appear wherever the software
itself speaks: the sign-in family of pages, the admin shell (sidebar, top bar, footer), browser tab titles, favicon,
default share image, PDF producer, the office area title and system error pages. They live in `lib/platform-brand.ts`
and `public/brand/verexa-*`, `public/verexa-*`.

**Each tenant keeps its own brand** for what its customers see. Monarch Tax Suite is tenant #1: its storefront,
calculators, license emails, setup pages, terms and privacy policy, forms and documents still say Monarch. In the admin
the working account shows beside the platform brand as an "Account" chip (`tenantBrand()` in `lib/platform-brand.ts`).
Tenants without their own assets show the name from their firm profile (Settings → Firm profile).

Not changed on purpose:
- Monarch's customer-facing pages and emails (shop, embed, downloads, update, refunds, terms, privacy, setup and install).
- The Monarch product names (Monarch Basic Tax Calculator, "Monarch Tax Suite license").
- The gold accent colours across the admin. The blue and green of the Verexa HQ logo are used in the sidebar plate,
  sign-in panel and tagline strip; a full re-colour of the admin would be a separate change.

Adding a tenant brand: add its id, name and optional mark to `TENANT_BRANDS`, or let it use its firm profile name.
