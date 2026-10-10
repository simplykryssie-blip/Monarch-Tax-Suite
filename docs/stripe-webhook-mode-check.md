# Checking the Stripe live/test mode guard

No real payment, and no Stripe setting change, is needed for any step here.

## What the guard does

Every Stripe webhook is first checked by signature. If the signature is valid, the
guard then compares the event's mode (live or test) with the mode of the server's
`STRIPE_SECRET_KEY` (`sk_live_`/`rk_live_` = live, `sk_test_`/`rk_test_` = test).

| Server key | Event | Result |
|---|---|---|
| live | live | processed |
| test | test | processed |
| live | test, or test | live | refused, HTTP 400 "Event mode does not match this deployment" |
| not a recognised Stripe key | any | refused, HTTP 400 (nothing can be processed) |

Only event ids and a reason code (`mode_mismatch`, `key_mode_unknown`) are logged.

**Important:** Stripe signs live and test events with *different* signing secrets
(one per webhook endpoint). Production holds the live one, so a genuine test event
sent to the live endpoint already fails the signature check before the guard is
reached. The guard is a second line of defence for the case where a test secret or
test key was configured by mistake.

**The one way this can hurt:** if the production `STRIPE_SECRET_KEY` is not a
recognised `sk_`/`rk_` key, or is a test key while real customers pay in live mode,
every real payment event is refused (HTTP 400) and no order or license is created
automatically. Stripe would show the failed deliveries. Check the key mode **before**
merging, as below.

## What has been checked

| Check | Where | Result |
|---|---|---|
| Unit tests of the mode rules (live/test match, mismatch, unknown key, missing mode) | automated, 4 tests | passed |
| Locally signed dummy events sent to a local copy of the app with a test key, a live key and an unrecognised key (dummy keys, mock database, no Stripe contact) | local | matching mode processed; mismatched mode refused; unrecognised key refused; wrong signature refused first |

These prove the logic. They do **not** prove anything about the real production
key, the real Stripe endpoint, or live delivery.

## Checks you can run before merging (production admin, nothing is changed)

1. Sign in to the admin → **Products** → open the calculator → **Stripe** section.
   It shows a line like `Stripe key: configured (live mode)` without revealing the key.
   - `live mode` and you sell in live mode → good.
   - `test mode` while selling for real, or `set, but not a Stripe secret/restricted key`
     → fix the key in Vercel **before** merging this pull request.
2. Press **Verify with Stripe** (read-only). The result names the mode, for example
   "Verified in Stripe (live mode)". It cannot change any id or setting.
3. In the Stripe Dashboard (live mode) → Developers → Webhooks → the Monarch endpoint:
   confirm it is a live-mode endpoint and note its recent deliveries.

## Checks that need running code but not production

- Re-run the local guard tests: `node --test tests/event-mode.test.ts` (developer).
- A Preview deployment is not useful for this: it has no webhook signing secret and no
  database settings, so it shows the "not configured" page.

## Checks that need a Stripe *test* event

Seeing the guard act on a real Stripe event needs a **separate test deployment** with a
test key, a test-mode endpoint and its own signing secret, as set up in
`docs/stripe-test-runbook.md`. Do not send test events to the live endpoint: they will
be refused at the signature step, which proves nothing about the guard.

## After the pull request is deployed

- Watch Stripe Dashboard → Webhooks → the endpoint. Real events should show `200`.
  A `400` with "Event mode does not match" means the key and the endpoint disagree.
- **Nothing here claims live webhook delivery works.** That is shown only by a real
  event being delivered and creating an order, which has not happened yet.
