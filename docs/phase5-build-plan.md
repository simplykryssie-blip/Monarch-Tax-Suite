# Phase 5 — builder's review and build plan

Reads `docs/phase5-spec.md` against the code as it is on `claude/tax-crm-saas-platform-5km7dp` (after Phase 4). Nothing is built. Section 1 is what the code already has and doesn't have, section 2 is what I need decided before building, section 3 is the proposed order, section 4 is the gate.

## 0. Owner answers (2026-10-17) and what they change

| # | Answer | Effect on the plan |
|---|---|---|
| 1 | Vercel plan is Pro. | A 5-minute cron is fine (5.0). |
| 2 | Waits in minutes, hours **and days**; every wait/schedule has a **business vs calendar** toggle. | New office **business calendar** (5.0, see below). Wait steps, appointment reminder offsets and date triggers all take `{amount, unit, mode}`. |
| 3 | Staff generate an invoice from Billing and **push it to the client's portal**, with a payment link to Stripe Checkout. | Online payment is in this phase, through Stripe Connect (section 0b, A). |
| 4 | Booking matches by email across customers, leads and clients; updates whichever exist; creates a lead if none. No choice on the form. | One `matchPerson(email)` used by booking, forms and workflows (5.0). Updates every match, not just the first. |
| 5 | Site addresses are `<office>.monarchtaxsuite.com`; the main office uses `www.monarchtaxsuite.com`. | Each office subdomain is added to the Vercel project by API (needs a Vercel API token and project id as settings) with one wildcard CNAME at the DNS host. Details and one decision below (open question B). |
| 6 | 8879 signing reuses the signing engine; no counsel review. | As planned. |
| 7 | **Form 8821** in the portal, pre-filled from the office's and the client's information; staff are asked for the reason when they click send, then it goes to the client's portal to sign. | New, in 5c. Details and open question C below. |
| 8 | "WISP attested" = the Phase 3 office WISP attestation. | Trigger `compliance.wisp_attested`, source `compliance_attestations`. |
| 9 | Five-part split approved. | Order below stands. |
| - | Approved: defer training enrollment, approval queue and funded-return counter; `.ics` instead of Google Calendar sync; SMS consent checkbox on the booking form; 25 steps / depth 3; one portal login across offices. | As planned. |

### Business calendar (new, 5.0)
Per tenant: weekly open hours (default Monday to Friday, 9:00 to 17:00 in the office time zone, editable), a list of closed days (holidays, office closures; the owner types them in, nothing is preloaded), and the office time zone. "2 business days" = skip closed days and weekends; "2 business hours" = count only open hours, so a wait that starts at 16:00 Friday ends at 10:00 Monday. Calendar mode ignores all of it. One function (`addBusinessTime`) is used by waits, reminders and date triggers, and is unit-tested around weekends, closed days, DST changes and the time-zone edges.

### Form 8821 (5c)
- It is a library document: the IRS's fillable Form 8821 PDF with fields named after merge fields, so it uses the document engine and signing as 8879 does. The office uploads the IRS PDF to its library once (or we add it for them; confirm we may fetch it from irs.gov).
- Pre-filled from existing data: the client's name, address and phone; the appointee's (the office's) name, address, phone and PTIN. Anything we don't hold is left for the right person to type.
- **The reason**: staff are prompted when they click Send. The IRS form calls this "tax matters" (what it covers, the form numbers, the years), so the prompt asks for those three things in plain words. This needs a new kind of field, "ask at send time", in the merge-field system.
- **The client's SSN/ITIN is not pre-filled**, because the workspace deliberately keeps only the last four digits. See open question C.

## Open questions after the answers

A. **Invoices.** You described the push (staff generate, push to the portal). I read that as: the client *sees* the invoice and its status in the portal and pays the way they do today (bank transfer, card in office, etc.), with **online payment through Stripe Connect left for the next phase**. Is that right, or does she want clients to pay online in this phase? (If online now, that alone adds the size of a phase, as noted in section 2.)

B. **Wildcard DNS.** To serve `<office>.monarchtaxsuite.com` we need one wildcard CNAME (`*` to Vercel) at the DNS host (GoDaddy). It does not move the domain's nameservers, so email and other records are unaffected. Existing named records (`app`, `book`, `www`) keep working because explicit records win over a wildcard. Anything not claimed by an office returns "not found". Someone with GoDaddy access adds the record and a Vercel API token is added as a setting. Is that acceptable? And is `www.<office>.monarchtaxsuite.com` for downline just a redirect to `<office>.monarchtaxsuite.com`?

C. **8821 and the full SSN.** An 8821 needs the taxpayer's full SSN/ITIN. Options: **(1)** the client types it into the form in the portal when signing (not stored by us anywhere except inside the signed PDF in the office's private storage); **(2)** we start storing full SSNs, encrypted (a bigger data-protection change). *Recommend (1).* Also: does the office's CAF number need to appear (it isn't stored today)? I'd add it as an office setting.

