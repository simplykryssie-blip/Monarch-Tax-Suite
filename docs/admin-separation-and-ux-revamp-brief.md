# Admin Separation + Tenant UX Revamp — Owner Brief

**Owner:** Krystal (Verexa HQ / Monarch Tax Suite)
**Date:** 2026-10-22
**Status:** Owner decisions below are FINAL. Order of work: Part 1 (separation) first, then Part 2 (revamp).

Approved by Krystal 2026-10-22. Part 1 comes before Part 2. The Part 1 classification list and the Part 2 current-state map both go back to Krystal for review before anything is moved or redesigned.

## Owner decisions (2026-10-22)

1. **Platform admin gets its own sign-in identity: `info@verexahq.com`.** The Monarch owner login (info@monarchtaxsuite.com) stops doubling as platform admin.
2. **Platform admin lives at `admin.verexahq.com`** — its own door into the same codebase, not a tab inside a tenant workspace.
3. **The revamp is an information-architecture pass, not a paint job.** Owner's words: "It's not just the clicking, it's where things are placed and hidden." Placement and visibility are the problem; click count follows from them.

## Why

Today the platform owner and a tenant owner are the same account in the same app. The Admin tab (#76) grouped Workspaces, Billing setup, and Integrations, but platform-level configuration still sits inside a tenant session — so Verexa's platform integrations can box in what Monarch-the-tenant (and later, every tenant) can connect for itself. Monarch must become an ordinary tenant: first, not special. Platform-level everything belongs to Verexa HQ.

---

## Part 1 — Separate platform admin from tenants

### 1.1 What moves behind admin.verexahq.com
- Workspaces list and workspace management (all tenants)
- Platform billing setup: Verexa's Stripe billing account, plans/prices, billing webhook configuration
- Platform integrations: every platform-level key/setting (Stripe billing, Resend platform sending, Turnstile, platform webhook secrets)
- The `PLATFORM_LEGAL_APPROVED` switch and platform legal/policy controls
- Platform-wide settings currently reachable from a tenant session (the #76 Admin tab contents, rehomed)

### 1.2 Rules
- Admin surfaces render **only** at admin.verexahq.com and **only** for platform admin accounts (info@verexahq.com). A tenant session — including Monarch's owner — never sees admin UI, and direct URL attempts at admin routes from a tenant session are denied, not hidden.
- Monarch's workspace contains **zero** platform keys or platform settings. Monarch's own integrations (its tenant Stripe Connect, its sending setup, its Twilio when funded) are configured inside Monarch like any tenant's, and no platform configuration may block or override a tenant's own integrations.
- **Classification before migration:** produce a list of every integration/setting currently in the app, classified platform vs tenant, for owner review BEFORE anything moves. Nothing gets reclassified silently.
- Platform admin actions are audit-logged with the same discipline as workspace audit events.
- The admin shell must be designed so the Phase 7 Verexa staff/support view (audited, time-limited support access) slots in later. Do NOT build the support view in this pass.
- Signup gating is unchanged: production signup stays closed until the signup gate clears (counsel → legal PR → real $99 signup). Admin separation must not open it.

## Part 2 — Tenant UX revamp (placement & visibility pass)

### 2.1 Audit first — no redesign before the map
Produce a current-state map for owner review: every tenant-facing screen, where it lives in navigation, how many clicks from home, and what is reachable only through an unrelated section (buried/hidden). Owner marks what is misplaced; the redesign follows her marks, not assumptions.

### 2.2 Principles
- Daily tax-office work — clients, leads, returns/pipeline, calendar/bookings, messages, billing — is visible and reachable in ≤2 clicks from anywhere. Nothing used daily lives behind Settings-style groupings.
- One obvious home per function. A feature reachable only through an unrelated section is a defect.
- Global search / quick actions so any record is findable without knowing where it "lives."
- Consistent placement across all tenant surfaces; mobile (390px) parity with desktop.
- Visual changes only where the layout changes. Brand stays Verexa HQ in the platform/tenant app; Monarch workspace branding rules are unchanged.

### 2.2a Added 2026-10-22 (owner)
- **Automations run on happenings and facts, never on tags.** Triggers are events (form submitted, payment landed, pipeline stage changed, document signed, date arrived). Conditions check facts (service, office, balance, dates). Tags are labels for finding and sorting people only; a tag may appear as one visible condition inside a rule, but deleting or renaming a tag must never silently break an automation.
- **Take back from the previous CRM (Verexa Tax Office v2):** one left menu grouped by frequency (Daily first), everything daily one click from anywhere; a command-center home (money this month, a "waiting on you" review queue with a count badge, quick actions); a global "search clients" box on every page; one name per function everywhere; platform templates offered as installable products that the tenant chooses.
- **Do not repeat its tangles:** platform admin locked even to the firm owner, and tenant setup (SMS) decided platform-wide and invisible to the tenant; tags as the automation backbone ("delete one thing, break five"); everything hanging off one hub object; duplicated features (two review queues, two dashboards); settings switches that showed "off" while the feature still ran; the service-bureau network woven into every surface instead of a separable layer.
- **Guardrails:** no invisible controls, no single hook everything hangs from, no switches that don't switch.

### 2.3 Out of scope for this pass
- Phase 7 items beyond the admin-shell foundation (staff/support view, per-plan first-time setup flows)
- Data export, pipelines import, forms/automations rebuild (already parked separately)

## Working rules (standing)
- Multi-tenant test for every decision: "how does this work for tenants?"
- Preview first for verification (note: `claude/preview-env` must be updated from the default branch before any Preview test — it is frozen at bd01830).
- Per-action owner approval for production merges, migrations, and data writes. Test-before-production ordering holds.
- Fake/test data only in tests; Danica's records are never touched.
