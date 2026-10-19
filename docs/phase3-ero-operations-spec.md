# Phase 3: ERO Operations (approved spec)

**Status:** approved by the owner on 2026-10-13. Each piece is built in its own PR, in the order below.

**Sources:**
- the owner-approved Phase 3 spec (2026-10-13);
- the owner's answers to the builder's 15 questions (Q1–Q15, 2026-10-13).

Where an answer changed the original spec, the text below follows the answer and is marked **Owner decision (Qn)**. Nothing else has been changed in substance.

**Principle:** every build decision is weighed against the multi-tenant future. EROs see their own bureau's branding, fees and settings, and never another tenant's.

---

## 1. What Phase 3 is

Phase 3 is the side of the platform that EROs use to run their tax practice day to day, after onboarding: fees, compliance, returns, preparers, software, messaging, workflows and the dashboard. Phase 2 covered the bureau's own operations (onboarding EROs and managing the business).

## 2. Who uses it

- **Accounts. Owner decision (Q5).**
  - EROs and their preparers get invited accounts on the same app.
  - They land in a new **office area**.
  - The old `(app)` workspace (clients, engagements, tasks, settings) is retired.
- **What an office is. Owner decision (Q6).**
  - An office is a firm in **My Service Bureau** (an `organizations` row).
  - The firm's locations and EFINs are filters inside the office, not separate offices.
- **Visibility.**
  - An ERO sees only their own office, inside their tenant.
  - The bureau sees all of its EROs' offices, inside its tenant.

### Role hierarchy (inherited permissions)

```
Service Bureau
  └── everything an ERO has
        └── everything a PTIN holder has
              └── base: client intake, return prep work, view assigned returns
```

- **PTIN holder:** the base level. Client intake, prep work, and viewing their assigned returns.
- **ERO:** everything a PTIN holder has, plus e-file management, preparer oversight, fee tracking and the office dashboard.
- **Service Bureau:** everything an ERO has, plus ERO management and oversight of several offices.

How it works:
- Each higher role inherits everything below it, so no one loses access when they move up.
- It's built as hierarchical role-based access with menu- and feature-level permissions, not three flat roles. TaxSlayer ProWeb's roles are the model.
- The ERO decides what each preparer can reach.

## 3. Architectural rule: system vs. workflow

- **If the IRS or FTC requires it, the system says so, and it's on by default.** Guided, not caged: the warning reads "Required by IRS" (or FTC), never "recommended", and the office can still decide otherwise with a reason that is kept in the history. *(Updated with Piece 2, by owner decision.)*
- **If it's about how an office runs, the ERO configures it.**
- **Monarch's way ships as the default template:** a starting point, not a cage.

| Piece | Type | Notes |
|---|---|---|
| Fees & Statements | System (the math) + Hybrid (each bureau sets its fee schedule) | |
| Compliance Center | System | IRS/FTC requirements built in and flagged "Required by"; offices can override with a logged reason; office-specific items can be added |
| Return Pipeline | Workflow | Stages fully configurable per office |
| PTIN Management | System (data and IRS deadlines) + Workflow (reminder timing) | |
| Software Access Hub | System | **Owner decision (Q8):** links only, no stored credentials |
| Staff Messaging | Hybrid | Templates provided, fully editable |
| Firm Workflows | Workflow | This is the customization layer |
| Dashboard | Hybrid | Default widgets, which can be rearranged or hidden |

## 4. Build order and delivery

**Owner decision (Q14):** this spec PR comes first. Then there's one build PR per piece, in this order. Each build PR comes with its own tenant isolation gate.

| # | Build PR | Includes |
|---|---|---|
| 1 | **Fees & Statements** | Also: the basic **return record** (Q14), the office area, and invited ERO and preparer accounts with the role hierarchy |
| 2 | **Compliance Center** | WISP attestation on the shared WISP engine, 8879 retention, PTIN renewal reminders, incident response, document vault |
| 3 | **Return Pipeline** | Configurable stages, rejection queue, funding status, preparer assignment, bank enrollment status |
| 4 | **PTIN Management + CE** | Preparer list, PTIN status, WISP acknowledgments, CE hours, per-preparer permissions |
| 5 | **Software Access Hub** | Tenant software/bank settings, per-ERO toggles, MFA and IP allowlist on our app |
| 6 | **Staff Messaging** | Broadcast, individual and group messages, templates, read receipts, SMS hooks |
| 7 | **Firm Workflows** | Date, event and manual triggers, create-task action, per-office task lists, seed templates |
| 8 | **Dashboard** | Default widgets and customizable layout |

