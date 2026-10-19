# Phase 5c — client portal: build notes

What was built, how to set it up, and what Luna should test on the Preview.

## What it does
| Piece | Where |
|---|---|
| Portal sign-in: one login across offices, invite by email (one-time link, 7 days), optional two-step sign-in | `/portal`, `/portal/invite/<token>`; staff panel on the client page ("Portal" tab in the admin workspace, on the client page in the office and PTIN areas) |
| Return status, messages | `/portal`, `/portal/messages` (sent emails and texts only; call logs and notes never show) |
| Document center: staff share documents (nothing is shared by default), ask for documents, clients upload PDF/JPG/PNG (15 MB, 40 a day, checked by content) | `/portal/documents`; "Ask for a document" and "What the client can see" on the staff panel |
| Signing (Form 8879, Form 8821, any signable library PDF) | staff: client page, Portal tab, "Send a form to sign" (admin workspace); client: `/portal/sign` which opens the existing signing page |
| Invoices | Billing: **Send to client** shows the invoice in `/portal/invoices`; the client is emailed if they have portal access |
| Online payment (Stripe Connect) | Settings → Payments (connect/refresh/disconnect); **Pay now** on the portal invoice |

## Preparing Form 8821 / Form 8879
Upload the IRS fillable PDF to Documents, then rename its form fields after merge fields (for example `client_name`, `client_address`, `client_ssn`, `firm_name`, `firm_ptin`, `firm_caf_number`). Fields staff must type at send time are named `ask.tax_matters`, `ask.form_numbers`, `ask.tax_years` (any `ask.<name>` works). Add the signing consent statement and a field named `signature`. Settings → Firm profile now has PTIN and CAF number.

The full SSN is decrypted on the server only when the form has a `client_ssn` field, is written only into the filled copy, and each use is audited without the number. Staff add it on the client's Portal tab under Tax ID. The portal never shows it (last four only).

## Settings to add in Vercel (names only; values never go in chat)
- `STRIPE_CONNECT_SECRET_KEY` Verexa HQ's Stripe secret key (this is the Connect platform; separate from the storefront's `STRIPE_SECRET_KEY`)
- `STRIPE_CONNECT_CLIENT_ID` the `ca_…` id from Connect settings
- `STRIPE_CONNECT_WEBHOOK_SECRET` signing secret of a **Connect** webhook endpoint at `/api/stripe/connect-webhook` (listen to events on connected accounts: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `account.updated`, `account.application.deauthorized`)
- `STRIPE_CONNECT_REDIRECT_BASE` (optional) the host registered as the OAuth redirect, for example the Verexa HQ address; the redirect is `<base>/api/stripe/connect/callback`. Without it the deployment's own address is used.
- Preview uses test-mode keys; production uses live ones. A test account only connects to a test deployment and the reverse.

## Money
Standard accounts, direct charges. The Checkout Session is created on the office's own account and the money lands there; the platform never holds it and takes no fee. Verexa's own revenue (SMS credits, number fees) stays on Verexa's account.

## Migrations (apply in order, each is additive)
`20261111090000_client_portal`, `20261112090000_portal_documents`, `20261113090000_portal_signing`, `20261114090000_stripe_connect`. Gate: `supabase/tests/phase5c_isolation.sql` (36 checks, rolled back).

## Known limits
- The document library, firm profile, Billing and Settings → Payments exist only in the admin workspace today, so "Send a form to sign", invoices and Connect are available there. Invites, document requests and sharing also work from the office and PTIN client pages.
- A signed 8821 PDF contains the SSN in the clear in the office's private storage (inherent to the form).
- Staff reveal of the full SSN (owner, password step-up) has a service but no screen yet.
- An online payment that arrives after an invoice was voided is recorded on the payment but not on the voided invoice.
- Refunds and disputes are handled in the office's own Stripe dashboard.
