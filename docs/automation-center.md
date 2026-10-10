# Monarch Tax Suite: Automation Center

Admin guide, setup requirements and status. Open it in the admin app under **Operations → Automation** (`/automation`).

## What it does

When something happens in Monarch (a license is created, a payment is verified, a customer connects GoHighLevel, a lead is delivered or fails), the app records an **event**. Any **active workflow** listening for that event then runs its **steps** (send an email, record a note). Everything is visible under **Activity**. Business actions never wait on, or fail because of, email: a payment, license or lead always goes through first.

| Screen | Use it to |
| --- | --- |
| Overview | See active/paused workflows, successful and failed runs, emails sent, items waiting to retry, recent activity. Add the standard set the first time. |
| Workflows | Create, edit, turn on/pause, duplicate, run a **safe test**, see recent runs, remove (archived if it ever ran). |
| Email templates | Edit subject and message, preview with sample data, send a test to yourself, turn on/off, see which workflows use it. |
| Activity | Every run with status, tries, steps, email id and a plain-language problem. **Retry** failed runs. Revoke customer setup links. Admin change log. |
| Settings | Read-only status of Resend, GoHighLevel, Stripe, encryption key, scheduler. Secrets are never shown. |

### The standard workflows (added paused by "Add standard templates and workflows"; review, then turn on)

1. **Manual license created** → onboarding email with a secure setup link.
2. **Paid license created** → same, but only after a signature-verified Stripe payment (idempotent per order).
3. **License key issued** (optional, off) → "setup is ready".
4. **Onboarding started** → records that the customer opened the setup link (not that setup is complete).
5. **GoHighLevel connected** → confirmation, only after the connection was verified and saved.
6. **Installation recorded / verified** → guidance and completion emails.
7. **Lead delivered** → records the outcome (no lead contents).
8. **Lead delivery failed** (off) → emails the customer only for connection (auth) failures, at most once a day.
9. **License suspended / revoked** (off) → customer notice.

## Secure setup links

The customer's email contains `/setup?t=<token>`. The token is random (256-bit), only its SHA-256 hash is stored, it expires after 14 days, and you can revoke it under Activity. Opening it swaps the token for a signed HttpOnly session cookie scoped to `/integrations` and removes it from the address bar. Every later request re-checks the stored link, so revoking or expiring it ends the session immediately. Sending a new setup email retires older links only after the email actually went out.

## Environment variables

| Variable | Needed for | Notes |
| --- | --- | --- |
| `RESEND_API_KEY` | Sending email | Existing variable. (`RESEND_SECRET_KEY` is accepted as a fallback.) Server only. |
| `MONARCH_EMAIL_FROM` | Sender | **Required.** e.g. `Monarch Tax Suite <notifications@your-verified-domain>`. No default is assumed. |
| `MONARCH_EMAIL_REPLY_TO` | Replies | Optional. |
| `MONARCH_SUPPORT_EMAIL` | Footer/support address | Optional, defaults to info@monarchtaxsuite.com. |
| `AUTOMATION_ADMIN_EMAIL` | "Send to support" steps | Optional, defaults to the support address. |
| `AUTOMATION_TEST_RECIPIENTS` | Preview/dev | Comma-separated. **Outside Production, email is sent only to these addresses.** |
| `MONARCH_ENCRYPTION_KEY` | Setup-link sessions | Already used by the CRM features. Do not rotate casually. |
| `CRON_SECRET` | Retry scheduler | Needed for `/api/automation/run` (see below). |

## Resend DNS and domain status

`monarchtaxsuite.com` is **not assumed verified**. Settings shows the sender's domain and whether Resend lists it as verified. To send from it, add the domain in Resend, add the SPF/DKIM (and optionally DMARC) records Resend shows to your DNS, wait for "Verified", then set `MONARCH_EMAIL_FROM`. Until then, send from a domain that is verified, or use test mode.

## Retries and the scheduler

Failed email attempts that look temporary retry automatically with backoff (1 min, 5 min, 30 min, 2 h, ...), up to each workflow's attempt limit (default 4). Configuration problems (missing key, unverified domain) and permanent rejections do not retry; they appear as **Failed** with a plain-language reason and a **Retry** button. A retry resumes after the last step that succeeded, so an email is never sent twice.

Scheduled retries run when something calls `GET/POST /api/automation/run` with `Authorization: Bearer <CRON_SECRET>`. No schedule is added to `vercel.json` (a plan limit could otherwise block deploys). Use any scheduler you already have (for example a Vercel cron on a plan that allows it, or an external uptime/cron service) pointed at that URL. Without a scheduler, retries still work by hand from Activity.

## Privacy and security

* Admin-only: every page and action calls `requireAdmin` on the server; all automation tables are RLS-enabled with no anon/authenticated access (service role only).
* Events and runs store ids, statuses and error categories only. **No lead contents, license keys, OAuth tokens, webhook URLs or secrets** are stored or logged; errors are sanitized before they are saved or shown.
* Template variables are validated when you save and HTML-escaped when rendered.
* Test sends go only to your own sign-in address, are labelled TEST, and use sample data. They are rate limited and audited.
* All admin changes (create, edit, activate, pause, duplicate, remove, retry, test, revoke) are written to the audit log.
* Lead delivery retries are bounded and in-request (a few seconds); the Automation Center only receives the outcome.

