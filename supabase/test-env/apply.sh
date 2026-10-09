#!/usr/bin/env bash
# Build the Monarch schema in an EMPTY, THROWAWAY test database.
#
#   TEST_DB_URL='postgresql://...' ./supabase/test-env/apply.sh
#
# Refuses to run against the production project, against a database that already
# has Monarch tables, or without typed confirmation. Each file runs in its own
# transaction and stops at the first error.
set -euo pipefail

PROD_REF="ftthniovwzxztkwtregz"
VEREXA_REF="daxpavvsotvsyqqntddc"
: "${TEST_DB_URL:?Set TEST_DB_URL to the database connection string of the TEST project}"

for ref in "$PROD_REF" "$VEREXA_REF"; do
  if [[ "$TEST_DB_URL" == *"$ref"* ]]; then
    echo "REFUSING: TEST_DB_URL contains project ref $ref (not a throwaway test project)." >&2
    exit 1
  fi
done

here="$(cd "$(dirname "$0")" && pwd)"
files=("$here/00_foundation.sql" "$here"/../migrations/*.sql)
psql_run=(psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -X -q)

existing="$("${psql_run[@]}" -At -c "select to_regclass('public.calculator_customers') is not null or to_regclass('public.orders') is not null")"
if [[ "$existing" != "f" ]]; then
  echo "REFUSING: this database already has Monarch tables. Use a brand-new empty test project." >&2
  exit 1
fi

host="$(echo "$TEST_DB_URL" | sed -E 's#^[a-z]+://[^@]*@##; s#[:/?].*##')"
echo "About to create the Monarch schema in database host: $host"
echo "Files (in order):"; printf '  %s\n' "${files[@]##*/}"
read -r -p "Type the word TEST to continue: " answer
[[ "$answer" == "TEST" ]] || { echo "Cancelled."; exit 1; }

for f in "${files[@]}"; do
  echo "applying ${f##*/}"
  "${psql_run[@]}" -1 -f "$f"
done
echo "Done. Tables: $("${psql_run[@]}" -At -c "select count(*) from information_schema.tables where table_schema='public'")"
