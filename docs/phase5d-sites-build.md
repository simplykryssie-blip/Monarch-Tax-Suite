# Phase 5d — website builder: build notes

An office builds its own website on the platform: blank canvas, sections and blocks, one-click publish, a free address on the platform domain and any domain of its own.

## What it does
| Piece | Where |
|---|---|
| Editor: pages, menu order, add/remove pages, publish / take offline | `/sites` (main workspace, Operations → Website) and `/practice/website` (independent PTIN workspace) |
| Page editor: title, description, blocks (section, heading, text, image, button, booking, form, space, divider), draft preview | `/sites/pages/<id>`, `/practice/website/pages/<id>` |
| Pictures | uploaded from the page editor into the office's own private image library, shown through `/media` |
| Addresses: change the free address label; connect a custom domain, see the DNS records, check, remove | `/sites/domains`, `/practice/website/domains` |
| Public site | served on the office's own hosts only: `<label>.<platform domain>` and connected custom domains |

**Blank canvas.** There are no templates. A new site has one empty home page. **No custom HTML or script** exists: every block is validated plain data (`lib/sites/blocks.ts`); links are limited to https, same-site paths, mailto and tel.

**Draft and published.** Each page keeps a draft and a published copy. "Publish" copies every draft over its published copy in one statement (`site_publish`). Visitors never see a draft. "Take offline" hides the whole site and keeps the pages.

## How a request finds a site
The proxy decides from the Host header (`lib/sites/host.ts`):
- the app's own address, `*.vercel.app`, localhost, any host in `APP_HOSTS`, the bare platform domain and reserved labels (`www`, `app`, `book`, `mail`, …) are **the application**: no site is ever served there;
- `<label>.<platform domain>` is always a site address (an unknown label shows a plain "not available" page);
- any other host is looked up in `site_domains` (cached 30 s); if an office connected it, the site is served, otherwise the application serves it as before.

On a site address only these paths are served: the site's pages, `/book/…`, `/f/…`, `/media/…`. Login, admin and APIs are not reachable there. A booking page or form embedded in a site is the office's own: `tenantForHost` also resolves a site address to its office.

**Testing without DNS.** Outside production, `/s/<address>/…` on the deployment's own address shows that site, so a Preview can be tested before any domain points at it. (Embedded booking pages and forms resolve to the Monarch account in this mode; on a real address they resolve to the site's office.)

## Settings (names only, values go in Vercel, never in chat)
- `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` (the project is in a team, so set this too): needed for **custom domains**. Without them everything else works and the Domains page says custom domains are not turned on.
- `PLATFORM_SITE_DOMAIN` (optional, default `monarchtaxsuite.com`): the domain office addresses live under. When the platform moves to Verexa HQ this is the only change; nothing is hard-coded.
- `APP_HOSTS` (optional): comma-separated hosts that must always serve the application and never a site.

## DNS and hosting still to do outside the code
- The wildcard `*.<platform domain>` must be attached to the Vercel project (with Vercel's nameservers, per the DNS plan) before office addresses answer. Until then use the `/s/<address>` test path on a Preview.
- **The main office** connects its own regular domain like any office (Addresses → Your own domain). If that domain is currently used by the application (for example an old alias), connecting it moves it to the website; keep the application at its own address, or list the host in `APP_HOSTS` to keep it on the application.

## Migration
`20261115090000_website_builder` (additive). Gate: `supabase/tests/phase5d_isolation.sql` (30 checks, rolled back).

## Limits
- One site per office (tenant), up to 20 pages, 60 blocks per page, 12 inside a section, 3 custom domains.
- The editor is in the main workspace and the independent PTIN workspace. The office area (EROs inside a bureau) has no editor yet: a bureau's offices share one account, so a site there would be the bureau's, not each office's.
- A custom domain waits on DNS: the Domains page shows the record to add and a **Check now** button.