## Applying the database migration (needs your approval)

`supabase/migrations/20261010200000_automation_center.sql` is additive (6 new tables, no changes to existing ones). It is **not** applied to Production by this pull request. Apply it to Preview/test first, run the checks below, then to Production when you approve. Until it is applied, the Automation Center shows a "database setup required" notice and all other features keep working.

## Status against the request

**Completed and covered by automated tests:** manual-license onboarding email with a secure link; paid license from verified Stripe event only, idempotent, payment unaffected by automation failures; onboarding started (no false "completed"); GHL connected only after verified save; installation events; lead delivered/failed events with bounded retries; failed-delivery queue with manual retry; suspension/revocation notices; workflow create/edit/pause/duplicate/test/archive; template validation, escaping, preview, test-send, usage list; idempotent event processing; retry/backoff/resume; test-mode recipient allow-list; sanitized errors; setup-link hashing/expiry/revocation.

**Partial:**
* *Lead retention queue.* Monarch deliberately does not store lead contents (a published privacy promise), so a failed lead cannot be re-sent later from the admin queue. Failed deliveries are recorded (without contents), retried in-request a bounded number of times, and the customer can be told to reconnect. Storing leads for later replay is a product/privacy decision for the owner.
* *Scheduler.* Endpoint exists; a scheduler must be configured by you.
* *Resend sending.* Works with the configured key; real delivery depends on a verified sender domain and has not been exercised against Production.

**Blocked / needs you:** applying the migration to Production; `MONARCH_EMAIL_FROM` and a verified Resend domain; `CRON_SECRET` + a scheduler. "Approaching expiration" is not applicable: licenses have no expiry date in the current data model.

**Not claimed:** nothing here has been deployed or tested in Production.

---

# Customer onboarding wizard (added in the onboarding PR)

## The flow you get

1. **You** create the customer's license (Orders → internal license, or reconcile a payment). The license is saved and, for manual licenses, **activated automatically** (a key is issued but not shown; the customer uses their link). You do not authorize any domain.
2. **Monarch emails the customer** a secure setup link (14 days, revocable, only its hash stored). The result (sent / failed, Resend message id) appears in the **Customer onboarding** panel on the license page.
3. The customer opens the link → `/integrations` loads their license with no key typed. They:
   1. confirm **details** (name, business, email, phone; prefilled from the license);
   2. enter **their own website address**, review, and confirm. It is normalized, rejected if malformed, shared-host, wrong protocol, or already registered to another license, and limited by the license's domain count; then authorized with the existing rules;
   3. connect **GoHighLevel** (native OAuth, when the app is configured) or paste a **workflow link** (webhook fallback with step-by-step instructions); one is enough;
   4. press **Test connection** (fake sample lead; success is shown only when GoHighLevel or the webhook endpoint accepted it);
   5. copy their **own calculator code** (shown only after the domain is authorized) and press **Finish setup**.
4. **Finish setup** completes only when details, an authorized domain, a connected destination and a passed test all exist. It is recorded once; a confirmation email with installation instructions is sent through Resend.
5. If the link expired, the page offers "email me a new link". It answers identically for any address, is rate limited, and sends only to the email already on a license.

## Admin: license page → Customer onboarding

Status (Not started / Invitation sent / In progress / Awaiting CRM connection / Ready to install / Completed / Needs attention), setup-email result and Resend id, link state (active, expired, replaced; first opened), details, authorized website, CRM method and test result, installation record, last activity, steps left, and anything needing attention. **Resend setup email** issues a fresh link (limit 3 per license per hour; never creates a license). The earlier link is retired only after the new email is sent.

## Migrations (additive, not applied to Production by the PR)

1. `20261010200000_automation_center.sql` (PR #8)
2. `20261010210000_onboarding_profiles.sql` — one new table; depends on #1's `set_updated_at` function from the commerce migration.

## What is verified and what is not

*Automated (235 tests):* one invitation per manual license; failed email keeps one intact license and is retryable; resend limits; no customer enumeration; domain entry, normalization, conflicts and limits; status transitions; completion gated on a passed CRM test and idempotent; completion email uses only the customer's own code; plus the existing OAuth, webhook, test-lead, tenant-isolation and embed-enforcement suites.

*Needs you (manual):* a real Resend send (needs `MONARCH_EMAIL_FROM` on a verified domain); a real GoHighLevel OAuth install; the browser walkthrough on Preview with a test license and an allow-listed email; applying the two migrations.

*Decisions/limits:* **paid** licenses are still created pending and an administrator issues the key (existing control); the customer's first email says it is being prepared and a second email goes out when you issue the key. The setup link is reusable until it expires or is replaced, so customers can reopen their instructions after completing. Installation status is "confirmed by an administrator"; Monarch does not crawl the customer's site.
