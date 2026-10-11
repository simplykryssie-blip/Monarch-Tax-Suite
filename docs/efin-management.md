# My Service Bureau (EFIN management)

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

## Status of the databases
- **Production (Monarch Tax Calculator) also has `20261012110000_efin_firm_options_documents.sql` applied** (third confirmation state, tax software / bank lists, private `firm-documents` bucket, latest save functions), verified with a rolled-back test. The original description follows:
- **Production (Monarch Tax Calculator):** the EFIN schema, row-level security, audit protection and the one-step save functions (`efin_onboard`, `efin_add_member`) were applied and verified (13 tables, RLS on all, read policies only, secret columns hidden from browser roles, audit append-only, partner isolation and duplicate-EFIN tests passed and rolled back; no rows were left). **Optional:** `20261012100000_efin_delete_functions.sql`. Permanent delete now works without it (the app deletes in a safe order itself); installing it makes deletion all-or-nothing in one database transaction.
- **Throwaway test project:** has the schema, the latest save functions and the `client` relationship value, but not the optional delete functions.

## Updating a database that ran an earlier version
If a database already ran an earlier `20261011100000_efin_management.sql` (for example a test or preview project), run `supabase/migrations/20261012090000_efin_management_update.sql` on it. It is safe to run repeatedly. It adds the `client` relationship value and replaces the save functions. Permanent-delete functions are in `20261012100000_efin_delete_functions.sql`. The app now says exactly which file to run when the database is behind (a missing value or function), instead of the misleading "tables not installed" message.

## My Workspace (`/workspace`)
Under My Office, "Firms" is now **My Workspace**: your own EFIN (firms marked "My own tax office"), the **Partner EROs** attached to it (an assignment to one of your EFINs marks a partner "attached"), and every **PTIN** working under your office and partners. **Add PTIN** is on that page: choose the firm, then either an existing person without a PTIN or a new person (saved together with their role and PTIN in one step). PTINs are encrypted, shown masked, linked to the person, never authorize e-file, and can be removed (kept in the history). Software/service clients are never listed and cannot receive PTINs. PTIN renewal dates show how many days remain; there are no emailed PTIN reminders yet.

