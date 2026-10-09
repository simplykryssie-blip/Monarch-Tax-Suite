# Monarch Tax Suite launch checklist

Evidence levels: **Verified** (observed result), **Implemented, untested**,
**Blocked**, **Needs owner approval**. Last reviewed 2026-10-09.

| Item | Status | Evidence |
|---|---|---|
| Dev password removed from README | Verified (files) | Commit on branch `claude/launch-readiness-hardening`. Still present in git history since the first commit. |
| Dev account rotated/disabled | Needs owner approval | Account is in the shared Verexa project, not Monarch; not reachable or modified. Absent from Monarch (0 matches, not an admin). |
| No other secrets committed | Verified (scan) | Pattern scan of tracked files and history found none (Stripe, webhook, JWT, private keys). |
| Webhook signature + idempotency + refunds/disputes | Implemented, untested live | 110 pre-existing automated tests pass. No live or test-mode event has ever reached the endpoint (0 orders, 0 stripe_events). |
| Test/live event mode guard | Implemented, untested live | 4 automated tests; preview build succeeded. |
| Stripe live webhook delivery | Blocked | Sandbox cannot reach the site; owner must send a test event (steps in final report). |
| Basic Calculator price ID | Needs owner approval | Owner-supplied ID and stored ID differ; neither changed. Verify in Stripe/admin first. |
| Product published | Blocked | Both products are drafts; price unverified. |
| License issuance + key shown once | Verified (code review) | Admin-only, hash-only storage, paid-order required. Not exercised with a real order. |
| Automatic license email | Blocked | No email provider in the project; manual process documented. |
| Embed domain lock | Implemented, tested (unit) | Server-set frame-ancestors + Referer check; direct visits refused. Browser enforcement previously tested in Chromium only. |
| `/api/license/validate` rate limit | Implemented, untested live | 12 automated tests. Needs migration `20261009200000` applied (owner approval); fails open until then. |
| `MONARCH_ENCRYPTION_KEY` | Blocked | Not present in any Vercel environment. `crm_connections` is empty, so no existing data depends on a prior key. |
| Migration `20261009180000_remove_lead_storage` | Needs owner approval | Not applied. `calculator_leads` has 0 rows and no code references it. Safe to leave pending. |
| Legal pages | Implemented, draft | `/terms`, `/privacy`, `/refunds`, marked draft; need owner/counsel review. |
| GoHighLevel / Shopify / Wix / Jotform installs | Blocked | No authorized test accounts; not verified on any platform. |
| Typecheck/build | Verified (Vercel preview) | Preview deployment of the branch built successfully. Lint not run (registry unreachable from sandbox). |

## Platform compatibility checklist (run per platform before promising support)

1. Create a test license and authorize the test site's domain.
2. Add the embed using the platform's documented method; confirm the calculator renders on the authorized domain.
3. Confirm it does **not** render on an unauthorized domain, and not when the embed URL is opened directly.
4. Check mobile and desktop widths, including scrolling inside the frame.
5. Confirm only licensed tax years appear.
6. If the lead form is on, submit a test lead and confirm it arrives in the customer's own endpoint.
7. Revoke the license and confirm the embed stops rendering.
