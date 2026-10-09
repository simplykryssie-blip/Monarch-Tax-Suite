#!/usr/bin/env bash
# Pre-flight check for a LOCAL TEST RUN. Prints PASS/FAIL lines only; never prints values.
#
#   ./supabase/test-env/check-env.sh <TEST_PROJECT_REF>     (run from the repo root)
#
# Exit code 0 only if everything that can be checked says "test, local, isolated".
set -uo pipefail
REF="${1:-}"
PROD_REF="ftthniovwzxztkwtregz"; VEREXA_REF="daxpavvsotvsyqqntddc"
fail=0
ok()   { echo "PASS  $*"; }
bad()  { echo "FAIL  $*"; fail=1; }
note() { echo "NOTE  $*"; }

[[ "$REF" =~ ^[a-z]{20}$ ]] || { echo "Usage: $0 <20-letter TEST project reference>"; exit 2; }
[[ "$REF" != "$PROD_REF" && "$REF" != "$VEREXA_REF" ]] && ok "reference is not production or Verexa" || bad "reference is production or Verexa"
[[ -f package.json && -f .env.local ]] && ok "running in the repo root with .env.local present" || { bad "run this from the repo root and create .env.local first"; exit 1; }

# Other env files would be loaded by Next.js too, in a surprising order.
extra="$(ls -A | grep -E '^\.env' | grep -vxE '\.env\.local|\.env\.local\.example' || true)"
[[ -z "$extra" ]] && ok "no other .env files (only .env.local)" || bad "extra env files present: $(echo $extra | tr '\n' ' ')"

# Real environment variables beat .env.local in Next.js.
leaks="$(env | grep -E '^(NEXT_PUBLIC_SUPABASE|SUPABASE_|STRIPE_|MONARCH_|HIGHLEVEL_|VERCEL_|NEXT_PUBLIC_APP_URL|PG[A-Z]*=)' | sed 's/=.*//' | tr '\n' ' ')"
[[ -z "$leaks" ]] && ok "no Supabase/Stripe/Monarch/Vercel variables set in this terminal" || bad "terminal already has: $leaks (unset them or open a new terminal)"
[[ ! -d .vercel ]] && ok "no .vercel link in this folder" || note ".vercel folder exists; never run vercel commands for this test"

# Parse .env.local WITHOUT executing it.
declare -A V
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^[[:space:]]*# || -z "${line// }" ]] && continue
  [[ "$line" =~ ^([A-Z0-9_]+)=(.*)$ ]] || continue
  v="${BASH_REMATCH[2]}"; v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
  V["${BASH_REMATCH[1]}"]="$v"
done < .env.local

grep -qiE '(sk|rk)_live_|pk_live_' .env.local && bad ".env.local contains a LIVE Stripe key" || ok "no live Stripe key anywhere in .env.local"
grep -qE "$PROD_REF|$VEREXA_REF" .env.local && bad ".env.local mentions the production or Verexa project" || ok "no production/Verexa project reference in .env.local"

url="${V[NEXT_PUBLIC_SUPABASE_URL]:-}"
[[ "$url" == "https://${REF}.supabase.co" ]] && ok "NEXT_PUBLIC_SUPABASE_URL is the test project" \
  || bad "NEXT_PUBLIC_SUPABASE_URL must be exactly https://<test ref>.supabase.co (if unset the app falls back to PRODUCTION)"

[[ -n "${V[NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY]:-}" ]] && ok "publishable key present" || bad "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is empty"
svc="${V[SUPABASE_SERVICE_ROLE_KEY]:-${V[SUPABASE_SECRET_KEY]:-}}"
[[ -n "$svc" ]] && ok "service-role/secret key present" || bad "SUPABASE_SERVICE_ROLE_KEY is empty"
[[ -n "$svc" && "$svc" != "${V[NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY]:-x}" ]] && ok "service key differs from publishable key" || bad "service key equals the publishable key (or is empty)"

# Legacy JWT-style keys carry the project ref inside; new sb_* keys do not.
for name in NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_SECRET_KEY; do
  val="${V[$name]:-}"; [[ -z "$val" ]] && continue
  if [[ "$val" == eyJ* ]]; then
    r="$(node -e 'try{const p=JSON.parse(Buffer.from(process.argv[1].split(".")[1],"base64url").toString());console.log(p.ref||"")}catch{console.log("")}' "$val")"
    [[ "$r" == "$REF" ]] && ok "$name belongs to the test project" || bad "$name does not contain the test project reference"
  else
    note "$name is not a JWT, so its project cannot be verified here (sb_* keys); confirm in the Supabase dashboard"
  fi
done

[[ "${V[STRIPE_SECRET_KEY]:-}" =~ ^(sk|rk)_test_[A-Za-z0-9]+$ ]] && ok "STRIPE_SECRET_KEY is a TEST key" || bad "STRIPE_SECRET_KEY must start with sk_test_ (or rk_test_)"
[[ "${V[STRIPE_WEBHOOK_SECRET]:-}" =~ ^whsec_[A-Za-z0-9]+$ ]] && ok "STRIPE_WEBHOOK_SECRET present (whsec_...)" || bad "STRIPE_WEBHOOK_SECRET must be the whsec_ value printed by 'stripe listen'"
[[ "${V[NEXT_PUBLIC_APP_URL]:-}" == "http://localhost:3000" ]] && ok "NEXT_PUBLIC_APP_URL is http://localhost:3000" || bad "NEXT_PUBLIC_APP_URL must be http://localhost:3000"
k="${V[MONARCH_ENCRYPTION_KEY]:-}"
if [[ -z "$k" ]]; then note "MONARCH_ENCRYPTION_KEY unset: fine for this test (rate-limit hashing falls back; CRM stays off)"
else
  n="$(printf '%s' "$k" | base64 -d 2>/dev/null | wc -c)"
  [[ "$n" == "32" ]] && ok "MONARCH_ENCRYPTION_KEY decodes to 32 bytes" || bad "MONARCH_ENCRYPTION_KEY must be base64 of exactly 32 bytes"
fi
grep -qE '^(HIGHLEVEL_|HIGH_LEVEL_)' .env.local && bad "CRM (HighLevel) variables are set; leave them out for this test" || ok "no CRM credentials configured"

echo
[[ $fail -eq 0 ]] && echo "ALL CHECKS PASSED. It is safe to run 'npm run dev'." || { echo "NOT SAFE. Fix every FAIL line, then run this again."; exit 1; }