## Layout (latest)
- **Menu:** "My Service Bureau" opens the dashboard (no separate Dashboard item or in-page tab bar); under it are EROs & EFINs and Renewals. **History** (the activity log) lives under Settings (`/bureau/settings/history`); the old `/efin/history` address redirects there.
- **Firm page tabs:** Overview, Team (own office and partners only), EFIN & Filing, Activity. Renewals are part of EFIN & Filing.
- **Overview:** Firm details, then Locations and Documents as their own cards, then Team. Principal(s) show only once someone is added (Edit firm > Responsible Official & Principals). Recent activity appears only on the Activity tab.
- **EFIN & Filing** shows what was entered in onboarding: EFIN status and confirmation, tax year, next review date, filing office, and the tax software chosen (saved as filing records with the EFIN's tax year, status unconfirmed). Choosing software later on the Edit page fills in any missing filing records too.

## Pop-ups (keeping your place)
Pages you open from a button on a firm or the onboarding (Settings, Locations, Documents, Edit firm, Software & banking) open in a pop-up over the current page. Closing it returns you exactly where you were, with anything half-typed intact, and refreshes the page behind it so new items appear. Cmd/Ctrl-click opens a normal tab. If a pop-up lands on the firm list (for example after a delete), it closes and the page follows. The pop-up is an iframe of the same site: `/efin/*` and `/bureau/*` send `X-Frame-Options: SAMEORIGIN` and `frame-ancestors 'self'`, so only this site can frame them. Confirmations (delete, archive) use an in-page dialog instead of the browser's blocking prompt.

## Latest changes (confirmation wording, responsible party, settings lists, documents)
- **Renamed** "EFIN Management" to **My Service Bureau** (URLs still start with `/efin`).
- **Confirmation wording:** Unconfirmed / Pending confirmation / Confirmed (older "manually verified" rows show as Confirmed). Nothing is described as an IRS result.
- **Responsible party:** in Add a firm, a box says the ERO is also the EFIN's responsible party. Untick it to enter the responsible party's own name, email and phone; it is saved as a Responsible Official.
- **Dates:** an EFIN has no fixed expiration like a PTIN, so the field is now "Next review date" (when you want to re-check the firm's e-file application, or a date the IRS gave you). PTINs keep a renewal date. Software has its own renewal date on the filing record. Confirm any IRS-specific timing with IRS e-Services.
- **Settings** (`/bureau/settings`, Operations > Settings): your lists of tax software and bank products. The onboarding step "Software" and the firm's Edit page use them.
- **Documents:** upload and download live under Firm details (View / + Upload), not a tab. Private storage bucket `firm-documents`, 4 MB limit, PDF/PNG/JPG/DOCX checked by content, signed 60-second links, every upload/download/delete audited.
- **Review step** lists everything entered, with an Edit link per section.
- **Database:** `20261012110000_efin_firm_options_documents.sql` adds the third confirmation state, the lists, the bucket and the new save function. The app still works without it (new features show empty or ask for it); apply it to use them.

## Formatting, locations and onboarding
- **One format everywhere** (`lib/efin/format.ts`): phone `(337) 858-7792`, EIN `12-3456789`, EFIN six digits, PTIN `P01234567`, state `LA`, ZIP `70607` or `70607-1234`, street and city in proper case with standard abbreviations (`3418 Greinwich Blvd`). Boxes format as you type; the server applies the same rules on save (and rejects a bad phone, state or ZIP with the field marked); display code formats older values too.
- **Locations** have their own page (`/efin/locations/<ERO>`), opened from the Locations row on the firm's Overview ("View" and "+ Add"). There is no Locations tab. Software/service clients have no Team tab either.
- **Add a firm** is a five-step onboarding (Firm, Locations, Contact, EFIN, Review). Choosing "Software / service client" skips the PTIN and team questions. Saving is still all-or-nothing, and a server error jumps back to the step that holds the problem field without clearing anything.
- **Less clutter:** the firm's Overview is one details card, the team, and recent activity. Everything that changes a firm (edit business and contact, update or add an EFIN, archive or delete) is on a separate Edit page (`/efin/<id>/edit`).

## Firm page
Each ERO has a firm page laid out as: breadcrumb (EFIN Management › Firms › name), header with contact lines and "Edit firm" / more menu, an EFIN-at-a-glance card beside a "Next steps" checklist (computed only from recorded data, `lib/efin/steps.ts`), tabs (Overview, Team, EFIN & Filing, Documents, Renewals, Activity), and overview cards: Firm overview, EFIN & ERO information, Team (or Locations for software clients), Recent activity, and shortcuts for Documents, Renewals and Filing relationships. Edit tools sit under "Manage this firm" and open from the Edit links. Responsible Official and Principal are shown only when someone is recorded in those roles; an ERO is never assumed to be both.

## Layout
ERO pages read like a contact card: a header with the business, contact, address, locations and the EFIN at a glance, then flowing sections separated by hairlines. Edit tools sit in collapsible sections ("Add another EFIN", "Update this EFIN", "Edit ERO", "Locations", "Archive or delete") instead of stacked boxes. "Add another EFIN" lives on the ERO's own page, not on the main list. ERO, EFIN and PTIN are always capitalized in display text (`lib/efin/text.ts`).

## Editing, deleting, bulk actions, and who gets a team
- **Relationship decides what is tracked.** `internal` = your own tax office and `partner` = businesses whose preparers you may manage: both keep a team, PTINs and ERO assignments. `client` = a business that only bought software or services from you: no team, PTINs or assignments are kept, the Team and Assignments tabs are hidden, the server refuses to add them, and a hidden PTIN box is ignored. A relationship change needs a reason and is audited; it never changes who can see anything.
- **Forms keep what you typed.** A rejected save (for example a mistyped EIN) shows the message, marks the field, and leaves everything else untouched. This holds for every EFIN form.
- **Edit:** business, EIN (replace), ERO contact, locations (rename, primary, remove), EFIN details, and a mistyped EFIN number can be corrected (last four digits only appear in the history).
- **Archive / restore / delete.** Archive is reversible and keeps history. Permanent delete is all-or-nothing and is refused for any EFIN that was ever used in a live assignment (archive it instead). A deletion leaves an audit event with no identifiers.
- **Bulk actions** on the list: archive, restore, set status, delete, and export CSV (EFINs masked). Each row is handled and audited on its own; skipped rows are reported with the reason. Reason and confirmation are required and enforced on the server.

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