No piece starts until the previous one's gate passes.

---

## 5. The pieces

### Piece 1: Fees & Statements (highest priority)

**Type:** System (the math) + Hybrid (each bureau sets its fees).

**Fee schedule. Owner decision (Q2).**
- **Each tenant configures its own fee schedule. Nothing is hardcoded.**
- A schedule is a list of line items. Each has a label, an amount, and when it applies (every return, or bank-product returns only).
- **Monarch's schedule** is the default template. It is Monarch's own office pricing, not the system's.
  - Service bureau fee: $79
  - Transmission fee: $21
  - Technology fee: $24
  - E-file fee: $99
  - **Total: $223, charged on every return.** It does not include the bank fee.
- **Bank product fee:** a separate line, charged only on returns that go through a bank product.
- **ERO's own preparation fee:** set by each office.
- **Per-ERO overrides:** one ERO can have different fees from another within the same bureau. The bureau's schedule is the default, and an ERO's own schedule replaces it line by line.
- **Transparency means clear line items.** EROs see exactly what they're charged for each return. The original "base cost vs. bureau markup" display is **dropped (Q2)**: there's no margin disclosure.

**Return data. Owner decision (Q1).**
- Returns come in by **CSV import plus manual edits**. Live software and bank integrations come later.
- The owner will supply sample exports. Until then, the importer maps columns on screen and saves each mapping for reuse.
- This piece adds the **basic return record** (Q14), which the Return Pipeline builds on. It holds:
  - the office;
  - the taxpayer reference;
  - the tax year;
  - the preparer;
  - the bank product (yes/no and which bank);
  - the funded status and date;
  - the fee lines applied.

**Owed vs. collected. Owner decision (Q3).**
- A **CSV upload from the bank** shows what has been collected through bank products.
- For each return and each office, the statement shows what's owed, what's been collected, and the balance.

**Statements.**
- Monthly and season statements per office.
- Per return: funded or unfunded, and payout timing.
- Payout history, with dates and amounts.
- Exportable as **CSV and PDF**, self-serve for EROs, not run by the vendor.

**1099 rebates. Owner decision (Q4):** not built for Monarch, which pays no rebates. The fee schedule leaves room for a rebate line, so a future tenant that pays rebates can switch it on as its own setting. (See open question 2.)

**Tenant scoping:**
- Fee schedules, overrides, imports and statements are all per tenant.
- An ERO sees only their own office's statement, under their bureau's schedule.

### Piece 2: Compliance Center

**Type:** System. IRS and FTC requirements are built in and flagged "Required by IRS/FTC". It's a tool, not an enforcement system: the office can always go ahead against a rule with a logged reason. Office-specific items can be added.

**WISP. Owner decision (Q7).**
- **One shared WISP engine** is used by both the $25 WISP Generator and the Compliance Center builder. It's the plan writer already built (`lib/wisp/plan.ts`, `lib/wisp/pdf.ts`).
- **Firm-level WISP attestation**, one per firm rather than one per preparer, with a record of who attested and when.
- An annual review workflow with reminders.
- **Preparer acknowledgments:** each PTIN holder confirms they've read the office WISP, logged with a timestamp.
- PTIN holders linked to an ERO are covered by that ERO's WISP automatically. Independent PTIN holders can build their own WISP.

**Form 8879. Owner decision (Q12).**
- For each return, track the date the signed 8879 went on file and where it's kept.
- An optional PDF upload to the document vault.
- The **IRS 3-year retention** rule (from the later of the return due date and the IRS received date, Publication 1345) is worked out and warned about, with search and alerts as records near the end of retention. Deleting early shows "Required by IRS" and needs a logged reason; nothing is deleted automatically.

**PTIN compliance.**
- Renewal reminders during the window, **October 16 – December 31** each year.
- WISP attestation at PTIN renewal, as the IRS requires.

**Incident response.**
- A step-by-step data-breach and data-theft checklist that is recorded as it's worked through.
- IRS Stakeholder Liaison contact details.
- The FTC notification rule: 500 or more people affected, within 30 days.
- It follows the incident response section of the shared WISP.

**EFIN.**
- **EROs do not verify EFINs in Phase 3.** EFIN verification is part of the bureau's onboarding in Phase 2.
- EROs are reminded never to share their EFIN, as the IRS requires.