D. **Business calendar defaults.** Mon to Fri, 9 to 17, no holidays preloaded, editable per office: OK?

## 0b. Owner answers to A to D (2026-10-17) and what they change

**A. Online invoice payment is in Phase 5, through Stripe Checkout.** The money routing changes my assessment. The store sells the platform's *own* products, so its payments belong to the platform and go to the platform's Stripe account. An invoice is the *office's* money. If invoice payments went through the platform's Stripe account, the platform would be collecting and holding other businesses' funds and paying them out: that is what Stripe Connect exists to avoid (Stripe's terms require it for platforms that take payments on behalf of others), and it would make the platform responsible for payouts, refunds and chargebacks that aren't its own. So the plan is **Stripe Connect, Standard accounts, direct charges**: each office connects its own Stripe account (Settings → Payments); the invoice's payment link opens a Checkout Session created *on the office's account*; the money lands in the office's Stripe account and never touches the platform's. The platform takes no fee unless the owner decides to (open question E). Pieces:
- Settings → Payments: connect, status (onboarding incomplete, charges enabled), disconnect.
- "Send to portal" creates the payment link only if the office's account can take charges; otherwise the invoice is pushed without a pay button and says so to staff.
- A Connect webhook endpoint with its own signing secret; a paid Checkout marks the invoice paid (amount checked against the invoice, once only, the existing `recordPayment`); failed or expired sessions leave it unpaid.
- Refunds and disputes are handled by the office in its own Stripe dashboard; the invoice shows the status the webhook reports.
- Test mode on the Preview with a test connected account. The owner has to **enable Connect on the platform's Stripe account** (Stripe dashboard → Connect → Get started, platform profile) before any of this can be tested; production use needs Stripe's review of that profile.
- Bank-CSV reconciliation stays (manual review) for offices that are paid some other way.
- This is its own sub-piece, **5c-pay**, built last in 5c, so the rest of the portal can ship and be checked without waiting on Stripe's review.

**B. Wildcard domain: approved.** Default `<office>.monarchtaxsuite.com`; `www.<office>.monarchtaxsuite.com` redirects to it. The owner adds the GoDaddy wildcard CNAME (or signs in so I can see what is needed); the Vercel API token and project id are added as settings.

