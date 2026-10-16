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

## White label per tenant (Settings → Branding)

Each tenant sets its own brand in `tenant_brands` (one row per tenant, `tenant_id`, row-level security): name, tagline,
logo, small logo, three colours, support email, an optional sign-in address, and two switches.

| Where | What it shows |
|-------|---------------|
| Emails to the tenant's customers | its name or logo, menu colour as the header, its support address |
| Public forms and the confirmation page | its logo and colours as the default look (a form's own Look settings still win) |
| Admin shell and sign-in page | the platform brand, with the account as a chip, unless **White-label my admin and sign-in page** is on; then its logo, name, menu colour and accent colour |
| "Powered by Verexa HQ" | only when the tenant turns on **Show "Powered by Verexa HQ"**; off by default |

Sign-in: when a visitor comes in on the tenant's registered sign-in address (`app_host`, which must also be added to the
app's hosting), the sign-in page shows its brand. This is the one logged platform lookup (`brand_host`), and it reads
only the public brand fields.

Not yet branded for new tenants: Monarch's storefront, calculators, setup and license pages (they are Monarch's
products), the signing and document download pages, and the Office area. Those take the same `Brand` object when they
are opened to other tenants.
