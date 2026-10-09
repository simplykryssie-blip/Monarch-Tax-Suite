# Stripe test-mode runbook

Goal: prove payment → signed webhook → order → license → duplicate handling → refund, **without touching production and without any real money**.

Nothing in this runbook changes the live Stripe account, the production Supabase project, the production Vercel project, or any Stripe product/price ID. If a step ever seems to require that, **stop** (see "Stop rules" at the end).

---

## 0. The one-minute picture

| | Live (production) | Test (this runbook) |
|---|---|---|
| Stripe | Live mode (toggle OFF "Test mode") | **Test mode** (toggle ON, orange banner) |
| Stripe keys | `sk_live_…` | `sk_test_…` |
| Webhook secret | `whsec_…` of the live endpoint | `whsec_…` printed by `stripe listen` (different) |
| Database | Monarch Supabase `ftthniovwzxztkwtregz` | **A new throwaway Supabase project** |
| App | https://monarch-tax-suite.vercel.app | `http://localhost:3000` on your computer |
| Cards | Real | `4242 4242 4242 4242` |

Stripe test and live mode have **completely separate** products, prices, customers, payments and webhooks. A test product has different `prod_`/`price_` IDs than the live one. That is normal and expected. Do not copy test IDs into production or live IDs into the test database.

Built-in safety net: the webhook rejects (HTTP 400) any event whose live/test flag does not match the `STRIPE_SECRET_KEY` of that deployment. A test event can never create an order on a live deployment, and vice versa.

### Why not just use the Vercel preview or production?

- **Production**: has live keys. Not allowed here.
- **Vercel preview**: `STRIPE_SECRET_KEY` exists in the Preview scope, but its mode (test or live) has not been verified, and `STRIPE_WEBHOOK_SECRET` is not set there. Preview deployments would also talk to the **production database** unless `NEXT_PUBLIC_SUPABASE_URL` is overridden. Do not use previews for payment tests until you have confirmed both.
- **Local + throwaway project** (this runbook): nothing shared with production.

---

## 1. Prerequisites (one-time)

Tick each before continuing.

