# Phase 3, Piece 2: Compliance Center (built)

**Migration:** `supabase/migrations/20261022090000_compliance.sql`.
**Gate:** `supabase/tests/compliance_isolation.sql`.
**Where:** the office area, at **Compliance** (`/office/compliance`). Bureau status is at **My Service Bureau → Compliance** (`/compliance`).

## Philosophy: a tool, not an enforcement system

- **IRS and FTC rules are built in.** The page says **"Required by IRS"** or **"Required by FTC"** (never "recommended").
- **The office can still go ahead.** Doing so asks for a reason, and the reason is kept in the history.
- **Nothing locks, and nothing is deleted automatically.**
- **The office sets its own timing:**
  - its review schedule;
  - its reminder days;
  - its retention alert window;
  - how often PTIN reminders are sent.
- **Spec update.** The Phase 3 spec's "IRS requirements locked" lines now say this.

## What's built

### WISP attestation
- **Build or upload.** The office builds its WISP with the shared engine (`lib/wisp/plan.ts`, `lib/wisp/pdf.ts`), the same plan writer as the $25 product, or uploads the one it has. Either way the PDF goes into the vault.
- **Answers saved for next year.** The builder's answers are kept encrypted, so next year's review starts from them.
- **One attestation per firm.**
  - The ERO picks the WISP, ticks the statement and types their full name.
  - Monarch records who and when, and sets the next review: 12 months by default, or the office's own schedule.
  - The bureau can't attest for an office.
- **Review reminders.** By default they come 30 and 7 days before the review, on the office dashboard and by email to the office's EROs. After the due date the status shows **Overdue**, and nothing locks.
- **Preparer acknowledgments.**
  - Each PTIN holder reads the WISP and confirms, with a timestamp.
  - A new attestation asks everyone again.
  - Attestations and acknowledgments can't be changed. Removing a WISP file from the vault only unlinks it; the attestation is kept.

### Form 8879
- **What's recorded for each return:**
  - the tax year, the return reference and the taxpayer name;
  - the date the signed 8879 went on file;
  - where it's kept: Document vault, Tax software, Paper file or Other, plus a short note;
  - the return due date (with extensions) and the IRS accepted/received date.
- **The PDF can be attached.** It's optional, and can be uploaded right there.
- **Retention date.** It's worked out by the database: 3 years from the later of the two dates (Publication 1345). A typed-in date is ignored, and the attached vault file gets the same date.
- **Search and filters:**
  - search by return reference or taxpayer;
  - filter by tax year;
  - views: All, In retention, Ending soon (90 days by default, adjustable) and Past retention;
  - CSV export.
- **Deleting before the retention end:**
  - shows *"Required by IRS: this record must be kept for 3 years from [date]. Deleting it early is your decision."*, where [date] is the later of the due date and the IRS received date;
  - needs a reason, and logs who, when and why.
- **The vault PDF is kept.** Deleting the tracking record doesn't delete it; that's a separate action, and it gets the same warning and logged reason.
- **Past retention:** the record is flagged for disposal and never deleted automatically.

### PTIN compliance
- **For each team member and year:** renewed yes/no, plus the date. Every PTIN expires December 31, so there's no separate expiry date.
- **Who records it:** a preparer records their own; the ERO can record for anyone.
- **Season reminders.** From October 16 to December 31, team members who haven't recorded a renewal are emailed, every 14 days by default (adjustable).
- **WISP prompt at renewal.** When recording a renewal, the page reminds them that the IRS renewal asks them to confirm a WISP, and links to acknowledging the office's WISP.
- **Later, in Piece 4:** full PTIN management.

### Incident response
- **Anyone on the team can report an incident:**
  - what happened;
  - when it was discovered;
  - the number of people affected;
  - whether the information was encrypted.
- **No client data.** Counts and dates only: never client names or SSNs.
- **The checklist** follows the incident response section of the shared WISP:
  - report, contain and assess;
  - IRS Stakeholder Liaison (*Required by IRS*);
  - IRS e-Help;
  - state tax agencies;
  - the FTC (shown when it applies);
  - state breach laws, police or IC3, and clients;
  - recover and review.