**C. Full SSN stored, encrypted, reveal on demand.** Design:
- **Storage:** `clients.ssn_encrypted` (AES-256-GCM, authenticated with the tenant and client ids so a copied value can't be moved to another client). `ssn_last4` stays as it is for matching bank deposits. Nothing returns the full number to a page by default.
- **Keys:** the current master key (`MONARCH_ENCRYPTION_KEY`) is documented as one that must not be rotated once data is saved under it. SSNs raise the stakes, so 5.0 adds **key versions**: each ciphertext records which key sealed it, a new key can be added and old values re-sealed in the background, and each tenant gets its own data key wrapped by the master key (so one tenant's key can be rotated or destroyed alone). The key stays in the host's secrets, never in the database.
- **Reveal on demand:** a button on the client's page, for staff whose role allows it (the account owner; in an office, the ERO, and a preparer only if the ERO grants a new "view full SSN" permission). It asks for the person's password again (step-up), shows the number for 30 seconds, and writes who/when/which client to the audit history (never the number). Rate-limited. The number is never put in a URL, a log, an email, an automation event or a CSV; the Phase 4 handoff file still carries only the last four.
- **Entry and use:** entered on the client form (masked field, format-checked: 9 digits, ITIN range allowed); used server-side only to fill documents such as the 8821.
- **Deletion:** removed with the client record (the 24-hour window applies).
- **Known limit:** a filled, signed 8821 is a PDF that contains the SSN in the clear, in the office's private storage. That is inherent to the form. I'd treat private storage plus the audit trail as the control and flag it in the product's documentation; app-level encryption of stored PDFs is a possible later step.
- **Review:** this is the first place the platform holds full SSNs, so a security review of the change is part of its exit gate, in addition to the isolation script.
- **CAF number:** a field in the office's settings, used by the 8821.

**D. Business calendar: approved, with federal holidays preloaded.** Each office gets its own rows in a `business_closures` table (`tenant_id`, name, start date, end date, `source` federal or custom, `enabled`). The eleven US federal holidays are generated for the current year and the next two when the office first opens the setting, and a yearly sweep adds the next; a weekend holiday is observed on the Friday before (Saturday) or the Monday after (Sunday). Each can be switched off, and the **dates are editable as a range**, so Christmas can be made December 23 to 26. Offices add their own closures on top. Because the rows are the office's own, editing one never affects another office.

### New open question
E. **Platform fee on invoice payments.** With Connect the platform can take a percentage or flat fee on each payment, or none. Default in this plan: none. Is that right?

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
4. **Website builder: how much, and where it runs.** *Recommend v1:* a fixed block set (section, columns, heading, text, image, button, form embed, booking embed, spacer, FAQ) stored as a JSON tree per page version and rendered on the server. **No custom HTML/JavaScript block in v1** (sites would run on our origin; a script block is an account-takeover and phishing risk). Phone editing: add/move blocks with up-down controls and an "Add block" menu; real drag-and-drop on desktop only (touch drag is unreliable at 390px). Default address: `<office>.monarchtaxsuite.com` (owner answer 5).
5. **Custom domains.** Vercel's Domains API does the SSL. It needs an API token and the project id as server settings, and each office adds a CNAME/A record we show them. Confirm that's the flow. Apex domains need the A record or a registrar that supports ALIAS.
6. **Google Calendar sync:** deferred (agree). I'd add a calendar file (`.ics`) to the booking confirmation email: small, and works with Google/Apple/Outlook.
7. **Portal invite:** yes, by email, one-time link, same pattern as the PTIN holder invite (no self-signup). Two-step sign-in **optional** for clients, as for holders. Confirm.
8. **Portal and 8879.** Reuse the signing engine and say plainly in the product that it records a typed or drawn signature with a certificate. Does the owner want counsel to approve the 8879 wording before launch? (Per the "tools, not enforcement" rule I'll make no compliance claim in the UI.)
9. **Triggers/actions that don't exist yet.** "WISP attested": the holder WISP was removed; the Phase 3 office WISP attestation exists. Is that the one meant? "Enroll in training", "approval queue", "funded-return counter": each is a feature; I'd defer all three unless the owner says otherwise. "Tag added/removed" works for leads now; clients have no tags.
10. **Automation limits.** Step cap 25 and branch depth 3, as proposed. Existing workflows (≤5 steps) stay valid.
11. **Appointment reminders by text** need the client's consent: a checkbox on the booking form, stored with the booking.
12. **Is this one phase?** Calendar, automations, portal and the site builder are four large builds. *Recommend sub-phases*, each with its own isolation gate, Preview check and merge: **5.0** foundations → **5a** Calendar → **5b** Automations → **5c** Client portal → **5d** Website builder + funnels. Each is demonstrable and shippable alone.

## 3. Proposed order

**5.0 Foundations (small, first).** 5-minute scheduler (Pro); business calendar and `addBusinessTime`; `matchPerson(email)` across customers, leads and clients;  generic event subject; a shared "public page by host" resolver for booking, portal and sites; `tenant_id`-keyed analytics-event table design (no personal data, hashed IP).

**5a Calendar.** Tables: `appointment_types`, `availability_rules` (weekly hours, date overrides), `appointments` (UTC start/end, office and client time zones, status booked/cancelled/no_show/done, staff assignee, SMS consent, cancel/reschedule token hash), `appointment_reminders`. Double-booking is prevented in the database (an exclusion constraint per staff member). Pages: office calendar (day/week/agenda; agenda is the 390px default), appointment types, availability, public `/book/<office>/<type>` (reachable on the office's own `link_host`; `book.monarchtaxsuite.com` forwards to Monarch's). Emails and texts through the existing sender and tenant credits. Events emitted for the automations.

**5b Automations.** Step tree with branches and waits, suspended executions with a resume time, cap 25, depth 3; new triggers whose sources exist after 5a (appointments), plus invoice paid/overdue, tag changes, pipeline stage changed, date-based; new actions create task, add/remove tag, update contact, send text (tenant credits). Test mode extended to branches and waits (waits skipped, sends not made). Per-tenant "already installed" guard.

**5c Client portal.** `portal_members` (tenant, client, auth user; many-to-many so one person can be a client of several offices), invite by email, branded sign-in on the office's host, a portal-only area that staff pages and portal pages can never reach each other from. Features in order: upload documents (private per-client storage, limits and type checks), return status (from `client_returns`), messages (the existing `client_messages`), invoices (staff push an invoice from Billing; the client sees it and its status; the pay button is 5c-pay, Stripe Connect), signing (existing engine; 8879 and Form 8821 as library documents, the 8821 with a send-time prompt for the reason).

**5d Website builder.** `sites`, `site_pages`, `site_page_versions` (draft/published), `funnels`, `funnel_steps`, `site_assets`, `site_domains`, `site_events`. Editor, publish, funnel step views and conversions, forms and booking embeds, domain flow per Q5.

## 4. Gate

Per sub-phase, the Phase 5 exit gate in the spec: migrations on the test project, an isolation script with named checks (`phase5a_isolation.sql`, …, rolled back), Preview end-to-end, 390px on the new pages, typecheck/lint/build/tests, then owner merge approval and a separate approval for production migrations. Production is never touched without the explicit word.

Isolation checks planned for every sub-phase: one tenant cannot read or write another's rows in each new table; public tokens/links resolve only inside their own tenant; client-portal users cannot read staff data and staff cannot be mistaken for clients; storage paths stay inside the tenant bucket.
