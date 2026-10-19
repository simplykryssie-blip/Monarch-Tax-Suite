# Phase 5 Spec — Calendar, Website Builder, Advanced Automations, Client Portal

Owner: Krystal. Scoped 2026-10-17. Status: DRAFT (pending builder review). This is the spec as received; the builder's review, questions and build plan are in `docs/phase5-build-plan.md`.

## Owner decisions (locked)

1. **Calendar = both.** Appointment booking with public links (per the `book.monarchtaxsuite.com` plan — GoDaddy forward to the SaaS calendar URL, link never changes) AND full calendar management inside the office.
2. **Website builder = GHL-style.** Multi-page websites for tax offices, drag-and-drop builder, plus funnels (multi-step). **No preset websites** — offices build from blank, no template gallery.
3. **Advanced automations = expand the workflow builder.** Branching, wait/delay steps, more triggers and actions (builds on the Oct 15 Automations restructure: Workflows / Pipelines / Templates sub-tabs).

## Standing rules (apply to all)

- Every build decision evaluated for the multi-tenant future (Verexa HQ CRM).
- Every new table gets `tenant_id` day one, tenant-scoped RLS, private storage.
- Per-tenant everything: no shared calendars, sites, or workflows across tenants.
- Phone-first: Krystal works from iPhone; all must be usable at 390px.

---

## Piece 1 — Calendar

**What it is:** The office's scheduling system. Two faces:
- **Internal:** full calendar management — view, create, edit, delete appointments; staff assignment; reminders.
- **Public:** booking links — each office gets branded booking pages; `book.monarchtaxsuite.com` forwards to the SaaS calendar so the published link never changes.

**Key behaviors:**
- Appointment types (e.g., "Tax Prep Consultation — 30 min") with duration, buffer, availability windows.
- Reminders via email/SMS (uses tenant's own SMS credits — never the platform number).
- Booking creates/updates a contact; no-show/cancel handling.
- Timezone-aware (office timezone + client timezone).

**Multi-tenant:** Calendars, appointment types, bookings, and reminders are all tenant-scoped. One office never sees another's calendar.

**Open for builder:** Google Calendar sync — in scope or deferred? (Recommend: deferred to keep Phase 5 shippable.)

---

## Piece 2 — Website Builder (GHL-style)

**What it is:** A drag-and-drop page builder for tax offices. Multi-page websites + funnels.

**Key behaviors:**
- **Pages:** offices build multi-page sites (Home, Services, About, Contact, etc.) from blank canvas. Sections, text, images, forms, buttons. No preset templates — blank start only (owner rule).
- **Funnels:** multi-step funnels (e.g., opt-in → booking → thank-you) with step navigation and conversion tracking per step.
- **Forms:** embed the existing Forms product (lead capture flows into the office's pipeline).
- **Domains:** office can point a custom domain; default is a platform subdomain.
- **Publishing:** draft → publish; unpublished changes don't affect the live site.

**Multi-tenant:** Sites, pages, funnels, and assets are tenant-scoped with private storage. One office's site is invisible to others.

**Explicitly OUT:** preset/template gallery (owner: "Do not create preset websites"). Blog engine — deferred unless builder flags it as trivial.

**Open for builder:** Custom-domain SSL provisioning — confirm approach (Vercel handles it, but confirm per-tenant flow).

---

## Piece 3 — Advanced Automations

**What it is:** Expand the existing workflow builder (post-Oct-15 restructure) from basic to capable.

**Current limits (to remove):**
- Only 2 triggers (`Paid license created`, `Form submitted`) → add more (see below).
- Only 4 actions (send email, send document, request signature, record note) → add more.
- Max 5 steps, no branching, no delays → branching + wait steps + higher step cap.

**New triggers (proposed):** Appointment booked / cancelled / no-show; WISP attested; invoice paid / overdue; tag added/removed; pipeline stage changed; date-based (e.g., 30 days before tax deadline).

**New actions (proposed, from Tier 1 gap analysis):** create task; add/remove tag; update contact; enroll in training; send SMS (tenant credits); wait X days/hours; branch on condition; funded-return counter increment; add to review/approval queue.

**Multi-tenant:** Workflows and templates are per-tenant with independent copies on install (already decided). The "already installed" guard must be per-tenant.

**Testing:** workflow test mode — pick a test contact, run end-to-end, skip untestable steps (actual email/SMS sends).

**Open for builder:** Step cap — propose a number (recommend 25). Branching depth limit.

---

## Piece 4 — Client Portal

**What it is:** Each tax office's clients get their own login.

**Key behaviors (owner-confirmed):**
- Upload tax documents (W-2s, 1099s, etc.) — private per-client storage.
- Track return status (where their return stands).
- Sign documents (8879s and similar).
- Message their preparer.
- Pay invoices.

**Multi-tenant:** Portal is branded per office; clients only ever see their own office and their own documents. Tenant-scoped RLS on everything; client logins are separate from staff logins.

**Open for builder:** Invite flow — office invites client by email (like the PTIN holder invite pattern)? Confirm.

---

## Exit gate (Phase 5)

Same bar as Phase 4:
1. Migrations on test project; `phase5_isolation.sql` gate (named checks, all PASS, rolled back).
2. End-to-end test on Preview: book an appointment via public link; build + publish a 2-page site; build a 3-step funnel; run a branched workflow with a wait step; invite a test client to the portal and upload a document.
3. 390px check on all new pages (including the client portal).
4. Typecheck / lint / build clean; tests green.
5. Owner merge approval → production migrations (separate approval) → merge → verify production deploy.

## Roadmap after Phase 5

Pre-launch package: Monarch → Verexa HQ rebrand, Verexa HQ company policies, tenant signup + billing, Stripe statement-name fix ("Monarch Tax Suit" typo), Supabase project rename, Resend confirmation.