**Document vault.**
- Holds 8879s, WISP documents, training records and signed acknowledgments.
- Retention rules, with search and export.
- Uses the private, tenant-scoped document storage from Phase 2.

### Piece 3: Client & Return Pipeline

**Type:** Workflow. The stages are fully configurable per office.

**Default stages:** Intake → In Preparation → In Review → Ready to File → Transmitted → Accepted → Funded. The ERO can add, remove and rename stages, set up automatic moves between them, and choose the notifications for each stage.

**Features:**
- The office's client list (its taxpayers).
- Each return's status, tracked through the pipeline. It builds on the return record from Piece 1.
- **Rejection handling,** an IRS ERO duty under Publication 3112:
  - rejected returns go to a rejection queue with their reason codes;
  - resubmissions are tracked.
- Bank product and funding status for each return.
- A preparer assigned to each return.
- A log of client communication for each return.
- 8879 status on each return, from Piece 2.
- **Bank enrollment status. Owner decision (Q13):**
  - each office's status with each bank is Pending, Approved, Denied or Action Required;
  - the bureau or the ERO updates it by hand; an import comes later.

### Piece 4: PTIN / Preparer Management + CE tracking

**Type:** System (data and IRS deadlines) + Workflow (reminder timing).

**Features:**
- The list of PTIN holders under the ERO's EFIN.
- PTIN status: active, expiring or expired, with renewal tracking for October 16 – December 31.
- Adding and removing preparers, with the bureau's approval if the bureau turns that on.
- Assigning preparers to returns.
- **WISP acknowledgments,** logged with timestamps (see Piece 2).
- **Permissions:** the ERO sets what each preparer can reach, menu by menu and feature by feature.

**Continuing education. Owner decision (Q11).**
- **Preparers log their own hours**, with an optional certificate upload. **The ERO marks entries verified.**
- **IRS rules and deadlines are fixed by the system:**
  - **AFSP:** 18 hours (non-exempt) or 15 hours (exempt), due December 31.
  - **Enrolled Agents:** 72 hours every 3 years, at least 16 a year, including 2 hours of ethics.
  - **State programs:** CA CTEC, Oregon license, Maryland registration, New York NYTPRIN, Connecticut permit.
- Each preparer's hours completed, hours remaining and deadlines are shown.

### Piece 5: Software Access Hub

**Type:** System. **Owner decision (Q8):** links only.

- **No passwords or credentials are stored. Ever.** The original credential vault, single sign-on and per-EFIN credential scoping are **dropped**.
- **No hardcoded software or bank list.** There are many options beyond the ones Monarch uses.
- **Tenant settings page:**
  - the bureau adds each tax software and each bank as a free-form entry, with a label and a link;
  - entries can be edited, archived and reordered.
- **On each ERO's file:** toggle switches to choose which software and which bank or banks that ERO uses. The bureau sets up the entries in settings, then switches them on or off per ERO.
- **What the ERO sees:** their assigned software and bank links, plus announcements and update notices from the bureau.
- **Security applies to our app only, not to vendors' systems:**
  - **MFA is required** for every account in the office area, as the FTC Safeguards Rule requires for systems touching client data;
  - an **IP allowlist** can be set per office.
- **Audit:** changes to entries and assignments are logged, and so are opens of a software or bank link (who and when).

### Piece 6: Staff Messaging

**Type:** Hybrid. Templates are provided and fully editable.

**Owner decision (Q9):**
- messages are **in-app, with read receipts, plus an email notification**;
- the SMS structure and hooks are built now, but SMS sending waits until A2P 10DLC registration is done.

**Message types:**
- **Broadcast:** announcements to all staff (season updates, compliance reminders, fee changes).
- **Individual:** direct messages to specific preparers.
- **Group:** team channels, such as "all preparers" or "reviewers".

**Templates:** for common messages.

**Scope:** lightweight team communication for announcements, reminders and quick coordination. It isn't a Slack replacement.

**Planned extension: client notifications (Phase 3.x).** Check-ready texts, missing-document reminders and refund status updates for taxpayers. These need the A2P 10DLC work first, so they're not in the first build.

### Piece 7: Firm Workflows

**Type:** Workflow. This is the customization layer.

EROs build their own automations for their staff on the same workflow engine as Phase 2.

**Owner decision (Q10):**
- workflows have **date-based triggers**, a **"create task" action** and a **task list for each office**;
- each workflow runs for one office and sends from **that office's sending address**.

