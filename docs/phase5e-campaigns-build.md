# Phase 5e: Campaign builder

Email and text campaigns for an office's own clients and contacts, in the main workspace (`/campaigns`) and the PTIN workspace (`/practice/campaigns`).

## What it does
- **Audience**: by tag, client/lead type, lead status, or hand-picked people, plus saved audiences. The screen shows who is left out and why.
- **Consent** (always wins over the filter): clients, people who booked, and people who submitted a form that adds respondents to Leads are marketable automatically. Anyone else needs the owner to mark them (Campaigns → Contacts & consent), or a CSV import with "Mark all as marketable" ticked. Texts additionally need text consent (booking checkbox, or marked by the owner / import). The owner can take consent away.
- **Composer**: merge fields (`first_name`, `name`, `office_name`, `office_phone`, `office_email`), phone/computer preview. Email always gets the office's mailing address and an unsubscribe link (also the RFC 8058 one-click header); texts get the office name and "Reply STOP to opt out." Scheduling is refused without a mailing address.
- **Schedule**: now or later (office time zone), optionally only while the office is open (business calendar).
- **Sending**: the five-minute tick sends batches of 60 per campaign. Email goes from the office's own verified sender; texts spend that office's credits. Outside production only `AUTOMATION_TEST_RECIPIENTS` are contacted.
- **Health**: no fixed cap. With at least 100 recent sends, bounces >= 3% or complaints >= 0.1% slow sending to 20% batches; bounces >= 8% or complaints >= 0.3% pause it.
- **Tracking**: opens (pixel) and clicks (own redirect) are estimates; delivery/bounce/complaint come from Resend; text delivery from Twilio.
- **Unsubscribe**: per office only. `/u/<token>` (confirm button) and one-click POST. STOP/START/HELP texts via the incoming-message webhook. Only hard bounces and spam complaints go on the platform-wide list (`platform_suppressions`: keyed hash only, no tenant_id, server-only).

## Owner setup
- `RESEND_WEBHOOK_SECRET` (Vercel): signing secret of a Resend webhook pointed at `<app>/api/campaigns/resend-webhook` for `email.delivered`, `email.bounced`, `email.complained`.
- Twilio: nothing to set up by hand. A number bought for an office is created with its incoming-message address already pointing at `/api/sms/inbound/<signature>` (the signature is derived from `MONARCH_ENCRYPTION_KEY`); the daily SMS sweep points older offices' numbers, and the owner's own number, at it too. Production only: a Preview never repoints a real number, so STOP handling is tested by posting to the endpoint directly or on production.
- Apply `supabase/migrations/20261116090000_campaigns.sql`.

## Notes for review
- Email opt-in is recorded whenever a form that adds respondents to Leads is submitted (`lib/forms/server.ts`).
- Text opt-in: a Forms-to-Leads form with a phone question shows an "OK to text me" box at the end, ticked to start and not required (Form settings → "Show an OK to text me box", default on; pick the mobile-number question). Ticking it stores `form_submissions.text_consent` (migration `20261116100000_form_text_consent.sql`) and records text consent for that email; a later form can never remove it, and a person whose consent was removed is not re-opted by it.
- Platform-level lookups added (all logged): `campaign_token`, `suppression`, `sms_inbound`.
- Gate: `supabase/tests/phase5e_isolation.sql` (run on the test project; every line PASS).
