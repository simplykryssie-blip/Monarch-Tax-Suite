#!/usr/bin/env bash
# Build the Monarch schema in an EMPTY, THROWAWAY Supabase test project.
#
#   TEST_PROJECT_REF='<20-letter Reference ID of the TEST project>' \
#   TEST_DB_URL='postgresql://...' \
#   ./supabase/test-env/apply.sh
#
# Add DRY_RUN=1 to run every safety check and stop before changing anything.
#
# Seven independent checks must ALL pass before anything is written:
#   1. TEST_PROJECT_REF is well-formed and is not production or Verexa.
#   2. TEST_DB_URL matches a strict allowlist of Supabase URL shapes whose host
#      (or pooler user name) contains exactly TEST_PROJECT_REF.
#   3. No PG* environment variable can redirect the connection (they are cleared).
#   4. The database itself says it is the test project: schema "public" carries
#      the comment  monarch-test-throwaway:<TEST_PROJECT_REF>  that YOU set from
#      inside the test project's own SQL editor (see docs/stripe-test-runbook.md).
#   5. The database looks like a Supabase project and "public" has no tables.
#   6. You type the project reference back (not a generic word).
#   7. Each file runs in its own transaction and stops at the first error.
set -euo pipefail
unset "${!PG@}" 2>/dev/null || true   # PGHOST, PGSERVICE, PGOPTIONS, ... must not influence the connection
export PGCONNECT_TIMEOUT=15

die() { echo "REFUSING: $*" >&2; exit 1; }

PROD_REF="ftthniovwzxztkwtregz"
VEREXA_REF="daxpavvsotvsyqqntddc"

: "${TEST_PROJECT_REF:?Set TEST_PROJECT_REF to the Reference ID of the TEST project}"
: "${TEST_DB_URL:?Set TEST_DB_URL to the database connection string of the TEST project}"

# 1. Reference sanity
[[ "$TEST_PROJECT_REF" =~ ^[a-z]{20}$ ]] || die "TEST_PROJECT_REF must be exactly 20 lowercase letters."
[[ "$TEST_PROJECT_REF" != "$PROD_REF" && "$TEST_PROJECT_REF" != "$VEREXA_REF" ]] || die "TEST_PROJECT_REF is the production or Verexa project."
for ref in "$PROD_REF" "$VEREXA_REF"; do
  [[ "${TEST_DB_URL,,}" != *"$ref"* ]] || die "TEST_DB_URL mentions protected project $ref."
done

# 2. Strict URL allowlist. Anything else (query strings, extra hosts, other shapes) is refused.
#    direct : postgresql://postgres:PASSWORD@db.<REF>.supabase.co:5432/postgres
#    pooler : postgresql://postgres.<REF>:PASSWORD@<region-host>.pooler.supabase.com:5432|6543/postgres
#    local  : only when ALLOW_LOCAL_TEST_DB=1 (used to test this script itself)
pw='[^@/?#[:space:]]+'
direct="^postgres(ql)?://postgres:${pw}@db\\.${TEST_PROJECT_REF}\\.supabase\\.co:5432/postgres$"
pooler="^postgres(ql)?://postgres\\.${TEST_PROJECT_REF}:${pw}@[a-z0-9-]+\\.pooler\\.supabase\\.com:(5432|6543)/postgres$"
local_url='^postgres(ql)?://[a-z_]+(:[^@/?#[:space:]]*)?@(localhost|127\.0\.0\.1):[0-9]+/[a-z0-9_]+$'
if [[ "$TEST_DB_URL" =~ $direct || "$TEST_DB_URL" =~ $pooler ]]; then
  :
elif [[ "${ALLOW_LOCAL_TEST_DB:-}" == "1" && "$TEST_DB_URL" =~ $local_url ]]; then
  echo "NOTE: local scratch database mode."
else
  die "TEST_DB_URL does not match an allowed shape for project $TEST_PROJECT_REF. Use the direct or pooler string from the TEST project (Connect button), with the password URL-encoded and no ?options."
fi

here="$(cd "$(dirname "$0")" && pwd)"
files=("$here/00_default_privileges.sql" "$here/00_foundation.sql")
for f in "$here"/../migrations/*.sql; do files+=("$f"); done
psql_run=(psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -X -q -At)

# 4. Database must identify itself as the test project
marker="monarch-test-throwaway:${TEST_PROJECT_REF}"
actual="$("${psql_run[@]}" -c "select coalesce(obj_description('public'::regnamespace,'pg_namespace'),'')")" \
  || die "could not connect with TEST_DB_URL."
[[ "$actual" == "$marker" ]] || die "the database does not carry the test marker. In the TEST project's SQL editor run:  comment on schema public is '${marker}';   If you cannot, this is probably the wrong database."

# 5. Looks like Supabase, and is empty
shape="$("${psql_run[@]}" -c "select
  (select count(*) from pg_roles where rolname in ('anon','authenticated','service_role'))=3
  and to_regclass('auth.users') is not null
  and to_regclass('storage.buckets') is not null
  and exists (select 1 from pg_proc where proname='gen_random_uuid')")"
[[ "$shape" == "t" ]] || die "this does not look like a Supabase project (missing roles, auth.users or storage.buckets)."
ntables="$("${psql_run[@]}" -c "select count(*) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p','v','m','f')")"
[[ "$ntables" == "0" ]] || die "schema public already has $ntables relation(s). Use a brand-new empty test project."

host="$(echo "$TEST_DB_URL" | sed -E 's#^[a-z]+://[^@]*@##; s#[:/].*##')"
echo "All safety checks passed."
echo "  target host : $host"
echo "  project ref : $TEST_PROJECT_REF"
echo "  files       : ${#files[@]} (in this order)"; printf '    %s\n' "${files[@]##*/}"
if [[ "${DRY_RUN:-}" == "1" ]]; then echo "DRY_RUN=1: nothing was changed."; exit 0; fi

# 6. Typed confirmation of the project reference
read -r -p "Type the test project reference ($TEST_PROJECT_REF) to continue: " answer
[[ "$answer" == "$TEST_PROJECT_REF" ]] || { echo "Cancelled."; exit 1; }

# 7. Apply
for f in "${files[@]}"; do
  echo "applying ${f##*/}"
  "${psql_run[@]}" -1 -f "$f" >/dev/null
done
echo "Done. Tables in public: $("${psql_run[@]}" -c "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")"
