# Part 1 — Preview test steps (for Luna)

Covers PRs #78 (access split), #79 (platform system mail), #80 (admin shell), #81 (store Stripe keys). Step 5 of the approved build order. **Fake data and Stripe test mode only. Preview and the test project only; never production. Never paste a key or password into chat** (set them in Vercel, Stripe, or the screen itself). **Do not run the sweep** during these tests.

Result format for every test: PASS or FAIL, what the screen showed (one line), and a screenshot with no keys in it.

Pre-merge check on production (read-only, done 2026-10-22): the platform-admin list and the Monarch owner/admin list are the same single account (info@monarchtaxsuite.com), with no staff members. Nothing to reconcile.

## A. Setup

| # | Who | What |
|---|---|---|
| A1 | Builder | Fast-forward `claude/preview-env` to the tip of `claude/store-stripe-keys` (it already contains #78 to #81; no force needed, bd01830 is its ancestor). Says when done and gives the commit. |
| A2 | Luna | In Vercel, confirm the Preview deployment for `claude/preview-env` built from that commit. |
| A3 | Luna | Find the deployment's **branch URL** (the `…-git-claude-preview-env-….vercel.app` address in the deployment's Domains list). This is the **admin address** for testing; `preview.verexahq.com` stays the **tenant address**. No DNS change is needed. |
| A4 | Luna | In Vercel → Environment Variables (Preview, branch `claude/preview-env`): set `ADMIN_HOSTS` = the branch URL host only (no https://, no path). Append to `AUTOMATION_TEST_RECIPIENTS` the three test addresses you will use below. Redeploy and confirm the commit again. |
| A5 | Luna | In the **test** Supabase project → Authentication → Add user, create three users with passwords you choose: **admin** (e.g. kshanelle83+padmin@gmail.com), **owner** (kshanelle83+mowner@gmail.com), **staff** (kshanelle83+mstaff@gmail.com). Tell the builder the three emails (not the passwords). |
| A6 | Builder | On the test project: add *admin* to the platform-admin list and as Monarch owner; add *owner* as Monarch owner only; add *staff* as Monarch staff only. Confirms with a read-back. |

## Preview address note (found in B4)
Invite links, and every other emailed link, are built on the deployment's **own address** on Preview (`VERCEL_BRANCH_URL`), and on the configured app address (`NEXT_PUBLIC_APP_URL`) everywhere else. In steps A3/A4 the branch URL was chosen as the admin address, so Preview invite links pointed at the admin address, which serves only `/admin` and sign-in (the invite page answers there with "Not found"). This is a Preview-config artifact, not a code fault. **Do not swap the roles** (an earlier version of this note suggested it): every provider callback (Stripe, Resend, Twilio) must reach the tenant address, `preview.verexahq.com`, which is public; the branch URL is behind Vercel's sign-in so providers cannot reach it, and the admin address serves only `/admin` and sign-in. On Preview, finish invite checks by replacing the link's host with `preview.verexahq.com`.

**Webhooks on Preview:** register provider webhooks at `https://preview.verexahq.com/api/...`, never the branch URL (the Store payments screen prints the deployment's own address, which on Preview is the protected branch URL; on production it prints the public app address and is right).

**Store webhook events (test mode):** `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded`, `charge.dispute.created`.

## B. Tests

**B1. Separation on the tenant address (`preview.verexahq.com`)**
1. Sign in as **admin**. Open `/admin/workspaces`. Expect: a plain "not available at this address" page (403). The menu has no Admin group.
2. Sign in as **owner**. `/`, `/leads`, `/workspace` open normally. `/admin/workspaces` → 403.

**B2. The admin address (branch URL)**
1. Signed out, open `/admin/workspaces` → goes to sign-in.
2. Sign in as **admin**. Open `/` → lands on `/admin/workspaces`. Expect the plain "Verexa HQ · Platform admin" frame, five menu items (Workspaces, Billing setup, Integrations, Legal & signup, Activity), your email, Sign out. No workspace menu or alerts.
3. Open `/leads`, `/workspace`, `/office`, `/store` on this address → each shows "Not found" (404).
4. Sign out. Sign in as **owner** on the admin address. Open `/admin/workspaces` → back to the sign-in page showing "This account is not a platform administrator." It must not loop.

**B3. The Monarch workspace gate**
1. As **owner** (member, not on the platform-admin list) on the tenant address, `/leads` and `/workspace/clients` work.
2. As **staff**, the tenant address refuses (sign-in page with the not-an-administrator message).

**B4. Platform email (PR 2)**
1. On the admin address as **admin**: Workspaces → create "Preview Test Workspace", owner = a fake person, email = one of the recipients you added. Expect "Workspace created. The invite was emailed…".
2. In that inbox: from **Verexa HQ <support@verexahq.com>**, reply-to support@verexahq.com, the set-password button works.
3. Create a second workspace with an address **not** on the list. Expect "Workspace created, but the email wasn't sent: Not sent: this Preview deployment only emails addresses listed in AUTOMATION_TEST_RECIPIENTS…" and a one-time link shown.

**B5. Activity and the status screens (PR 3)**
1. Activity shows "Workspace created" (twice) with the workspace names and "You".
2. Re-send an invite, then suspend and reactivate the owner: Activity gains "Invite re-sent" and "Access changed" rows.
3. Billing setup → run it (Stripe test mode; safe to repeat). Activity gains "Billing setup run" against **Verexa HQ (platform)**.
4. Legal & signup: policies "Not yet" (draft); billing "Ready"; bot check state; signup state with reasons. It shows states only; no keys or values.

**B6. Store payments (PR 4), as owner on the tenant address**
1. Settings → Store payments. Expect "Secret key: still read from the server's environment settings (test mode)…" and the webhook line likewise. "Check the connection" → "Stripe accepted the key (test mode)."
2. In Stripe (test mode) copy a **test** secret key and, from a webhook endpoint that points at `https://preview.verexahq.com/api/stripe/webhook`, its signing secret. Paste both into the two boxes and Save. Expect "Saved (test mode)…" and then "Secret key: saved here (ends xxxx), test mode." The boxes are empty again; the key is nowhere on the page (check View Source too).
3. Check the connection → accepted.
4. Buy a product on the storefront with test card 4242 4242 4242 4242. The order must complete (webhook accepted with the saved secret).
5. Save a well-formed but wrong key (`sk_test_` plus 24 random letters/digits). Check the connection → "Stripe rejected the key." Save the correct key again.
6. Save a publishable key (`pk_test_…`) → refused with "That is a publishable key…". Save `hello` → refused with a plain reason.
7. Remove the saved keys (tick the box). Page returns to the environment wording.
8. As the **Preview Test Workspace** owner (PTIN), open `/settings/store-payments` → you are sent to your own workspace; the page is not theirs.

**B7. Regression and phone width**
- As **owner**: Home, Leads, Workspace → Clients, Calendar, Forms, Campaigns all open without errors.
- Phone width (390 px): the admin frame, Activity, Legal & signup and Store payments are usable with no sideways scrolling.

## C. After the tests (Builder)
- Read back: the platform-action rows in the audit log, and that the store-keys row holds only ciphertext (`v1:`), hints and mode.
- Report to Krystal: pass/fail per test, anything to fix. Fixes go on the PR branches; nothing is merged without her per-PR approval (#78, #79, #80, #81, in that order).
- Test leftovers stay in the test project (audit rows are append-only). Remove the three test sign-ins and the two test workspaces only with the same one-time audit-rule bypass used before, and only on Krystal's word.
