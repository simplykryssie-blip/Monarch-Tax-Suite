# Phase 5 — builder's review and build plan

Reads `docs/phase5-spec.md` against the code as it is on `claude/tax-crm-saas-platform-5km7dp` (after Phase 4). Nothing is built. Section 1 is what the code already has and doesn't have, section 2 is what I need decided before building, section 3 is the proposed order, section 4 is the gate.

## 1. What the code says

| Spec item | What exists today | Consequence |
|---|---|---|
| Reminders, waits, date triggers | One Vercel cron, **once a day** (`vercel.json`: `0 11 * * *`) running `/api/automation/run`. | A "wait 2 hours" step, an appointment reminder "2 hours before", and "30 days before the deadline" cannot be on time. Needs a scheduler that runs every minute or few minutes. |
| Workflow engine | A workflow is a flat list `actions[]` (max 5, hard-coded in `lib/automation/validate.ts`), run in order inside one execution with retries. Events carry `license_id / customer_id / order_id`, i.e. they are about Monarch's own buyers. | Branching and waits are a new execution model (a step tree and a suspended-until state), not a bigger array. The event model has no generic "contact" subject, which most new triggers need. |
| "Contact" | Three separate people records: `calculator_customers` (buyers), `leads` (CRM; has `tags`), `clients` (workspace; no tags). | "Booking creates/updates a contact", "tag added", "update contact" each need an answer to *which* record. |
| Signing | `lib/documents/signing.ts`: typed or drawn signature on a PDF plus a certificate page, by one-time link. No account. | Reusable for the portal. It is not an IRS Form 8879 e-signature process (no taxpayer PIN or identity step). |
| Paying invoices | `invoices` are records the office keeps; money arrives by bank CSV import (manual review). The only Stripe account in the app is the platform's own. There is no Stripe Connect. | "Pay invoices" in the portal means money going to the *office*, which needs a connected Stripe account per office. This is the biggest scope item in the spec. |
| Public pages per tenant | `email_domains.link_host` already maps a web address to a tenant (`tenantForHost`), used by the WISP and forms. | Custom domains for sites and booking links can reuse this. Adding the domain to Vercel is new. |
| Texting | Per-tenant Twilio, credits, registration gating (Round 3). | Reminders can use it. Texts only go out once the office's registration is approved; email is the fallback. |
| Training, approval queue | No training module and no approval queue exist (searched). | "Enroll in training" and "add to approval queue" are new features, not new actions. |
| Client logins | Supabase Auth users are shared by staff, office members and PTIN holders; `tenant_members` is staff-only. | A client who is a client of two offices has *one* auth user and two memberships; today's one-user-one-workspace pattern doesn't fit. |

## 2. Questions to settle before building

Each has my recommendation. The first four change the plan; the rest are details.

