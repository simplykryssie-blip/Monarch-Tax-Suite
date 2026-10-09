# Stripe test-mode runbook (isolated test project)

**Status: written and partly verified. The end-to-end test has NOT been run yet.** Nothing below should be read as "it works" until you have run it and ticked the evidence boxes. Section 1 lists what has been confirmed and what is still an assumption.

Goal: prove payment → signed webhook → order → license → duplicate handling → refund, using Stripe **test mode** and a **throwaway Supabase project**, with no way to touch production or the Verexa project.

Never done by this runbook: live Stripe keys or objects, production database changes, production environment variable changes, deploys, merging the branch.

---

## 1. What is confirmed and what is not

### Confirmed (checked against the code or by running it)

| Fact | How it was checked |
|---|---|
| The foundation SQL (`supabase/test-env/00_foundation.sql`) is the exact migration production applied as `20261008224443`. | Read from production's migration history (SQL text only, no data). |
| Foundation + all repo migrations build a schema whose tables, columns, constraints, indexes, row-level-security flags and triggers match production's (checksums), apart from the two migrations production has not applied yet (`180000`, `200000`). | Replayed on local PostgreSQL 16 and compared with production metadata (structure only). |
| Production gives table access only to `service_role` (19 tables); `anon` and `authenticated` have none. After `apply.sh` the local rebuild is the same. | Production grant metadata vs local rebuild. |
| Production relies on Supabase's old "grant new tables to service_role automatically" default. Supabase documents that new projects are moving away from it. `00_default_privileges.sql` reproduces the production default so the app does not fail with "permission denied". | Production `pg_default_acl`; Supabase docs. Local run: `service_role` can read, `anon` cannot. |
| `apply.sh` refuses: production or Verexa refs, any URL shape outside a strict allowlist, query-string tricks, wrong/missing marker, non-empty database, wrong typed confirmation. | 15 adversarial and normal cases run against scratch databases (see section 3). |
| `check-env.sh` fails on: live Stripe key, unset/production/Verexa Supabase URL, extra `.env*` files, production values already set in the terminal, wrong-project JWT keys, bad encryption key. It never prints values. | Run against fake `.env.local` files. |
| Save / "Save & publish" in the admin never calls Stripe. | `product-editor.tsx` text and `product-actions.ts`. |
| Only these admin buttons write to Stripe: **Update Stripe product info**, **Create Stripe product**, the create-price button in the Stripe panel, and **Create & link price** (annual update versions). **Verify with Stripe** and **Check Stripe price** only read. | `app/(admin)/product-actions.ts`, `components/admin/stripe-panel.tsx`, `versions-panel.tsx`. |
| The webhook verifies the signature on the raw body, then rejects (400) any event whose live/test flag does not match `STRIPE_SECRET_KEY`. Responses: 503 not configured, 400 bad/missing signature, 500 processing failure (Stripe retries), 200 `{"received":true,"status":"processed"\|"ignored"\|"duplicate"}`. | `app/api/stripe/webhook/route.ts`, `tests/event-mode.test.ts`. |
| Fulfillment logic (126 automated tests pass): paid checkout → customer + order (`payment_status = paid`) + license (`status = pending`, **no key yet**) + installation request; **Issue license key** → license `active`; same event id twice → `duplicate`; full refund → order `refunded` and license `revoked`; partial refund → `partially_refunded`, license unchanged. | `lib/commerce/fulfillment.ts` and the test suite (in-memory database). |
| The Basic Calculator order is matched by the Stripe **product** ID on the purchased line item (not by price ID). | `fulfillment.ts` `handleCheckoutSession`. |

### Not yet verified (assumptions you are testing)

