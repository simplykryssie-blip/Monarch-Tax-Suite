# EFIN Management (Phase 1 foundation)

Service-bureau CRM module under **My Office → EFIN Management** (`/efin`). The public storefront and VerexaHQ are untouched.

## What is built
| Area | Where |
|---|---|
| Schema, RLS, audit immutability | `supabase/migrations/20261011100000_efin_management.sql` (13 tables, additive) |
| Business rules (pure, tested) | `lib/efin/rules.ts`, `lib/efin/exceptions.ts`, `tests/efin-rules.test.ts` |
| Data access, encryption, audit | `lib/efin/service.ts` |
| Daily renewal sweep | `lib/efin/renewals.ts`, run from `/api/automation/run` (same `CRON_SECRET` scheduler) |
| UI | `app/(admin)/efin/*`: **Dashboard** (KPIs, status donut, overview, upcoming renewals, activity, filing software, quick actions), **EROs & EFINs** (contacts-style list), **Add an ERO** (one form), ERO/EFIN profile (Overview, Office & Team, Office Assignments, Filing Relationships, Documents, Renewals, Activity History), Renewals & compliance, History |

## Dashboard and multiple locations
`/efin` is the dashboard. Every figure is derived from recorded, verified data (`lib/efin/metrics.ts`, tested). There are deliberately no return counts, filing totals or growth percentages, because Monarch has no verified source for them. An ERO can have any number of locations: add up to five extra on the Add-an-ERO form, or add more later from the ERO's Office & Team tab; each EFIN has a "filing office" you can change, and assignments can be pinned to a location.

## One place for everything
EFIN Management works like a contacts list of your EROs. **Add an ERO** is a single form (business, office, ERO/Responsible Official with optional PTIN, EFIN, expiration) saved by one database function (`efin_onboard`) in one transaction, so a failure such as a duplicate EFIN saves nothing. It also creates a draft ERO assignment. Everything afterwards happens on the ERO's page: add team members and PTINs (`efin_add_member`, also atomic), add offices, request/approve/suspend/revoke assignments, add filing providers. Renewals and History stay separate. Separate Offices, People and Assignments pages no longer exist; "Assignments to review" opens the list filtered to pending reviews.

## Model
EFIN, organization, person and credential (PTIN) are separate records joined by relationships. Three things are kept apart and labelled as such:
1. the **EFIN record** (what is on file, with `external_status`: unverified / manually verified / verified plus a named source),
2. the **internal assignment** (Draft → Pending review → Approved → Active → Suspended / Revoked / Expired),
3. the **external filing authorization** (`filing_relationships`, shown exactly as verified; Monarch does not sync with any provider).

A PTIN never authorizes e-file by itself. A tax-preparer assignment only requires that a PTIN is *recorded*. Monarch never claims IRS approval, accepted returns, or return counts.

## Assignment rules (`lib/efin/rules.ts`)
- Revoked and expired are terminal; revoked can never be reactivated (a new request starts a new record).
- Activate / suspend / revoke / reinstate need a confirmation; suspend / revoke / reinstate / return need a reason (5+ characters).
- Approving your own request needs a recorded reason; it is flagged `self_approval` in the audit log.
- To submit, approve or activate: the EFIN is not archived, suspended or inactive; the person holds that role at the organization; preparers need a PTIN on file.
- Transitions are compare-and-set on the previous state, so concurrent administrators cannot both win.
- Every change records actor, time, previous and new state, reason, organization and EFIN ids.

## Security
- RLS on every table. Browser roles (`authenticated`) are **read-only** and scoped by `organization_memberships` (partner A cannot read partner B through the API); `anon` has nothing. There is no write policy for browser roles at all: writes go through server actions after `requireAdmin()` using the service role.
- EFIN, EIN and PTIN are AES-256-GCM encrypted (`MONARCH_ENCRYPTION_KEY`, AAD names row and field), with a last-4 for display and a keyed HMAC for duplicate detection. Column-level grants hide the encrypted and hash columns from browser roles.
- Revealing a full EFIN is a server call that writes an `efin.revealed` audit event first; if the audit write fails nothing is shown. Identifiers are never written to the audit log.
- `audit_events` is append-only: triggers reject UPDATE/DELETE/TRUNCATE for every role and `service_role` has no update/delete grant.

The onboarding functions are executable by `service_role` only. Verified on a throwaway Supabase project (not production): partner A saw only its own EFIN and organization, could not read `efin_encrypted` or `efin_hash`, and could not insert or update; a bureau admin saw all rows; audit update/delete/truncate were rejected for the owner role and the service role; a duplicate EFIN was rejected; the one-step onboarding saved all rows plus audit events, and a duplicate EFIN rolled the whole attempt back (no partial organization or person left behind).

## Renewals
- Reminders at 60 / 30 / 14 / 7 days before a **verified** recorded date. After downtime only the most recent reached stage is sent. One email per task + deadline + stage + recipient (`notification_events` unique key, recorded before sending, 4 attempts max, safe to rerun).
- Dashboard tasks exist whether or not email works. A changed date updates the task and keeps `original_due_on`. Missing or unverified dates and suspended or archived EFINs create compliance exceptions instead of reminders.
- Passing the date moves an active EFIN to **renewal review** and escalates; nothing is invalidated automatically.

## Not in this release
- Document upload (needs a private storage bucket); the Documents tab says so.
- A partner-facing portal and role-based screens for non-administrators. The RLS foundation is in place and tested, the screens are not built. Today only Monarch administrators can open these pages.
- Reports beyond the registry KPIs and exception list (no exports yet).
- Live IRS or software-provider sync: deliberately absent.
- Email delivery has not been exercised against real Resend from here; the send path reuses the Automation Center sender.

## Rollout
1. Review the migration. Apply to production **only on explicit approval** (`supabase db push` or the SQL editor). It is additive; it has not been run against production.
2. `MONARCH_ENCRYPTION_KEY` must be set (it already is for the CRM).
3. The scheduler (`/api/automation/run` with `CRON_SECRET`) must run daily for reminders.
4. Add the first organization, then a person with the ERO role, then the EFIN.

## Phase 1 acceptance checklist
1. EFIN registry with masked values: done. 2. Offices and locations: done. 3. People and credentials, PTIN separate: done.
4. Assignment workflow with audit: done. 5. Filing relationships labelled verified/unverified: done.
6. Cross-organization isolation via RLS: done and tested at the database; no partner UI yet.
7. Renewal reminders, idempotent: done (pure logic tested; real email not exercised).
8. Immutable audit: done and tested. 9. Owner reports: partial (KPIs and exceptions). 10. Production rollout: pending approval.
