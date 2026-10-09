# Monarch Tax Suite launch checklist

Evidence levels: **Verified** (observed result), **Implemented, untested**,
**Blocked**, **Needs owner approval**. Last reviewed 2026-10-09 (hardening integration branch).

Nothing marked "Implemented" or "automated" below has been seen working with a real payment, a real GoHighLevel account or a real customer embed. Only rows marked **Verified** were observed.

| Item | Status | Evidence |
|---|---|---|
| Dev password removed from README | Verified (files) | Removed in this change. Still present in git history since the first commit. |
| Dev account rotated/disabled | Needs owner approval | Account is in the shared Verexa project, not Monarch; not reachable or modified. Absent from Monarch (0 matches, not an admin). |
| No other secrets committed | Verified (scan) | Pattern scan of tracked files and history found none (Stripe, webhook, JWT, private keys). |
| Webhook signature + idempotency + refunds/disputes | Implemented, untested live | 110 pre-existing automated tests pass. No live or test-mode event has ever reached the endpoint (0 orders, 0 stripe_events). |
| Test/live event mode guard | Implemented, untested live | 4 automated tests. After this is deployed, the webhook refuses (HTTP 400) any event whose live/test mode differs from the mode of `STRIPE_SECRET_KEY`, or when that key's mode is unrecognized. Check the key mode in the admin Stripe panel after deploy. |
| Stripe live webhook delivery | Blocked | Sandbox cannot reach the site; owner must send a test event (steps in final report). |
| Basic Calculator price ID | Needs owner approval | Owner-supplied ID and stored ID differ; neither changed. Verify in Stripe/admin first. |
| Product published | Blocked | Both products are drafts; price unverified. |
| License issuance + key shown once | Verified (code review) | Admin-only, hash-only storage, paid-order required. Not exercised with a real order. |
| Automatic license email | Not built | Monarch sends no email. License keys are delivered by hand (see monarch-commerce.md). |
| Embed domain lock | Implemented, tested (unit) | The browser enforces `frame-ancestors` against the real parent page (not a value the visitor can set); the Referer is only an extra check, and a missing Referer does not unlock anything. Opening the embed URL directly is refused when the browser says so (`Sec-Fetch-Dest: document`). An unknown embed id is refused on the live site (observed). A licensed embed inside GoHighLevel has **not** been tested. |
| `/api/license/validate` rate limit | Implemented, untested live | 12 automated tests. **Not active in production** until migration `20261009200000` is applied (owner approval); until then it fails open (requests allowed). |
| `MONARCH_ENCRYPTION_KEY` | Verified (set) | Added to Vercel Production as a Sensitive variable on 2026-10-09; the live `/integrations` page shows the license-key form (it shows "not available" when the key is missing or invalid). The value was not read. Do not change or delete it once a lead destination has been saved. |
| Migration `20261009180000_remove_lead_storage` | Needs owner approval | Not applied. `calculator_leads` has 0 rows and no code references it. Safe to leave pending. |
| Legal pages | Implemented, draft | `/terms`, `/privacy`, `/refunds`, marked draft; need owner/counsel review. |
| GoHighLevel / Shopify / Wix / Jotform installs | Blocked | No license is issued yet and no platform has been tested. The customer's $75 order is recorded as paid; her license, authorized GoHighLevel host and a test lead are still to do. |
| Full 2026 calculator in the licensed embed | Implemented, tested (automated + local browser) | Matches the published demo on 1,500 random scenarios; starts blank. Not yet seen inside a licensed embed. |
| Lead delivery (signed webhook, contact details + results) | Implemented, tested (automated) | Delivery, retry with the same idempotency key, and failure handling are unit tested. **Not** tested against a real GoHighLevel workflow. The CRM workflow creates the contact and sends any email; Monarch sends no email. |
| Typecheck, lint, tests, build | Verified | Run on the integration branch; results are in the pull request. |
| Preview/other deployments without database settings | Implemented, tested (automated) | They show a "not configured" page (HTTP 503) listing variable names only, and never fall back to the production database. Production settings are unchanged. |

## Platform compatibility checklist (run per platform before promising support)

1. Create a test license and authorize the test site's domain.
2. Add the embed using the platform's documented method; confirm the calculator renders on the authorized domain.
3. Confirm it does **not** render on an unauthorized domain, and not when the embed URL is opened directly.
4. Check mobile and desktop widths, including scrolling inside the frame.
5. Confirm only licensed tax years appear.
6. If the lead form is on, submit a test lead and confirm it arrives in the customer's own endpoint.
7. Revoke the license and confirm the embed stops rendering.