1. [ ] Node 20+ and `npm` installed; repo cloned; on branch `claude/launch-readiness-hardening` (the review branch; do not merge it for this). `npm ci` completes.
2. [ ] [Stripe CLI](https://docs.stripe.com/stripe-cli) installed. Run `stripe login` and choose the Monarch Stripe account. (This grants the CLI a test-mode key. It does not change anything.)
3. [ ] Stripe Dashboard → **Test mode ON** (toggle top right). Keep it on for the whole runbook.
4. [ ] Supabase CLI or `psql` available (only needed for step 2).
5. [ ] A scratch text file (outside the repo) for values you will paste into `.env.local`. **Never paste keys into chat, commits, or screenshots.**

---

## 2. Create the throwaway test database

The original foundation migration (`20261008224443`, the five `calculator_*` tables) was never committed to the repo, but it is recorded verbatim in production's migration history. It is now saved as `supabase/test-env/00_foundation.sql`.

**How this was verified (read-only against production, no customer data read):** the foundation + every repo migration was replayed on a scratch local Postgres 16. Its tables, columns, constraints, indexes, row-level-security flags and triggers were then compared (by checksum) with production's schema metadata, and all match. The only difference is `rls_auto_enable()`, a helper Supabase creates itself in every project. Not covered: Supabase-specific objects (the `auth`/`storage` schemas and roles) were stubbed locally, so the first run in a real test project is still a real test. If it fails, nothing in production is affected.

Steps:

1. In Supabase create a **new, empty project** named `monarch-test-throwaway`. Not the Monarch project (`ftthniovwzxztkwtregz`) and not the Verexa project (`daxpavvsotvsyqqntddc`). Save its URL, publishable key, service-role key and database connection string in your scratch file.
2. Run the script, which builds the schema in the test project only:
   ```
   TEST_DB_URL='postgresql://postgres:<password>@db.<TEST-ref>.supabase.co:5432/postgres' ./supabase/test-env/apply.sh
   ```
   It refuses if the URL contains the production or Verexa project ref, refuses if the database already has Monarch tables, prints the target host, and waits for you to type `TEST`. It then applies `00_foundation.sql` and all files in `supabase/migrations/` in order, each in its own transaction. This includes the pending rate-limit migration, which is how you rehearse it.
   (No `psql`? Instead paste each file into the test project's SQL editor in the same order. Check the project name at the top first.)
3. Create a test admin: Authentication → Add user (any email/password you choose). Then in the **test** project's SQL editor:
   ```sql
   insert into public.admin_users (user_id)
   select id from auth.users where email = '<the email you just created>';
   ```
4. Sanity check in the test project: `select count(*) from public.orders;` returns `0`; `select public.hit_rate_limit('x', now());` returns `1`.

Notes: the test database has no `calculator_leads` table (the lead-storage removal is included), which production still has until you approve that migration. The old CRM pages under `app/(app)/` (clients, engagements, tasks) use tables that do not exist in Monarch's production project either; don't open them.

---

## 3. Create Stripe test objects (test mode only)

In Stripe Dashboard with **Test mode ON**:

1. Product catalog → Add product: `Monarch Basic Tax Calculator (TEST)`, one-time price **$75.00 USD**. Note its `prod_…` id.
2. On that price → **Create payment link**. Copy the `https://buy.stripe.com/test_…` URL.
3. Add product: `Annual Tax-Year Update (TEST)`, one-time **$50.00 USD**. Note `prod_…` and `price_…`.

These are new test objects. You are **not** editing the live products or any existing price ID.

---

## 4. Configure the local app for test mode

Create `.env.local` in the repo root (git-ignored). Fill from your scratch file:

```
# --- TEST PROJECT ONLY. If this points at ftthniovwzxztkwtregz, STOP. ---
NEXT_PUBLIC_SUPABASE_URL=https://<test-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<test publishable key>
SUPABASE_SERVICE_ROLE_KEY=<test service-role key>

STRIPE_SECRET_KEY=sk_test_...          # Dashboard (Test mode) → Developers → API keys
STRIPE_WEBHOOK_SECRET=whsec_...        # filled in at step 5
NEXT_PUBLIC_APP_URL=http://localhost:3000
MONARCH_ENCRYPTION_KEY=<throwaway key, see section 10 — NOT the production key>
```

**Critical:** `NEXT_PUBLIC_SUPABASE_URL` defaults to the **production** Monarch project if it is unset. Always set it explicitly here. Quick check before every session:
```
grep NEXT_PUBLIC_SUPABASE_URL .env.local
```
It must show the test project ref, never `ftthniovwzxztkwtregz`.

Also confirm the key is a test key without printing it: `grep -c '^STRIPE_SECRET_KEY=sk_test_' .env.local` → prints `1`.

Before starting, run these **three safety checks** (they print no secrets):

```
# 1. Only .env.local (and .env.local.example) should exist. Any other .env* file could override it.
ls -a | grep '^\.env'
# 2. Your terminal must not already hold production values (Next.js lets real environment variables win over .env.local).
env | grep -E '^(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_|STRIPE_|MONARCH_)' | sed 's/=.*/=<set>/'
# 3. The Supabase URL must be the TEST project.
grep -c 'ftthniovwzxztkwtregz' .env.local
```
Expected: (1) only `.env.local` and `.env.local.example`; (2) **nothing printed**. If anything prints, run `unset NAME` for each, or open a fresh terminal. Never run `vercel env pull` or `vercel dev` for this runbook, because they bring production values onto your computer; (3) prints `0`.

Start the app: `npm run dev`. Leave it running.

---

## 5. Start signed webhook forwarding

In a second terminal:
```
stripe listen --forward-to localhost:3000/api/stripe/webhook
```
The CLI uses **test mode by default**. **Never add `--live`** to any `stripe` command in this runbook, and never pass a `sk_live_` key with `--api-key`. It prints `Ready! Your webhook signing secret is whsec_…`. Put that value in `.env.local` as `STRIPE_WEBHOOK_SECRET`, then restart `npm run dev` (env is read at start). Keep `stripe listen` running; it shows each event and the HTTP status your app returned.

This secret is for the CLI only. It is **not** the live endpoint's secret and nothing in Stripe or Vercel is modified.

---

## 6. Test A — payment, webhook, order, license

1. Open `http://localhost:3000/login`, sign in as the test admin.
2. Admin → **Products** → open *Basic Tax Calculator*. In the test database set:
   - `Stripe product ID` = the **test** `prod_…` from step 3,
   - `Stripe price ID` = the **test** `price_…`,
   - `checkout_url` metadata = the `https://buy.stripe.com/test_…` Payment Link (https only),
   - then Publish. If publish is blocked, the page lists what is missing. Fix those items.
   (This edits only the throwaway test database. The two seeded products in a fresh database carry the **live** product IDs copied from the original setup; replace them with the test IDs as above. A "Verify with Stripe" check against live IDs just says "not found" in test mode and is harmless.)
   **Do not click any "Sync to Stripe"/create-price button in the admin for this runbook.** Those buttons create or update Stripe products and prices using whatever `STRIPE_SECRET_KEY` is loaded. With the `sk_test_` key that only touches test mode, but this runbook never needs them, so skip them.
3. Visit `http://localhost:3000/shop`, open the product, click buy. You land on Stripe's hosted checkout (test banner).
4. Pay with `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP, any email you control.
5. Watch the `stripe listen` terminal.

**Expected evidence**

| Where | What you should see |
|---|---|
| `stripe listen` | `checkout.session.completed` → `[200]`, also `payment_intent.succeeded` and `charge.succeeded` (ignored events still return 200) |
| App terminal (`npm run dev`) | no stack traces; at most a short line with event ids |
| Stripe Dashboard (test) → Developers → Events | the events above |
| Stripe Dashboard → Payments | one $75.00 payment, *Succeeded* |
| Test DB `stripe_events` | one row per processed event id, finished |
| Test DB `orders` | 1 order, status paid, amount 7500 |
| Test DB `licenses` | 1 license for that customer, status active, **no plaintext key** |
| Admin → Orders / Licenses | the order and license appear |

6. Admin → Licenses → the new license → **Issue key**. The key `MTS-XXXXX-…` is shown **once**. Copy it into your scratch file. The database stores only a hash and prefix.
7. (Optional) Add an authorized domain `localhost` on the license and load the embed from a page you control to see it validate.

Pass criteria: exactly **one** order and **one** license after one payment.

---

## 7. Test B — duplicate event handling

Stripe retries and you can replay. The app must not create a second order or license.

1. Take the `evt_…` id of the `checkout.session.completed` event from Test A (shown in the `stripe listen` output, or Dashboard → Events) and run `stripe events resend evt_…`. Per Stripe's docs this resends the event to the CLI's local listener (test mode by default; do not add `--live`). Stripe only resends events from the last 30 days.
2. Expected: `stripe listen` shows `[200]`; response body says it was already processed/duplicate.
3. Re-check counts: `orders` still 1, `licenses` still 1, `stripe_events` has no duplicate id.

Pass: counts unchanged.

---

## 8. Test C — refund behavior, signature check, mode guard

**Refund (full)**
1. Stripe Dashboard (test) → Payments → open the $75 payment → **Refund** → full amount.
2. Expected events: `charge.refunded` → `[200]`.
3. Test DB: order shows refunded, license status `revoked`. Embeds for it now fail validation (`unavailable`).

**Refund (partial)** — repeat Test A with a second payment, refund e.g. $10.
Expected: order notes the partial refund, license **stays active**.

**Bad signature (safe negative test)** — from a terminal:
```
curl -i -X POST http://localhost:3000/api/stripe/webhook -H 'stripe-signature: t=1,v1=bad' -d '{}'
```
Expected: `400`. No rows created.

**Mode guard** — optional, proves a live event cannot reach a test deployment. This is covered by `tests/event-mode.test.ts` (`node --test tests/event-mode.test.ts`). Do **not** try to send real live events.

**Dispute** — `stripe trigger charge.dispute.created` suspends a license (test mode only; trigger creates its own test data). Optional.

---

## 9. Test D — annual update checkout (optional)

1. In the test DB, make sure a product version row exists with the test update `price_…`.
2. With a license + issued key from Test A, open `http://localhost:3000/update`, enter the key, buy the update with `4242…`.
3. Expect `checkout.session.completed` `[200]`, license moves to the newer tax-year version, and one additional order of $50.
4. Refund it: only the update reverts; the base license stays active.

---

## 10. Pending items — safest next steps (nothing applied yet)

### 10a. Rate-limit migration `20261009200000_rate_limit_counters.sql`

What it does: adds one new table (`rate_limit_counters`) and one function (`hit_rate_limit`) for the validate endpoint. It is **additive**: no existing table is altered or dropped, no data deleted.
Current behavior if it is *not* applied: the code fails **open** (requests are allowed, a warning is logged), so production keeps working.

Safe order:
1. Rehearse in the **test** project (done by `apply.sh` in step 2). Confirm it succeeds and that `select public.hit_rate_limit('x', now());` returns `1` then `2`.
2. Review the SQL once yourself (about 40 lines).
3. **Owner approval required** before production. When approved: apply to production *after* the branch is merged and deployed (or before; both orders are safe because of fail-open), then check `/api/license/validate` still answers and the table exists.
4. Rollback if ever needed: `drop function public.hit_rate_limit(text, timestamptz); drop table public.rate_limit_counters;` (safe because nothing else depends on them). Not destructive to business data.

Do **not** apply `20261009180000_remove_lead_storage.sql` to production without a separate look: it drops lead storage. Production has 0 rows there, but it is still a drop, so it needs explicit approval.

### 10b. `MONARCH_ENCRYPTION_KEY`

What it is: a secret of exactly 32 random bytes, base64-encoded. It encrypts saved CRM credentials and keys the one-way client hash used by rate limiting.

Why it's missing now and what happens: no key anywhere. CRM connections stay disabled and the rate limiter hashes with plain SHA-256. Nothing is encrypted with any key yet (0 CRM connections exist), so there is **no existing data to lose**.

Safe steps:
1. Generate it on your own computer, never in chat:
   ```
   openssl rand -base64 32
   ```
   Store it in a password manager. Losing it later means saved CRM credentials become unreadable.
2. For this runbook use a **different, throwaway** value in `.env.local`. Never reuse the production key in test.
3. **Owner approval required** to add to Vercel: Project → Settings → Environment Variables → add `MONARCH_ENCRYPTION_KEY`, mark **Sensitive**, scope **Production** first (Preview optional, with a different value). Redeploy for it to take effect.
4. Verify by **name and scope only** in the Vercel UI. Never display the value.
5. **Never change or delete the key once CRM connections exist**, unless you first re-encrypt or re-connect those connections. Different key = old ciphertext cannot be decrypted.

---

## 11. Evidence checklist

**Stripe (test mode ON)**
- Developers → Events: `checkout.session.completed`, `charge.refunded`
- Developers → Webhooks → (CLI listeners appear under *Local listeners*): delivery 200
- Payments: payment succeeded, refund listed
- Customers: the test buyer

**Vercel** (only relevant if you later deploy a test setup; for the local run use your terminal logs)
- Project `monarch-tax-suite` → Logs, filter path `/api/stripe/webhook`: status 200 for good events, 400 for bad signature or mode mismatch, none 5xx.
- Look for `stripe-webhook: <evt_id> <type> rejected (mode_mismatch)` if a test event hits a live deployment (expected and good).
- Do **not** expect any test event in production Vercel logs. If you see one, the wrong URL is being used. Stop.

**Database (test project)**: `stripe_events`, `orders`, `licenses`, `calculator_license_events`.

---

## 12. Stop rules

Stop and ask before continuing if:
- `.env.local` shows `ftthniovwzxztkwtregz` or any `sk_live_` key.
- Stripe Dashboard shows no "Test mode" banner while creating products or refunding.
- Any command would `drop`, `delete`, `reset`, `truncate`, or rotate/replace a secret in production.
- A step asks you to edit a live Stripe product or price ID. The Basic Calculator live price ID discrepancy (owner-supplied vs. stored) must be resolved in the Stripe Dashboard and the admin product editor by you, separately, before launch. Not part of this runbook.
- You are about to add the test webhook secret to Vercel. Don't: the CLI secret is local-only.

## 13. Cleanup

Stop `npm run dev` and `stripe listen`. Delete `.env.local` when done. Pause or delete the `monarch-test-throwaway` Supabase project (it only ever contained test data). Test-mode Stripe objects can stay.

---

## 14. Production-safety review of every step

Reviewed line by line. "Touches" means what the command can reach.

| Step | Command / action | Touches | Production risk and guard |
|---|---|---|---|
| 1 | `stripe login` | Stripe account (authorizes the CLI) | None by itself. Default mode is test. |
| 2.1 | Create new Supabase project | New project only | None. Never reuse `ftthniovwzxztkwtregz` or `daxpavvsotvsyqqntddc`. |
| 2.2 | `apply.sh` | Only `TEST_DB_URL` | Script refuses both production refs, refuses a non-empty database, shows the host, requires typing `TEST`. Residual risk: pasting the production password with a differently-hosted URL (e.g., a pooler hostname not containing the ref). Check the project name in the Supabase dashboard where you copied the URL from. |
| 2.3-2.4 | SQL in the test project's SQL editor | Whichever project the editor is open on | Confirm the project name at the top of the editor says `monarch-test-throwaway`. |
| 3 | Dashboard, Test mode ON | Stripe test data | Confirm the orange Test mode banner before creating anything. |
| 4 | `.env.local` + three checks | Local files | Checks catch other `.env*` files, shell variables holding production values, and the production Supabase URL fallback. Never run `vercel env pull` / `vercel dev`. |
| 5 | `stripe listen` | Local forwarding, test events | Never add `--live`. The webhook secret is local only. |
| 6-9 | Browser at `localhost:3000`, test card | Test DB + Stripe test mode | A live key (`sk_live_`) in `.env.local` would be caught by check 3 of section 4 only for the URL; verify the key with `grep -c '^STRIPE_SECRET_KEY=sk_test_' .env.local` (prints `1`). Also the webhook returns 400 for any live-mode event under a test key. |
| 7 | `stripe events resend` | Local listener | Never add `--live`. |
| 8 | `curl localhost:3000/...` | Local only | None. |
| 10a | Production migration | **Production DB** | **Not part of the test.** Requires your explicit approval; additive; rollback listed. |
| 10b | Production env var | **Production Vercel** | **Not part of the test.** Requires your explicit approval; generate locally; never paste into chat. |
| 13 | Cleanup | Local, test project | Deleting the test project is safe only if its name is `monarch-test-throwaway`. |

Result: no step in sections 1-9 connects to production when the checks in sections 2 and 4 pass. Sections 10a/10b are the only production changes and are not executed by this runbook.