- **Each step** records Done or Not needed, who, when, and a note.
- **FTC notice:** *"Required by FTC: if unencrypted information of 500 or more people is involved, notify the FTC within 30 days of discovering it."*
  - It appears as soon as the "people affected" count reaches 500: while it is typed on the report form, and highlighted on the incident page.
  - The incident page shows whether the rule applies (an "unknown" encryption answer counts as unencrypted until confirmed), the deadline, and the days left.
  - Past the deadline, it shows on the dashboard.
- **IRS Stakeholder Liaison contacts:** a link to the IRS state-by-state list, and each office saves its own liaison's contact in Settings.
- **Closing the incident.** If steps are still open, or the FTC notice applies but isn't recorded, closing needs a reason, and the reason is kept.

### EFIN
- A reminder on the Compliance overview never to share the EFIN. No verification here.

### Document vault
- **What it holds:** 8879s, WISPs, training records, signed acknowledgments and other files.
- **File types:** PDF or Word, up to 25 MB, checked by content, as in the Phase 2 documents.
- **Storage:** the private `tenant-documents` storage under `{tenant}/compliance/{office}/`, opened only through one-minute links. Every download is logged.
- **Search and filter** by kind, and export the index as CSV.

### Office checklist
- **Items the office adds itself:** a title, a description, an optional due date, and one-time or yearly.
- **Done or not done,** with who and when. A yearly item moves its due date on a year when it's done.

### Reminders
- **In-app:** on the office dashboard, worst first, each linking to the right page.
- **By email,** through the Automation Center's sending address:
  - WISP review emails go to the office's EROs.
  - PTIN renewal emails go to each member who hasn't recorded a renewal.
  - The 8879 retention and checklist reminders are in-app only.
- **How sending works:**
  - The emails come from the existing scheduler (`/api/automation/run`).
  - Each one is recorded before it's sent, so it never goes twice.
  - Failures are retried, up to 4 attempts.
  - On Preview, only test recipients get email; the rest is recorded as held back.

### Permissions and bureau visibility
These are new features in the office permission catalog:

| Feature | Default | What it covers |
|---|---|---|
| **Compliance** | Every preparer | The overview, reading and acknowledging the WISP, recording their own PTIN, reporting an incident |
| **Compliance management** | ERO | Attest the WISP, the checklist, settings, PTIN records for the team |
| **Incident response** | ERO | Work and close incidents |
| **Form 8879 records** | ERO | The 8879 records |
| **Document vault** | ERO | The vault |

- **The ERO decides for each preparer** on the Team page, as for other features.
- **The bureau sees status only** on My Service Bureau → Compliance. For each office: attested or overdue, acknowledgments, PTIN renewals, open incidents, the 8879 retention counts, and the checklist.
- **The bureau never sees an office's files.** When it opens an office, the vault and the 8879 records are hidden, and vault files can't be opened.

## Security and records
- **Ten new tables.** Each has:
  - `tenant_id` from day one;
  - the standard two policies;
  - same-tenant foreign keys for all 16 references.
- **The tables:** `compliance_settings`, `vault_documents`, `compliance_attestations`, `compliance_acks`, `form_8879_records`, `ptin_renewals`, `compliance_incidents`, `compliance_items`, `compliance_events` and `compliance_notices`.
- **The vault is called `vault_documents`** because `compliance_documents` already exists for EFIN documents.
- **Kept for good:** the history (`compliance_events`), attestations and acknowledgments can't be changed or deleted.
- **One office at a time.** Every page and action checks the office and the permission again; the tenant client keeps everything inside the tenant.
- **Isolation gate (`compliance_isolation.sql`): 23 checks.**
  - 23/23 on a local Postgres 16 running this migration on top of the real Fees and office migrations.
  - On the test project: the 18 checks that only add rows passed 18/18. The 5 that change or delete rows need a paste in the SQL editor.

## Setup (owner)
1. **Test project:** I applied the migration. To run the 5 remaining gate checks, paste `ops/prod-migrations/compliance-gate.txt` into the SQL editor.
2. **On the Preview:**
   - sign in to the office area as your test ERO;
   - open **Compliance**;
   - build a WISP and attest;
   - sign in as the test preparer and acknowledge;
   - add an 8879 record, then try deleting it to see the warning;
   - report an incident with 600 people affected to see the FTC rule.
3. **Production:** the migration needs your approval.