1. **Scheduler (blocks Calendar reminders, waits, date triggers).** Is the Vercel plan one that allows frequent crons? If yes: a cron every 5 minutes. If not: an external pinger or a plan change. *Recommend:* every 5 minutes; reminders and waits are accurate to 5 minutes.
2. **Paying invoices in the portal.** Options: **(a)** Phase 5 shows invoices, status and "how to pay" and leaves online payment for the next phase; **(b)** build Stripe Connect now (office onboarding, per-account webhooks, refunds, fees). *Recommend (a).* (b) alone is the size of a phase and brings its own compliance. The owner listed payment as confirmed, so this is hers to decide.
3. **Which record is "the contact".** *Recommend:* a booking creates or updates a **lead** (it's the CRM record, has tags) and links to a **client** when the email already matches one. Workflow events get a generic `subject` (type + id) next to today's ids; existing workflows keep working unchanged.
4. **Website builder: how much, and where it runs.** *Recommend v1:* a fixed block set (section, columns, heading, text, image, button, form embed, booking embed, spacer, FAQ) stored as a JSON tree per page version and rendered on the server. **No custom HTML/JavaScript block in v1** (sites would run on our origin; a script block is an account-takeover and phishing risk). Phone editing: add/move blocks with up-down controls and an "Add block" menu; real drag-and-drop on desktop only (touch drag is unreliable at 390px). Default address: needs a platform domain with a wildcard (for example `*.sites.<domain>`); *until the owner picks that domain*, default to a path like `/s/<office>`.
5. **Custom domains.** Vercel's Domains API does the SSL. It needs an API token and the project id as server settings, and each office adds a CNAME/A record we show them. Confirm that's the flow. Apex domains need the A record or a registrar that supports ALIAS.
6. **Google Calendar sync:** deferred (agree). I'd add a calendar file (`.ics`) to the booking confirmation email: small, and works with Google/Apple/Outlook.
7. **Portal invite:** yes, by email, one-time link, same pattern as the PTIN holder invite (no self-signup). Two-step sign-in **optional** for clients, as for holders. Confirm.
8. **Portal and 8879.** Reuse the signing engine and say plainly in the product that it records a typed or drawn signature with a certificate. Does the owner want counsel to approve the 8879 wording before launch? (Per the "tools, not enforcement" rule I'll make no compliance claim in the UI.)
9. **Triggers/actions that don't exist yet.** "WISP attested": the holder WISP was removed; the Phase 3 office WISP attestation exists. Is that the one meant? "Enroll in training", "approval queue", "funded-return counter": each is a feature; I'd defer all three unless the owner says otherwise. "Tag added/removed" works for leads now; clients have no tags.
10. **Automation limits.** Step cap 25 and branch depth 3, as proposed. Existing workflows (≤5 steps) stay valid.
11. **Appointment reminders by text** need the client's consent: a checkbox on the booking form, stored with the booking.
12. **Is this one phase?** Calendar, automations, portal and the site builder are four large builds. *Recommend sub-phases*, each with its own isolation gate, Preview check and merge: **5.0** foundations → **5a** Calendar → **5b** Automations → **5c** Client portal → **5d** Website builder + funnels. Each is demonstrable and shippable alone.

## 3. Proposed order

**5.0 Foundations (small, first).** Frequent scheduler; generic event subject; a shared "public page by host" resolver for booking, portal and sites; `tenant_id`-keyed analytics-event table design (no personal data, hashed IP).

**5a Calendar.** Tables: `appointment_types`, `availability_rules` (weekly hours, date overrides), `appointments` (UTC start/end, office and client time zones, status booked/cancelled/no_show/done, staff assignee, SMS consent, cancel/reschedule token hash), `appointment_reminders`. Double-booking is prevented in the database (an exclusion constraint per staff member). Pages: office calendar (day/week/agenda; agenda is the 390px default), appointment types, availability, public `/book/<office>/<type>` (reachable on the office's own `link_host`; `book.monarchtaxsuite.com` forwards to Monarch's). Emails and texts through the existing sender and tenant credits. Events emitted for the automations.

**5b Automations.** Step tree with branches and waits, suspended executions with a resume time, cap 25, depth 3; new triggers whose sources exist after 5a (appointments), plus invoice paid/overdue, tag changes, pipeline stage changed, date-based; new actions create task, add/remove tag, update contact, send text (tenant credits). Test mode extended to branches and waits (waits skipped, sends not made). Per-tenant "already installed" guard.

**5c Client portal.** `portal_members` (tenant, client, auth user; many-to-many so one person can be a client of several offices), invite by email, branded sign-in on the office's host, a portal-only area that staff pages and portal pages can never reach each other from. Features in order: upload documents (private per-client storage, limits and type checks), return status (from `client_returns`), messages (the existing `client_messages`), invoices (view; online payment per Q2), signing (existing engine).

**5d Website builder.** `sites`, `site_pages`, `site_page_versions` (draft/published), `funnels`, `funnel_steps`, `site_assets`, `site_domains`, `site_events`. Editor, publish, funnel step views and conversions, forms and booking embeds, domain flow per Q5.

## 4. Gate

Per sub-phase, the Phase 5 exit gate in the spec: migrations on the test project, an isolation script with named checks (`phase5a_isolation.sql`, …, rolled back), Preview end-to-end, 390px on the new pages, typecheck/lint/build/tests, then owner merge approval and a separate approval for production migrations. Production is never touched without the explicit word.

Isolation checks planned for every sub-phase: one tenant cannot read or write another's rows in each new table; public tokens/links resolve only inside their own tenant; client-portal users cannot read staff data and staff cannot be mistaken for clients; storage paths stay inside the tenant bucket.