- The schema build on a **real** Supabase project (the local run used stand-ins for Supabase's `auth`/`storage` schemas and roles).
- The Stripe CLI commands and the Stripe Dashboard screens as described below (taken from Stripe's documentation, not run).
- The exact wording and layout of admin screens beyond the button names listed above.
- That `Authorize domain` makes a domain valid for `/api/license/validate` straight away (domain verification rules were not traced).
- The annual-update checkout steps (Test E). Treat that test as optional and less certain.
- That `sb_publishable_…` / `sb_secret_…` style Supabase keys work with this app version (the code accepts either variable name; legacy JWT keys are the safer choice because `check-env.sh` can verify which project they belong to).

---

## 2. Audit: anything that could reach production or Verexa

| Item | Risk | Status |
|---|---|---|
| `lib/supabase/config.ts`: if `NEXT_PUBLIC_SUPABASE_URL` is unset, the app used to fall back to the **production** URL. | Test app writing to production. | Fixed: the fallback now applies only when `VERCEL_ENV=production`. Previews and local runs without the variable show a 503 "not configured" page, and a Preview pointing at the production project is refused. Still checked by `check-env.sh`. |
| Environment variables already set in your terminal override `.env.local`. | Production values leaking in. | `check-env.sh` fails if any Supabase/Stripe/Monarch/Vercel variable is set. |
| Other `.env*` files are also loaded by Next.js. | Surprise overrides. | `check-env.sh` fails on any file except `.env.local`. |
| `.env.local.example` pointed at the Verexa project. | Copying it connected you to Verexa. | Fixed (placeholders only). |
| `README.md` named the Verexa project as the app's database. | Misleading. | Fixed. |
| `lib/admin.ts`: if no host header and no `NEXT_PUBLIC_APP_URL`, links use the production domain. | Wrong return URLs only; no data access. | `check-env.sh` requires `NEXT_PUBLIC_APP_URL=http://localhost:3000`. |
| Migrations: no connection strings or project refs. `044133` seeds two draft products that carry the **live** Stripe product IDs, and links an admin if `info@monarchtaxsuite.com` exists in `auth.users` (it will not in a new project). | Harmless text; no connection. | Documented in step 7. |
| `docs/monarch-commerce.md` tells you to run `supabase db push` against the Monarch project. | Pushing to production by habit. | That is a production instruction. Do not use `supabase link`, `supabase db push`, `vercel env pull`, `vercel dev` or any `vercel` command for this test. No `supabase/config.toml` or `.vercel` folder exists in the repo. |
| `apply.sh` connecting to the wrong database. | Schema written to production/Verexa. | Seven layered checks (section 3). |
| Stripe CLI. | Live requests. | CLI is test mode by default. Never add `--live`; never pass a `sk_live_` key. |
| Admin buttons that create Stripe products/prices. | Live Stripe objects if a live key were loaded. | `check-env.sh` rejects any live key. Section 7 lists the buttons to skip anyway. |
| CRM / HighLevel / lead webhooks. | Outbound posts to real services. | Leave all `HIGHLEVEL_*` unset (`check-env.sh` enforces). Do not configure a lead destination. |

---

## 3. How `apply.sh` protects you (and its limits)

All of these must pass before anything is written:

1. `TEST_PROJECT_REF` is exactly 20 lowercase letters and is not the production or Verexa ref.
2. `TEST_DB_URL` matches one of two strict shapes and contains **exactly** your test ref in the host (direct) or in the user name (pooler). Query strings, `#`, extra `@`, other hosts, and the protected refs (any capitalisation) are all refused.
3. All `PG*` environment variables are cleared (they could redirect the connection).
4. **The database must say it is the test project.** Schema `public` must carry the comment `monarch-test-throwaway:<ref>`, which you set yourself from inside the test project's SQL editor. A database without it is refused. This is the independent check: it does not depend on the URL being typed correctly.
5. The database must look like Supabase (roles `anon`/`authenticated`/`service_role`, `auth.users`, `storage.buckets`) and `public` must have **no** tables, views or other relations. Production and Verexa both have tables.
6. You must type the project ref back.
7. Each file runs in its own transaction and stops at the first error.

`DRY_RUN=1` runs checks 1 to 5 and stops. Always do the dry run first.

**Limits:** if you deliberately put the marker comment into the production or Verexa database from their SQL editor, *and* their `public` schema were empty, *and* you used that project's real ref, the script could not know. That takes several deliberate steps and neither real database has an empty `public` schema. The script also cannot see which dashboard you copied the password from, so use the independent check in step 2.

---

## 4. Test vs live at a glance

| | Live (production) | Test (this runbook) |
|---|---|---|
| Stripe | Live mode | **Test mode** (orange banner) |
| Stripe key | `sk_live_…` | `sk_test_…` |
| Webhook secret | the live endpoint's `whsec_…` | `whsec_…` from the Stripe CLI (different, local only) |
| Database | Monarch project `ftthniovwzxztkwtregz` | **New throwaway project** |
| App | https://monarch-tax-suite.vercel.app | `http://localhost:3000` |
| Cards | real | `4242 4242 4242 4242` |

Test and live Stripe data are completely separate: different products, prices, customers, payments. A test product has **different** `prod_` and `price_` IDs from the live one. That is expected. Never copy test IDs into production or live IDs into the test database.

Do **not** use a Vercel preview or production for this test. The Preview-scoped `STRIPE_SECRET_KEY`'s mode has not been checked, preview has no webhook secret. With this release a preview that has no database settings shows a "not configured" page and can no longer fall back to the production database, but a preview still must not be pointed at production or at live Stripe keys.

---

## 5. Step-by-step

Tick each box. If any step does not give the expected result, **stop** and see section 11.

### Step 0. Prerequisites (once)

- [ ] Node 20+, `npm ci` completes in the repo, on branch `claude/launch-readiness-hardening` (do not merge it for this).
- [ ] `psql` installed (PostgreSQL client).
- [ ] [Stripe CLI](https://docs.stripe.com/stripe-cli) installed and `stripe login` done with the Monarch Stripe account (this only authorizes the CLI; it changes nothing).
- [ ] A scratch text file **outside the repo** for values you will paste. Never paste keys into chat, commits or screenshots.
- [ ] A **fresh terminal** (no leftovers from other work).

### Step 1. Create the throwaway Supabase project (manual)

In the Supabase dashboard:

1. New project, name **`monarch-test-throwaway`**, any region, strong database password (save it in your scratch file). Do not touch `ftthniovwzxztkwtregz` or `daxpavvsotvsyqqntddc`.
2. Project Settings → General → copy the **Reference ID** (20 letters). Call it `TEST_REF`.
3. SQL Editor (check the project name at the top says `monarch-test-throwaway`), run:
   ```sql
   comment on schema public is 'monarch-test-throwaway:<TEST_REF>';
   select extname, extnamespace::regnamespace from pg_extension where extname = 'pgcrypto';
   ```
   Expected: the second query returns one row, `pgcrypto` in `extensions`. (If it returns nothing the foundation file creates it; that is also fine.)
4. Authentication → Users → **Add user** → *Create new user*: your own email and a password; tick **Auto Confirm User**. Remember the email.
5. Project Settings → API Keys: copy the project URL, the publishable/anon key and the secret/service-role key into your scratch file. Prefer the **legacy anon / service_role** keys if the dashboard still offers them: `check-env.sh` can then confirm they belong to your test project.
6. Click **Connect** and copy the **Session pooler** connection string (user looks like `postgres.<TEST_REF>`). Use the pooler because the direct `db.<ref>.supabase.co` address is IPv6-only on many connections. Replace `[YOUR-PASSWORD]` with the password, URL-encoded (for example `@` becomes `%40`).

Nothing else needs manual setup: Storage (the migration creates its image bucket), extensions, the `auth`/`storage` schemas and the standard roles come with every Supabase project. The test does not need Edge Functions, Realtime or the Vault.

### Step 2. Build the schema (dry run first)

From the repo root:

```
export TEST_PROJECT_REF='<TEST_REF>'
export TEST_DB_URL='postgresql://postgres.<TEST_REF>:<URL-encoded-password>@aws-0-<region>.pooler.supabase.com:5432/postgres'
DRY_RUN=1 ./supabase/test-env/apply.sh
```

Expected: `All safety checks passed.`, the target host and ref, and `DRY_RUN=1: nothing was changed.` Any line starting with `REFUSING:` means stop and read it.

- [ ] **Independent check (do not skip).** In the Supabase dashboard, open the project you are looking at, go to Settings → General, and confirm that its Reference ID equals the ref in the output above **and** that the project name is `monarch-test-throwaway`.

Only after both match:

```
./supabase/test-env/apply.sh
```
Type the ref when asked. Expected: `applying …` for 11 files, then `Done. Tables in public: 19`.

Then, in the test project's SQL editor, run `supabase/test-env/schema_fingerprint.sql` and compare with the expected values in its header (counts must match; checksums should).

Then clear the password from your shell:
```
unset TEST_DB_URL TEST_PROJECT_REF
```

Create the test admin (SQL editor of the **test** project):
```sql
insert into public.admin_users (user_id)
select id from auth.users where email = '<the email from step 1.4>';
```
Expected: `INSERT 0 1`. Check: `select count(*) from public.orders;` returns `0`, and `select public.hit_rate_limit('x', now());` returns `1`.

This step also rehearses the pending rate-limit migration (`200000`) and the lead-storage removal (`180000`).

### Step 3. Create Stripe test objects (Dashboard, Test mode ON)

Confirm the orange **Test mode** banner first.

1. Product catalog → Add product `Monarch Basic Tax Calculator (TEST)`, one-time **$75.00 USD**. Copy its `prod_…` and the price's `price_…`.
2. On that price, **Create payment link**. Copy the `https://buy.stripe.com/test_…` URL. (Payment Links collect the buyer's email, which the app requires.)
3. Optional, for Test E only: product `Annual Tax-Year Update (TEST)`, one-time **$50.00**; copy its `prod_…` and `price_…`.

You create these in the Stripe Dashboard yourself. You do **not** need any app button to create Stripe products or prices.

### Step 4. Get the test webhook secret

```
stripe listen --print-secret
```
Prints a `whsec_…` value (per the Stripe CLI docs; test mode, local use). Copy it to your scratch file. It is not the live endpoint's secret, and nothing in Stripe or Vercel is changed.

### Step 5. Create `.env.local` and run the pre-flight check

Create `.env.local` in the repo root (git-ignored), starting from `.env.local.example`:

```
NEXT_PUBLIC_SUPABASE_URL=https://<TEST_REF>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<test publishable/anon key>
SUPABASE_SERVICE_ROLE_KEY=<test service-role/secret key>
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_APP_URL=http://localhost:3000
MONARCH_ENCRYPTION_KEY=<optional: a throwaway value; see section 9>
```
`STRIPE_SECRET_KEY` comes from Stripe Dashboard (**Test mode**) → Developers → API keys.

```
./supabase/test-env/check-env.sh <TEST_REF>
```
Expected: every line `PASS` and `ALL CHECKS PASSED.` Any `FAIL` means stop and fix it. `NOTE` lines are information.

### Step 6. Start the app and forwarding

Terminal 1: `npm run dev`. Terminal 2: `stripe listen --forward-to localhost:3000/api/stripe/webhook`. Never add `--live`. Leave both running.

Expected in terminal 2: `Ready!`, then one line per event with the HTTP status your app returned.

### Step 7. Make the product sellable (test database only)

Sign in at `http://localhost:3000/login` with the test admin. Admin → Products → *Basic Tax Calculator*. A fresh database seeds this product as a draft with the **live** Stripe product ID copied from the original setup; replace it:

- Price: `75.00`
- Stripe product ID: your test `prod_…`
- Stripe price ID: your test `price_…`
- Installation options: tick at least one
- Product settings (one `key: value` per line): `checkout_url: https://buy.stripe.com/test_…`
- Click **Save & publish** (this never calls Stripe).

Optional read-only check: **Verify with Stripe**. With the test key and test IDs it should report verified (test mode). On the live IDs it would only say "not found", which is harmless.

Expected: `/shop` lists the product.

---

## 6. Tests

### Test A. Payment, signed webhook, order, license

1. Open `http://localhost:3000/shop`, open the product, click buy → Stripe Checkout (test banner). Pay with `4242 4242 4242 4242`, any future expiry, any CVC and ZIP, an email you control.
2. Watch terminal 2.

| Where | Expected |
|---|---|
| `stripe listen` | `checkout.session.completed` → `[200]`. Other events (`charge.succeeded`, `payment_intent.succeeded`, `payment_intent.created`…) also `[200]`; some are answered with status `ignored`, which is correct. |
| `npm run dev` terminal | a line like `stripe-webhook: evt_… checkout.session.completed -> processed`; no errors |
| Stripe (Test mode) → Developers → Events | the same events |
| Stripe → Payments | one $75.00 payment, Succeeded |
| Test DB `stripe_events` | one row per event id, status `processed` or `ignored` |
| Test DB `orders` | 1 row: `payment_status = paid`, `amount_cents = 7500` |
| Test DB `calculator_licenses` | 1 row: `status = pending`, `key_hash` empty |
| Admin → Orders / Licenses | the order and a **pending** license |

3. Admin → Licenses → the license → **Issue license key**. The key `MTS-…` is shown **once**; copy it to your scratch file.

   Expected: license `status = active`, `key_prefix` set, `key_hash` set (hash only; the key itself is not stored).

4. Optional: on the license, **Authorize domain** `localhost`; then
   `curl "http://localhost:3000/api/license/validate?id=<emb_… id from the license page>&domain=localhost"` → expected `{"valid":true}` (assumption, see section 1).

**Pass:** exactly one order, one license, key issued once.

### Test B. Duplicate event

Take the `evt_…` id of `checkout.session.completed` (from the terminal 2 output or Dashboard → Events).
```
stripe events resend evt_…
```
Per Stripe's docs this sends the event again to the CLI's local listener (test mode; never add `--live`).

Expected: terminal 2 `[200]`; the app log shows `-> duplicate`; `orders` still 1, `calculator_licenses` still 1, no repeated event id in `stripe_events`.

### Test C. Refunds

1. **Partial:** make a second purchase (new email), then Dashboard (Test mode) → that payment → Refund → $10. Expected: `charge.refunded` `[200]`; that order `payment_status = partially_refunded`, `amount_refunded_cents = 1000`; its license **unchanged**.
2. **Full:** Dashboard → the first payment → Refund → full amount. Expected: `charge.refunded` `[200]`; order `payment_status = refunded`, `refunded_at` set; license `status = revoked`, `revoke_reason = Payment refunded`; admin shows revoked. If you authorized `localhost`, the validate URL now returns `{"valid":false,"reason":"unavailable"}`.

### Test D. Safety negatives (no money involved)

- Bad signature: `curl -i -X POST http://localhost:3000/api/stripe/webhook -H 'stripe-signature: t=1,v1=bad' -d '{}'` → `400`, nothing written.
- Mode guard: `node --test tests/event-mode.test.ts` → pass (a live event on a test key, and the reverse, are refused).
- Dispute (optional, not verified): pay with Stripe's dispute test card `4000 0000 0000 0259`; expected `charge.dispute.created` → order disputed and license `suspended`. (`stripe trigger charge.dispute.created` does **not** work for this: it creates unrelated test data, so the app answers `ignored: No order for this dispute`.)

### Test E. Annual update (optional, least certain)

Needs the annual-update product (step 3.3) set in the test database with the test product ID and a version whose price is verified. Use **Check Stripe price** then **Link price** (both safe). **Do not use "Create & link price"** (it creates a Stripe price). Then `http://localhost:3000/update`, enter the license key, pay `4242…`. Expected: `checkout.session.completed` `[200]`, the license moves to the newer tax-year version, a second order of $50. Refunding that order reverts only the update. These steps were not traced end to end.

---

## 7. Rules while the test runs

- Run `./supabase/test-env/check-env.sh <TEST_REF>` at the start of **every** session.
- Never run `vercel`, `supabase link`, `supabase db push`, or any Stripe command with `--live`.
- Never paste secrets into chat or commits; `.env.local` is git-ignored.
- Do not click: **Update Stripe product info**, **Create Stripe product**, the create-price button in the Stripe panel, **Create & link price**. They write to Stripe with whatever key is loaded. With a test key that only affects test mode, but this runbook never needs them.
- Skip the old CRM pages under `app/(app)/` (clients, engagements, tasks). They use tables Monarch's database does not have.

---

## 8. The Basic Calculator price ID discrepancy (investigated, nothing changed)

| Source | Basic Calculator price ID |
|---|---|
| Your original instructions | `price_1UOcySLVYOWPw48grmegxbVH` |
| Production database row | `price_1UOcySLvYOWPw48grmeghXVH` |
| Repo tests (`tests/stripe-verify.test.ts`) | same as the database value; introduced in commit `b8f2f88` |

Findings:
- The two strings differ in two places (`LV` vs `Lv`, and `gxb` vs `ghX`). The product IDs and the Annual Update price ID match across all sources.
- No application code contains either price ID. Fulfillment matches by **product** ID, so a wrong price ID would not stop an order from being fulfilled. It would make **Verify with Stripe** fail (price not found), and it matters if your live Payment Link was built on a different price.
- Circumstantial only: the Annual Update price in your instructions contains the segment `LvYOWPw48`, like the database's Basic value, while your Basic value has `LVYOWPw48`. Stripe price IDs from one account normally share that segment, which suggests the database value is the consistent one and the instructions' value has a typo. This is **not proof**: Stripe IDs are case-sensitive and Stripe cannot be queried from here.
- Nothing was changed. The test project cannot settle it because test mode has different IDs.

How to settle it (no production change): Stripe Dashboard → **live** mode → Product catalog → Basic Tax Calculator → the $75 price → copy the Price ID and compare it character by character with the value on the production admin product page. If they match, the discrepancy was in the instructions. If not, tell me and I will prepare the correction for your approval. Do not use "Verify with Stripe" on production for this: it writes a verification result to the production database.

---

## 9. Pending production items (not executed; each needs your explicit approval)

### Rate-limit migration `20261009200000_rate_limit_counters.sql`
Adds one table and one function; touches nothing existing. If it is not applied, the code fails **open** (requests allowed, a warning logged). Rehearsed in your test project in step 2 (`hit_rate_limit('x', now())` returns `1`, then `2`). Production steps once you approve: review the SQL, apply it, check the table exists and `/api/license/validate` still answers. Rollback: `drop function public.hit_rate_limit(text, timestamptz); drop table public.rate_limit_counters;`.

`20261009180000_remove_lead_storage.sql` drops lead storage (0 rows in production, but still a drop). Separate approval.

### `MONARCH_ENCRYPTION_KEY` (already set in Production, 2026-10-09)
A secret of exactly 32 random bytes, base64-encoded. It is now in Vercel Production as a Sensitive variable, so lead destinations can be saved. Do not change, rotate or delete it once a destination has been saved: saved destinations would become unreadable and would have to be entered again.

For this test, leave it unset or use a **different throwaway** value generated on your own computer (`openssl rand -base64 32`). Never reuse the production value, and never paste any key in chat.

---

## 10. Evidence to keep

- **Stripe (Test mode):** Events, webhook delivery 200s, Payments, Refunds.
- **Terminal logs:** `stripe-webhook: evt_… <type> -> processed|ignored|duplicate`. A `rejected (mode_mismatch)` line means a test event reached a live-key deployment, which must never happen here.
- **Test database:** `stripe_events`, `orders`, `calculator_customers`, `calculator_licenses`, `calculator_license_events`.
- **Vercel:** nothing. The test runs locally. Production logs must show no test events; if they do, a wrong URL was used. Stop.

---

## 11. Stop rules

Stop and ask before continuing if:

- `apply.sh` or `check-env.sh` prints `REFUSING` / `FAIL` and you are tempted to work around it.
- `.env.local` mentions `ftthniovwzxztkwtregz` or `daxpavvsotvsyqqntddc`, or contains `sk_live_`.
- Stripe Dashboard shows no **Test mode** banner while you create products, pay or refund.
- Any command would drop, delete, reset, truncate or rotate something in production, or change a Stripe product/price ID.
- You are about to add the CLI's webhook secret to Vercel (it is local-only).
- Production Vercel logs show a test event.

## 12. Cleanup

Stop `npm run dev` and `stripe listen`. Delete `.env.local`. Delete the `monarch-test-throwaway` project (check its name first). Test-mode Stripe objects can stay.

---

## 13. Remaining blockers before the first run

1. **You** must create the Supabase test project and set the marker (step 1). Nothing can run until then.
2. **You** must create the Stripe test product, price and Payment Link (step 3).
3. The assumptions in section 1 stay untested until you run the steps; report any mismatch rather than working around it.
4. The Basic Calculator live price ID must be settled in the live Stripe Dashboard (section 8) before real selling. It does not block the test.
