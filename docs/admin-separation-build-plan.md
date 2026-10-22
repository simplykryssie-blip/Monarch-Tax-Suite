# Part 1 — Build order (PROPOSED, for owner approval)

Proposed 2026-10-22. Nothing here has started. Every production action (merge, migration, data write, domain, DNS, sign-in creation, environment change) is asked separately before it is executed. Every step is tested on Preview with fake data first.

## Approach
- Small slices, one PR each, in this order. Each slice is safe to ship alone and changes nothing for Monarch's day-to-day until the cutover (Step 7).
- **Transition rule:** until the cutover, the Monarch workspace accepts either a Monarch tenant member or the existing platform-admin list, so no one is locked out. The rule is removed at the end.
- `tenant_members` already exists and was seeded from `admin_users` as Monarch owners (migration 20261014090000), so the Monarch owner is probably already a tenant member. This is verified read-only before any change.

## Steps

0. **Preview baseline.** Update `claude/preview-env` from the default branch (a branch move; I will say when I do it). Confirm Preview runs the current build.

1. **PR 1 — Access split (code only).**
   - Monarch workspace pages gate on membership of the Monarch tenant (with the transition rule).
   - `/admin` pages require the platform-admin list *and* the admin host; from any other host they are denied (not hidden).
   - Tenant routes are denied on the admin host.
   - Tests: tenant session at admin URL denied; admin session on tenant host denied; Monarch owner without admin rights keeps the workspace.
   - Production effect on merge: none (admin host does not exist yet).

2. **PR 2 — Platform system mail (code only).**
   - Welcome, payment-failed, reminder and cancellation emails send from `support@verexahq.com` through the platform's Resend account, not through Monarch's tenant sender.
   - `MONARCH_EMAIL_FROM` stops being a platform setting; Monarch's own tenant sender is configured in Monarch's Email sending screen.
   - Needs: production data write (Monarch's own sender row) at cutover; asked then.

3. **PR 3 — Admin shell and rehomed screens.**
   - Own layout for the admin host, designed so the Phase 7 staff/support view can slot in (not built).
   - Workspaces, Billing setup, Integrations moved in.
   - **New read-only Legal & signup status screen** (decision 6).
   - Platform actions audit-logged.
   - **Needs a migration** (platform audit table). Production migration asked separately.
   - **Open question:** the audit table must carry `tenant_id` from day one. Proposal: record the affected workspace's id where an action targets one, and for platform-wide actions use a seeded internal "Verexa HQ (platform)" tenant row, the same way Monarch is seeded as tenant #1. Needs Krystal's OK.

4. **PR 4 — Monarch's store Stripe keys into tenant settings** (decision 5).
   - New encrypted per-tenant storage for Monarch's storefront Stripe key and webhook secret, an entry screen under Monarch's Payments settings, and the storefront webhook resolving Monarch's keys from there.
   - **Needs a migration** (tenant_id from day one). Production migration asked separately.
   - At cutover Krystal enters the keys in the new screen; the old environment variables are removed only after a live check. I never see or print a key.

5. **Preview verification (Luna).** Fake data only: both logins, denied/allowed matrices, system mail from support@verexahq.com, store checkout with test keys, admin screens, audit rows, isolation SQL for the new tables.

6. **Production setup — each asked separately, in this order:**
   - a. Verify read-only that the Monarch owner is a Monarch tenant member.
   - b. Add `admin.verexahq.com` to the Vercel project.
   - c. DNS record for `admin.verexahq.com` (where verexahq.com DNS is managed).
   - d. Create the `info@verexahq.com` sign-in; Krystal sets the password and two-step sign-in herself.
   - e. Add it to the platform-admin list.
   - f. Update the host settings (`APP_HOSTS`, admin host).
   - g. Merge PRs 1 to 4 and apply the two migrations (each a separate approval).

7. **Cutover — each asked separately:**
   - Sign in to both identities on production and check them.
   - Enter Monarch's store Stripe keys in Monarch's settings; live check; remove the old environment variables.
   - Create Monarch's own sender record; retire the platform `MONARCH_EMAIL_*` settings.
   - **Remove info@monarchtaxsuite.com from the platform-admin list.** Remove the transition rule.

8. **Later, as scheduled by the owner:**
   - Monarch's own Twilio subaccount, when Monarch's texting is funded (it involves a real Twilio account change and number registration).
   - The `MONARCH_` renames, done during the move, not as their own step.

## Questions for Krystal
1. Audit table: OK to seed an internal "Verexa HQ (platform)" tenant row for platform-wide audit entries?
2. Does the `info@verexahq.com` mailbox exist and can she receive mail there (sign-in links and password reset need it)?
3. OK to keep the transition rule (either tenant member or admin list) until Step 7?
4. Is the PR order above acceptable, with Part 2 starting only after Step 7?
