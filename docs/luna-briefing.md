# Briefing for Luna (tester): where everything stands (written after the 2026-10-30 session)

## Who does what
Krystal directs. The builder (Claude) builds and reports. Luna tests and relays. Jade audits. Nothing goes to production without Krystal's word, one piece at a time.

## Ground rules that still apply
- **Preview first.** Production gets one piece at a time, on Krystal's separate word. Nothing is bundled beyond the approved scope; flag extras before doing them.
- **No passwords in chat.** The one exception is a throwaway test login Krystal herself asks for.
- **Plain words.** Report what you saw, not what you assume. "Verified by design" (for example a held-back email) is not the same as "seen working".
- **Tenant separation is the first thing to protect:** one workspace's information must never show in another's.
- The approved list of what each plan includes is `docs/tier-capabilities-spec.md`. The public pages and the plan menus must match it exactly. Nothing is promised that isn't built.

## How to get into the test site (the loop that burned three routes)
- Test site: `preview.verexahq.com`. It is a separate system from production, with its own passwords. Your browser's saved production login is rejected there.
- **Saved test login:** `info@monarchtaxsuite.com`, password in the vault under the test site (Krystal saved it). This account belongs to the **Monarch** workspace and **PTIN Walk Test**.
- **It may ask for a six-digit code** (an old authenticator on that test account). Removal was requested and is waiting for an on-screen confirmation. If asked for a code, stop and tell the builder.
- **Other test accounts** (`mwalk`, `ptinmenu`, `ptinwalk`) exist, but their passwords are not saved anywhere usable, and test-site reset emails are throttled. Use `info@` first.
- **Workspace chooser (Preview only):** at `/switch-workspace` an account in more than one workspace picks which to open. With Monarch plus PTIN Walk Test, you land in Monarch first, then choose PTIN Walk Test.
- **Email on Preview:** only addresses on the test list are emailed (these `kshanelle83+` aliases reach Krystal's Gmail: `test1`, `test2`, `test3`, `padmin`, `mowner`, `mstaff`, `wsowner`). A held-back email is by design; it shows as "not sent" on the record.

## What is LIVE on production (verified or awaiting your check)
- Earlier releases through PR #100 are live.
- **PR #101 (booking helper move)** merged and deployed READY. You were to verify booking on production; report the result if not done.
- **book.monarchtaxsuite.com:** the missing certificate was issued. Verify the link loads (not yet confirmed).

## What is BUILT on Preview only (nothing here is on production)
Verified by you: password reset for an account without two-step; the WISP menu and customer-page removal; booking end to end; form to PDF to the lead's Documents; the thank-you email carrying the PDF (Submission #10).
Built, not yet walked:
- **Password reset with two-step:** the authenticator-code box (Flow A). Your with-factor test was still pending; the no-factor test passed.
- **Office area:** the Monarch owner's "Open office area" bounce is fixed; two-step is optional there (skip button; a code is asked only if turned on).
- **Team page** hidden and blocked for PTIN. **Leads** now included in the PTIN plan.
- **WISP delivery on a license** (license key email, plan opened on `/downloads`): built, untested live, and WISP work is on hold.
- **The un-hardwiring (the big job):**
  - Step 1: the workspace tenant comes from the signed-in person's memberships. No visible change.
  - Step 2: on Preview only, owners and admins of any tenant open the real workspace; Leads join PTIN.
  - Step 3 (first batch): booking links use the workspace's own public address; the service-orders page uses the signed-in workspace.

## Your current assignment: the Step 2 and Step 3 walk (PTIN Walk Test)
1. Sign in with the saved test login, go to `/switch-workspace`, open **PTIN Walk Test**.
2. **Frame:** the same shell as Monarch's.
3. **PTIN menu:** Every day (Home, Contacts, Work, Billing, Calendar, Documents, Reports), Grow (Websites, Forms, Automation, Pipelines, Campaigns, Leads), Settings. **No** Team, ERO, Service Bureau or My Store.
4. **Leak check, the one that matters:** nothing of Monarch's anywhere (contacts, leads, documents, calendar, Home, the browser tab title). Anything of Monarch's is a leak: report the exact page. If it happens as `info@` (also a platform admin), repeat as a non-admin account before calling it a leak.
5. **Add a lead or contact** and confirm it appears only in PTIN Walk Test.
6. **Calendar settings:** expect the note "Your booking link needs your public web address" until a website exists. After creating a site under Websites, the booking links should show the new `.sites.verexahq.com` address. Monarch's own links must look exactly as before.
7. **Re-walk Monarch** afterward: nothing there should have changed.

## Held (do not start): WISP separation (Compliance Center removal, `/wisp` landing, product conversion), the tier intake forms, and everything about the Monarch store as a product.

## Still open / coming
- Lead-documents isolation check passed 5 of 5 on the test project. The `lead_docs` table is **not on production** yet and needs Krystal's separate approval before the form-PDF release.
- The connection feature (PTIN to ERO or bureau) is designed, not built. See `docs/connection-design.md`.
- The staff seat rule (one "Administrative Assistant" seat at ERO and Service Bureau, none at PTIN) is in the spec, not built.
- The public homepage and plan copy will be written from the spec when the build reaches it.
- The builder's next steps: the default public address made when a workspace is created, the Office area and client portal made tenant-aware, then the per-tenant store, background jobs, and wording cleanup.

## Reading list, in order
`docs/tier-capabilities-spec.md`, `docs/real-workspace-plan.md`, `docs/ptin-product-requirements.md`, `docs/connection-design.md`.
