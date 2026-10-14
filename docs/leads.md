# WISP lead capture and Leads

**Migration:** `supabase/migrations/20261021090000_leads.sql`.
**Gate:** `supabase/tests/leads_isolation.sql`.

## Part 1: contact details first (`/wisp`)

- **Unchanged:** the 12 questions, the optional ERO questions and the scoring.
- **Before the first question,** the audit asks for **Name**, **Email** and **Phone** (all required) and a **Start my free audit** button.
  - The phone must have 10 to 15 digits, written any common way ("(337) 555-0100", "+1 337 555 0100").
- **Submitting it creates the lead** (source WISP audit, status New, with the phone) before the questions start.
- **Full results, no gate.** When the audit is done, the full results show straight away, with the **Build My WISP — $25** button. The email they gave fills in the builder's delivery email (they can change it).
- **The score goes on the lead.** The audit is saved when it finishes, and its score is added to the lead who started it.
- **A problem on our side never locks anyone out.** If the lead can't be saved (for example, before the migration is applied), the audit still starts and the error is logged. A missing name, a bad email or phone, and too many attempts from one connection are shown on the form.

## Part 2: Leads (admin → My Office → Leads, `/leads`)

- **One person, one lead.** Within a tenant, an email can only be a lead once.
- **Fields:**
  - name and email (required);
  - phone, firm name and notes;
  - source: WISP audit, Facebook group, referral, website, manual or other;
  - status: New, Contacted, Interested, Converted or Lost;
  - the date the lead came in, and the date last contacted.
- **List:**
  - search by name, email or firm;
  - filter by source, status, and a from/to date (the day the lead came in, Eastern time);
  - a count of each status.
- **Add lead:** a manual form. An email that's already a lead is refused, with the existing lead's name.
- **Import CSV:**
  - Columns are matched by their header. Name and Email are required; Phone, Firm, Source, Status, Notes and Last contacted are optional. Other columns are ignored.
  - Rows without a known source get the source chosen for the import.
  - Emails that are already leads, or that repeat in the file, are skipped and listed by row. Nothing is ever overwritten.
  - Up to 2,000 rows (2 MB) at a time.
  - Works with commas or semicolons, and with files saved from Excel or Google Sheets.
- **Export CSV:** the leads matching the current search and filters, in the same columns the import reads, plus the audit score and dates. Cells that start like a spreadsheet formula are made safe.
- **Each lead's page:**
  - edit every field;
  - **Contacted today**: records today's date, and moves a New lead to Contacted;
  - an Email link;
  - the journey: Lead → Customer → Firm;
  - the history;
  - delete, for spam or test entries.

## The WISP audit feeds Leads

- **New visitor.** The first step creates a lead with source **WISP audit**, status New and their phone. Finishing the audit adds the audit and its score; the history shows "Started the free WISP audit", then "Finished the WISP audit (score …)".
- **Existing lead (same email).** The lead gets the newer audit and score. Its source, status and phone don't change (a missing phone is filled in, and a different one is noted in the history).
- **Purchase.** When the $25 WISP is paid (the signature-verified Stripe webhook, or the confirmation page asking Stripe directly):
  - Monarch finds the lead who took that plan's audit, or failing that, the lead with the buyer's email.
  - It links the customer, order and WISP plan, and marks the lead **Converted**.
  - A retry from Stripe doesn't repeat any of this.
  - If linking ever fails, the WISP is still made and delivered.
- **Buyers who were never leads** (they went straight to the builder) aren't added; they're on Customers as before.

## Lead → Customer → Firm

- **Customer:** linked automatically on purchase. The lead's page links to the customer and the order.
- **Firm:** for EROs, link the lead to their firm in My Service Bureau from the lead's page. This uses the same `organizations` record the ERO office area uses.
- **Future funnels:** each one adds its leads here with its own source.

## Security and records

- **Two new tables, `leads` and `lead_events`.** Both have:
  - `tenant_id` from day one, with the required default;
  - the standard two policies;
  - same-tenant foreign keys, so a lead can only point at its own tenant's audit, plan, customer, order and firm.
- **The history (`lead_events`) can only grow.** It goes only when its lead is deleted.
- **No new platform lookups.** The public WISP page already knows its tenant from its web address, and the webhook acts for Monarch.
- **Isolation gate (`leads_isolation.sql`): 13 checks.**
  - 13/13 against a local Postgres 16 running this migration with the real tenant functions.
  - On the test project: the 10 checks that only add rows were run and passed 10/10. The 3 that change or delete rows need a paste in the SQL editor, because the Supabase tool won't run those.

## Setup (owner)

1. **Test project:** I applied the migration. To run the 3 remaining checks, paste `ops/prod-migrations/leads-gate.txt` into the SQL editor.
2. **On the Preview:**
   - Take the audit at `/wisp`, enter a name and email at the results, and check the lead in **Leads**.
   - Add a lead by hand, then import a small CSV and export it.
3. **Production:** the migration needs your approval. Until it's applied there, the audit's results still open; leads just aren't saved.
