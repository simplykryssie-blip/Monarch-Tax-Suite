# Turning on rate limiting for `/api/license/validate`

**Status today: NOT ACTIVE in production.** The code is in the application and
safe, but its database table does not exist in production yet. Until the
migration below is applied and checked, requests are not limited. Do not tell
anyone rate limiting is on until step 4 below has been done and observed.

## What it does

`/api/license/validate` is a public check that a calculator embed id is valid for
a website. It is limited to 60 requests per minute per visitor address and 600
per minute per embed id (HTTP 429 with a `Retry-After` header beyond that). The
calculator itself does not call this endpoint; only integrators do. Visitor
addresses are stored only as a keyed one-way hash, never as the address.

## The migration (reviewed, additive, not applied)

`supabase/migrations/20261009200000_rate_limit_counters.sql`

| Review point | Finding |
|---|---|
| What it creates | One new table `public.rate_limit_counters` and one function `public.hit_rate_limit(text, timestamptz)`. Nothing existing is altered, dropped or read. |
| Re-running | Safe: every statement is `if not exists` / `create or replace`. |
| Access | Row-level security is on. `anon` and `authenticated` have no access to the table or function; only the server's service role does. |
| Personal data | None. Buckets hold a keyed hash or a public embed id. |
| Cleanup | About 1 call in 100 deletes counter rows older than a day. |
| Dependencies | None on other tables. Needs the standard Supabase roles `anon`, `authenticated`, `service_role` (present in every Supabase project). |
| Rollback | `drop function public.hit_rate_limit(text, timestamptz); drop table public.rate_limit_counters;` removes only these two new objects. The app then goes back to "not limited". |

It was rehearsed on a throwaway local Postgres (not Supabase): applied twice
without error; 100 simultaneous calls on one bucket returned exactly 1 to 100
with no duplicates or lost counts; `anon` and `authenticated` were refused;
old rows were pruned. That is evidence about the SQL, not about production.

## If the counter store is unavailable (fail-open)

If the table is missing or the database call fails, the request is **allowed**
and a warning code (`rate_limit_store_unavailable`) is logged; nothing else about
the request is logged. This is the right choice here because:

- the endpoint only answers valid / not valid and reveals no customer data;
- the calculator and lead delivery do not depend on it;
- failing closed would turn a counter problem into an outage for every integrator;
- if the database is truly down, the check behind it fails anyway.

The cost is that during an outage (and before the migration) nothing throttles
the endpoint. If that ever matters, add a rate-limit rule in the Vercel Firewall
as an independent backstop. Lead submissions have their own separate limits
(per visitor and per license) that already work.

## Steps to apply and verify (needs the owner's approval first)

1. Merge and deploy the pull request first (the app already copes without the table).
2. In the Supabase dashboard, open the **Monarch** project (check the project name and
   reference `ftthniovwzxztkwtregz` at the top; do **not** use the Verexa project).
3. SQL Editor → paste the contents of the migration file → Run. Do not run any other file.
   Do **not** run `20261009180000_remove_lead_storage.sql`.
4. Check it is active:
   - Run `select to_regclass('public.rate_limit_counters');` → should return the table name.
   - Open `https://monarch-tax-suite.vercel.app/api/license/validate?id=emb_aaaaaaaaaaaaaaaaaaaa&domain=example.com` a few times,
     then run `select count(*), max(hits) from public.rate_limit_counters;` → rows appear and hits go up.
   - Seeing the HTTP 429 itself needs more than 60 requests in a minute (a short script from a computer); the rising counters are enough to show it is working.
5. Only after step 4, record "active" in `docs/launch-checklist.md`.