**Builder:**
- **Triggers:** date-based, event-based (for example, "when a PTIN expires in 30 days") and manual.
- **Actions:** send an email, send an SMS (hook only until SMS is enabled), create a task, update a record.
- **Conditions:** filter by preparer status, role, and so on.

**Seed templates.** The bureau provides these, and EROs copy and change them:
- **PTIN renewal campaign** (October 16 – December 31): reminders to every PTIN holder.
- **Pre-season readiness checklist:** WISP review → software check → bank enrollment → staff training.
- **Bank enrollment follow-ups:** reminders for pending bank applications.
- **New preparer onboarding:** welcome email → WISP acknowledgment → training links → first assignment.

**Tenant scoping:**
- Workflows and tasks belong to one office inside the tenant.
- Each bureau provides its own template library.

### Piece 8: ERO Dashboard

**Type:** Hybrid. It has sensible defaults and customizable widgets.

**Default widgets:**
- Returns by status: in progress, in review, transmitted, accepted, rejected, funded.
- Revenue: fees earned month to date and year to date, and pending payouts.
- The funding pipeline: returns waiting on funding.
- Check-ready and pickup alerts.
- Action items: rejections to fix, pending bank enrollments, expiring PTINs, incomplete returns.
- Quick links: the ERO's software and bank links (from Piece 5), and support.

**Customization:** the ERO can rearrange, hide and show widgets. The choices are saved for each ERO.

**Performance:** loads in under 2 seconds with 500 or more returns. Status changes, such as acceptance and funding, show up promptly where feasible.

---

## 6. Cross-cutting requirements

**Tenant isolation**
- Every Phase 3 table gets `tenant_id` and the standard tenant policies from day one (Q15):
  - `tenant_app` sees and writes only its own tenant's rows;
  - signed-in users see only the tenants they belong to;
  - foreign keys between tables also check the tenant: `(tenant_id, x) → (tenant_id, id)`.
- Inside a tenant, office-level rules keep each ERO to their own office.
- Each build PR adds its own isolation gate, extending the Phase 2 gate pattern.
- New tenants get the full Phase 3 area, with their own branding, fees and settings.

**Audit logging**
- Every significant action is logged: who, when, what and why.
- It follows the `archive_log` pattern: tenant-scoped and append-only.

**Mobile**
- Every Phase 3 screen works on a phone, because EROs work from their phones in tax season.
- Priority screens: the dashboard, return lookup and messaging.

**Archive**
- Phase 3 records use the platform's archive pattern: Current/Archived tabs, restore, and an owner-only permanent delete.

## 7. Out of scope for Phase 3

- Standalone operations for PTIN holders who aren't under an ERO (Phase 4).
- Calendar, website builder and advanced automations (Phase 5).
- The ERO onboarding flow (Phase 2).
- A client-facing taxpayer portal (a future phase).
- Reselling CPE/CE courses (a possible future revenue line).
- Live software and bank integrations (later; CSV import for now, Q1).

## 8. Phase 3 exit gate

- [ ] All 8 pieces built to this spec, tenant-aware from the first line.
- [ ] The role hierarchy (PTIN holder → ERO → Service Bureau) is in place, with inherited permissions.
- [ ] The system vs. workflow split is respected: IRS/FTC requirements built in and flagged "Required by" (overridable with a logged reason), office operations configurable.
- [ ] Every piece's tenant isolation gate passes, extending the Phase 2 pattern.
- [ ] The research additions are in, as decided:
  - clear fee line items (Q2);
  - CE tracking;
  - 8879 retention;
  - bank enrollment status;
  - incident response.
- [ ] Mobile layouts verified.
- [ ] No later phase starts until this gate passes (owner rule).

## 9. Decisions at sign-off (2026-10-13)

The owner approved this spec. These are the decisions on the five questions raised for sign-off:

1. **WISP sections:** the 12-section plan (IRS Publication 5708 and the FTC Safeguards Rule) is kept for both the $25 product and the Compliance Center, as the spec proposed.
2. **1099 rebates:** nothing is built for Monarch. The fee schedule's structure stays open, so a future tenant could add a rebate line.
3. **Returns without a bank product:** shown on the statement as **owed by the ERO**, and marked paid by hand.
4. **Bank product fee:** a separate line item, set per bank.
5. **The `(app)` workspace:** retired in PR 1 once the office area is live, as the spec proposed. Any records still in it are moved or archived after the owner confirms.
