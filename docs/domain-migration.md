# Branded domain migration: app.monarchtaxsuite.com

Status and the exact steps. Values below were read from Vercel, Resend and the code on 2026-10-10; nothing here is a guess.

## Verified facts
* Vercel project `prj_OoA3dOZHcs7F6uinbesou4YJN3Ae` has both `app.monarchtaxsuite.com` and `monarch-tax-suite.vercel.app`. Ownership of `app.` is verified, **but Vercel reports the domain `misconfigured: true`: no CNAME/A record points at Vercel yet.** Nameservers are GoDaddy's (`ns59/ns60.domaincontrol.com`); the domain is not delegated to Vercel.
* `NEXT_PUBLIC_APP_URL=https://app.monarchtaxsuite.com` is set for Production and Preview. `appOrigin()` uses it for: setup links, the calculator embed code shown to customers, installation-intake links, annual-update Stripe return URLs, and the default GoHighLevel OAuth redirect.
* The real OAuth callback route is **`/api/integrations/crm/callback`** (not `/highlevel/callback`).
* The real Stripe webhook route is **`/api/stripe/webhook`**.
* `HIGHLEVEL_REDIRECT_URI` (Production) now pins OAuth to the already-registered vercel.app callback, so the canonical-URL change cannot break GoHighLevel connections before the new redirect is registered.

## Classified hostname references
| Where | Kind | Action |
| --- | --- | --- |
| `lib/admin.ts` fallback host | last-resort default when no env/host | keep |
| `lib/automation/template.ts` sample values | preview-only sample text | keep |
| `lib/crm/setup.ts` shared-host list (`vercel.app`) | rule that stops customers claiming `*.vercel.app` | keep |
| Docs and test fixtures | historical | keep; updated here |
| Existing customer embeds (`…vercel.app/embed/calculator?id=…`) | must keep working | keep; fallback domain stays attached |

## Steps only you can do (in order)
1. **GoDaddy DNS**: add `CNAME`, host `app`, value `90a77252e62e4261.vercel-dns-016.com.` (Vercel's recommended value; `cname.vercel-dns.com.` also works). Do not change nameservers or other records. Then confirm `misconfigured` clears in Vercel → Domains.
2. **GoHighLevel app → Redirect URLs**: add `https://app.monarchtaxsuite.com/api/integrations/crm/callback` and keep the vercel.app one. Then delete `HIGHLEVEL_REDIRECT_URI` in Vercel and redeploy.
3. **Resend**: `monarchtaxsuite.com` is *registered to another Resend team*, so it cannot simply be added. Either find that team and verify the domain there (the API key in `RESEND_SECRET_KEY` must belong to the same team), or claim it into this account with the TXT record Resend gives (claiming issues new DKIM keys and stops the other team sending from it). Then set `MONARCH_EMAIL_FROM` (e.g. `Monarch Tax Suite <notifications@monarchtaxsuite.com>`).
4. **Stripe**: leave the webhook on `https://monarch-tax-suite.vercel.app/api/stripe/webhook` until the new address is proven. A second endpoint has its own signing secret, so switching also means swapping `STRIPE_WEBHOOK_SECRET`. Do that as one deliberate change after launch.

## Launch gates before merging #8 and #9
Merging deploys to Production, and the canonical URL then takes effect (setup links, embed code). Merge only after step 1 clears and `https://app.monarchtaxsuite.com/login` loads over HTTPS.
