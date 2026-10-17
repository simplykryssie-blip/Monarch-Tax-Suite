# Phase 4 Spec — PTIN-holder Operations

**For the builder. Owner-approved 2026-10-16 (scope + decisions).**
**Principle:** Every build decision evaluated for the multi-tenant future. PTIN holders see their own work within their tenant — never another tenant's, never bureau-level tools they don't have.

## Overview

Phase 4 is the standalone PTIN-holder surface. These are tax preparers who hold a PTIN but are not EROs (no EFIN) — they prepare returns under someone else's EFIN or as independent preparers. Phase 3 built the ERO side; Phase 4 builds the base of the role hierarchy as a standalone product surface.

**Scope boundary (owner decision 2026-10-16):** The platform builds ONLY what this spec describes. Each tenant's own onboarding flow (application → agreement → training → credentials), intake forms, and incentive/fee structures are tenant-configured, NOT hardwired into the platform. Nothing in this spec bakes Monarch's Tier 1 ($199) flow into the system.

## Role context

From the approved hierarchy (Phase 3):

```
Service Bureau
  └── Everything ERO has
        └── Everything PTIN holder has
              └── Base: client intake, return prep work, view assigned returns
```

Phase 4 builds that base layer as a standalone experience for the `ptin` tier. PTIN holders linked to an ERO office keep working inside the ERO's office area (Phase 3); Phase 4 is for independent PTIN holders operating on their own account.

---

## Piece 0: Tenant sign-in (dependency, IN SCOPE — owner decision)

A `ptin`-tier tenant has no way to sign in today: `currentTenantId()` still returns the Monarch tenant and workspace pages use `requireAdmin` (platform admin users).

**Build:** tenant provisioning and session-to-tenant resolution for the `ptin` tier, with two-step sign-in available as in the Phase 3 office area (**optional for holders, see the amendment below**). Without this, the isolation gate can only be tested with simulated requests, not a real sign-in — so this ships as part of Phase 4, not as a follow-up.

**Amendment, owner decision 2026-10-17:** two-step sign-in is OPTIONAL for PTIN-holder workspaces. The platform provides the compliance tools; it does not enforce compliance on tenants. The holder is offered it right after accepting the invite (strongly recommended, with a Skip for now), can turn it on later from Security, and once it is on it is enforced at every sign-in. The office area still requires it.

---

## Piece 1: PTIN-holder Workspace

**Type:** Workflow — the preparer's day-to-day surface.

### What it includes

**1. My Clients (client intake)**
- Client list, add-a-client, client detail (contact, documents received, returns, communication log)
- **Per-user scoping (owner decision):** everyone sees their OWN clients — not all clients in the tenant. Scope by the preparer (assignee/owner), not just `tenant_id`. Keep `created_by` on the schema so this never needs a painful migration later.

**2. Prep work (return preparation)**
- Returns in the holder's own queue, with prep status
- Return workspace: intake checklist, documents attached, prep notes, review status
- Status flow: Not started → In prep → Ready for review → (handed to ERO)
- **Build once, show twice (code review finding):** `lib/office/permissions.ts` already lists `clients.intake`, `returns.prep`, `returns.assigned` as "soon, arrives with the Return Pipeline" for office preparers, and `/workspace` already has My Clients / work board / documents for the `ptin` tier. Build the return-prep and assignment layer ONCE (a return with an assignee and a prep status) and surface it in both the PTIN workspace and the office area. No duplicate implementations.

**3. Assigned returns**
- In a one-person tenant the queue is the holder's own work (owner decision). Where a linked ERO exists, work the ERO assigns also appears here.
- No access to returns assigned to other preparers.

**4. Handing a return to an ERO (cross-tenant)**
- This crosses tenants, so it must NEVER be a shared row (isolation rule).
- **Mechanism (owner decision):** export file + the ability to email it to the ERO from the system. The ERO imports it on their side. Export is a clean portable file (PDF/CSV), sent from the holder's tenant identity — never raw database rows.

### "Linked to an ERO" (definition — owner decision)
An active `office_members` row. Nothing else counts as linked.

### What it does NOT include (out of scope)
- E-file / transmission (requires an EFIN — ERO level, Phase 3)
- Fee statements and payouts (ERO level, Phase 3)
- Bank product enrollment (ERO/bureau level)
- Staff management or preparer oversight (ERO level)
- The tenant's onboarding flow, agreements, training, or credential issuance (tenant-configured)

### Permissions
- PTIN-holder tier sees: My Clients, Prep work, Assigned returns, WISP (Piece 2), and their own profile/settings
- PTIN-holder tier does NOT see: ERO Dashboard, Bureau Dashboard, Fees & statements, EROs & EFINs, Compliance Center (office-level), Store/bureau admin areas
- Uses the existing tier-based navigation (`tenants.tier = 'ptin'`); tier gates menus, and server-side checks enforce it (tier is not a security boundary on its own)

---

## Piece 2: Independent WISP (sold as the $25 product — owner decision)

**Type:** System (shared engine) + Workflow (the holder's own attestation).

### Background
- PTIN holders linked to an ERO inherit that ERO's WISP automatically and acknowledge it (Phase 3, built).
- Independent PTIN holders (not linked to any ERO) have no WISP covering them — and the FTC Safeguards Rule requires one for anyone handling taxpayer data.

### What to build
- Independent PTIN holders purchase the existing **$25 WISP Assisted Build product**; on purchase they get the guided builder (shared engine) for their own practice
- **Schema (code review finding):** `compliance_attestations`, vault documents, and the reminder sweep are all `organization_id NOT NULL`, so a holder with no organization cannot use them as-is. Build a new tenant-keyed attestation record for independent holders (new table or schema change — builder's choice, tenant-keyed either way), and extend the reminder sweep to cover it.
- **Wording (code review finding):** `lib/wisp/plan.ts` is written for a firm with a Qualified Individual. Add sole-practitioner wording for the independent flow.
- On completion: per-holder WISP attestation record (name, date, review-due date), stored tenant-scoped
- Annual review reminders (same pattern as Phase 3: due 12 months after attestation, reminders at 30 and 7 days, shows Overdue after — locks nothing, guided not caged)
- The holder can download/print their WISP document

### When a holder later links to an ERO (owner decision)
The independent WISP record is KEPT as archived history (they needed it while independent — that compliance record matters). The ERO's WISP becomes the active covering WISP from the link date forward. Never deleted.

### What it does NOT include
- Firm-level WISP attestation (that's the ERO office's, Phase 3)
- Preparer acknowledgment tracking under an ERO (Phase 3)

---

## Cross-cutting requirements

### Tenant isolation
- Every new table gets `tenant_id` from day one; RLS enforced
- Per-user scoping for clients and returns (owner decision — everyone sees their own)
- **Gate:** `phase4_isolation.sql` on the test project, written in the same style as the Phase 2/3 gates. Name the checks explicitly, including: one tenant cannot read another's clients, returns, attestations, or audit rows; the assignment rules; the link rules (active `office_members` only); and the no-shared-row handoff rule. The Supabase connector has hung on delete statements before — the spec allows running the gate in the SQL editor.

### Audit logging
- **No existing pattern to reuse** (`compliance_events` is organization-based; no audit table for the workspace). Build a generic, immutable, tenant-keyed audit table for workspace actions (builder's recommendation). It should serve future phases too, not just Phase 4.

### Mobile
- PTIN holders work from phones. All Phase 4 screens must be mobile-responsive.
- Verification: named screens checked at 390px width.

### No hardwiring
- No tenant's onboarding flow, agreement text, pricing, or incentive structure is baked into the platform
- The workspace ships with neutral labels and empty states; each tenant configures their own process around it

---

## Out of scope for Phase 4
- Tenant onboarding flows (application, agreements, training, credentials) — tenant-configured
- E-file/transmission, bank products, fee statements — ERO level (Phase 3)
- Calendar, website builder, advanced automations — Phase 5
- Client-facing taxpayer portal — future phase

---

## Phase 4 exit gate
- [ ] Tenant sign-in working for `ptin` tier (real sign-in, not simulated)
- [ ] PTIN-holder workspace built per spec, tenant-aware + per-user-scoped from first line
- [ ] Return-prep/assignment layer built once, surfaced in both workspace and office area
- [ ] Cross-tenant handoff works via export + in-system email (no shared rows)
- [ ] Independent WISP purchasable as the $25 product; attestation stored tenant-keyed; reminders firing
- [ ] Linking to an ERO later archives (never deletes) the independent WISP
- [ ] Tier gating correct: `ptin` tier sees only its surface, server-side enforced
- [ ] `phase4_isolation.sql` passes on test project with named checks
- [ ] Mobile verified at 390px on named screens
- [ ] Generic audit table in place and logging
- [ ] No Monarch-specific onboarding flow, agreement, or pricing hardwired
- [ ] No phase starts until this gate passes (owner rule)
