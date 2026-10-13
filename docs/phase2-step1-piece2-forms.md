# Phase 2, Step 1, Piece 2: Form Builder (built)

Approved spec: PR #32, with the owner's final decisions. Migration: `supabase/migrations/20261016090000_forms.sql`. It's applied to the test project; production needs your approval.

## Your decisions, as built

1. **PDFs are filed on the customer.** The customer's page has a **Form submissions** list, each with its PDF. There's no separate tab in Documents. Each form's Submissions tab also lists them.
2. **Uploaded files are inside the PDF.** Images are placed on their own pages and uploaded PDFs are appended, so each submission is one complete document. Each file's name, size and SHA-256 are listed too.
3. **Customer and firm.**
   - **Customer:** the submission links to the customer with the respondent's email, which is normally the customer from the package purchase. It creates the customer when there isn't one; that's on by default and can be turned off per form.
   - **Firm:** when the form's firm mapping is on, the submission links to the firm already linked to that customer, or to the firm with the same EFIN. Otherwise it creates the firm in My Service Bureau.
     - A new firm gets the organization (linked to the customer), its main office, the mapped people with their roles and PTINs, and the EFIN, marked unconfirmed, with a draft ERO assignment.
     - EFINs, EINs and PTINs are encrypted exactly as My Service Bureau stores them.
     - A failure is shown on the submission, with a "Create or link the firm now" button. It never affects the submission itself.
   - **For workflows:** the `form.submitted` event carries the customer and their latest paid order. Send-document steps therefore have a recipient, and `product.<attribute>` conditions work, so you can route by package.
4. **Confirmation email:** on by default. It says only "we received your submission", with no answers or files.
5. **CSV export:** sensitive answers stay masked, file uploads are left out, cells that would run as spreadsheet formulas are neutralized, and each export is logged.
6. **No deleting submissions.** The database refuses it, and answers can't be changed after submission. Only spam can be emptied.
7. **Save and continue later** is built in. The respondent gets an emailed link that works for 30 days. Answers and uploads are kept, with sensitive answers encrypted; they sign when they finish.
8. **Consent wording:** each form has its own consent statement, written by you. A form with a signature question can't be published without one.

## What a bureau can do

- **Operations → Forms:** create, duplicate, close, reopen, archive, or delete a form that has never been submitted.
- **Build tab:**
  - Drag question types onto a section, or drag questions to reorder them or move them between sections. Every question, section and page also has Move buttons, for touchscreens and keyboards.
  - Pages and sections; required or optional; half or full width.
  - 12 question types plus heading and paragraph blocks.
  - Short answers can be checked as EFIN, EIN or PTIN; those are always encrypted and shown masked.
  - Show/hide rules for questions and sections, and skip rules between pages.
  - The draft autosaves, and the toolbar says what to fix before publishing.
  - Publishing creates a new version, and earlier submissions keep the version they were made on.
  - **Preview** at computer or phone width. **Test the published form** creates TEST submissions: no notices, records or workflows.
- **Settings tab:**
  - Name, description and consent statement.
  - The respondent's email and name questions, and the customer option.
  - The firm mapping: legal name, DBA, address, EFIN, EIN, and up to 6 people with role, name, email, phone and PTIN.
  - Up to 5 notification addresses and the sending address.
  - The confirmation email, confirmation and closed messages, a close date, a submission limit, and save-for-later.
- **Public link `/f/{id}`:**
  - No login, mobile-friendly, with a progress bar.
  - Files go straight to private storage and are checked by content on submit: PDF, JPG or PNG, up to 10 MB, scripts and encryption refused.
  - Typed or drawn signature.
  - The confirmation screen has a **Download PDF** button that works for an hour, in the submitting browser only.
- **Spam protection:** a hidden field, a 3-second minimum fill time, and limits per connection and per form. Spam is kept, marked, and notifies nobody.
- **Submissions tab:**
  - Search and status filter, CSV export, and "empty spam".
  - The submission page shows answers by section. Masked answers have a **Show** button, and each reveal is logged. Files open through 60-second links.
  - Also on the page: the signature and consent, the PDF with its fingerprint, links to the customer and firm, the status, and a full history, including who viewed it.
- **Workflows:**
  - The event **Form submitted**.
  - Conditions: `form_id`, plus `answer.<key>` for dropdown and radio questions.
  - Documents can use `{{form.<key>}}` merge fields. The workflow is checked on save, so it must be limited to a form that has those questions.
- **Notification email** to the firm: the form, number, time and respondent, with a link to the submission. No answers or files.

## Fixed after the owner's Preview test

- **Public link on Preview.** Links pointed at the production domain on every Preview. App links (form links, email links, setup links) now use the Preview deployment's own address on Preview, and the production domain in production (`lib/origin.ts`).
- **Customer not created.** That form never had a respondent email question chosen, so the submission had no email to link on. When none is chosen, the form's first email question is now used automatically (and the first name question for the name). The settings page says so. Submissions made before this fix have a **Link the customer now** button on their page.
- **Empty optional questions.** Questions the respondent saw but left empty now show as "(no answer)" in the admin and the PDF. Hidden and skipped questions are still left out.

## How it works for tenants

- **Database.** 5 new tables, all with `tenant_id`, the Step 0 policies, and 11 new same-tenant foreign keys. That includes `organizations.customer_id`, so a firm can only link to a customer of its own tenant. The firm and numbering functions run as the caller (`tenant_app`), so they only ever touch the caller's own tenant.
- **Files.** Uploads go in the private `tenant-form-uploads` bucket, and PDFs in `tenant-documents/{tenant}/submissions/`. The server builds every path, and refuses links outside the requesting tenant's folder.
- **Public links.** Finding which tenant owns a form's public id is the one new platform lookup (`form_link`), and it's logged. The tenant-foundation test now lists it.

## Test evidence

`npm test`: 454 passing (49 new, mostly in `tests/forms-builder.test.ts` and `tests/forms-service.test.ts`). `tsc`, `lint` and `build` are clean. The browser was checked locally at computer and phone widths, with no console errors: logic, skips, format errors, the drawn signature, and builder drag, add, edit and move.

| # | Case | Result |
|---|---|---|
| 1 | Definitions: duplicate keys, rules on later questions, backward skips, deleted targets, bad options, two signatures | Refused with the reason and where it is |
| 2 | Logic: an ERO sees the EFIN question; a PTIN holder skips the office page; hidden questions count as unanswered | Pass |
| 3 | Answers: every type checked on the server; hidden and skipped answers dropped even when sent; required only when visible | Pass |
| 4 | Uploads: renamed EXE, an 11 MB file, a wrong question, and too many files are refused; a rejected file is deleted | Pass |
| 5 | Signature needs consent; EFIN/PTIN encrypted (never stored readable); answers locked; number assigned | Pass |
| 6 | Spam (hidden field, too fast) kept and marked, no emails or events; spam can be emptied | Pass |
| 7 | Save for later, then resume, then submit the same submission; a used link is dead; abandoned drafts are swept with their files | Pass |
| 8 | PDF: answers, an image page, the appended PDF, signature, timestamps and fingerprint; Vietnamese name prints | Pass |
| 9 | Receipt download: valid token works; wrong token or after an hour refused | Pass |
| 10 | After submit: linked to the purchase customer; firm created (encrypted as My Service Bureau reads it); notice has no answers; confirmation sent; `form.submitted` once, with the order | Pass |
| 11 | Second submission with the same EFIN links to the same firm; a duplicate PTIN fails only the firm step | Pass |
| 12 | Workflow routes on `answer.filer_type` and fills `{{form.business_name}}`; non-matching answer doesn't run | Pass |
| 13 | CSV masked, no file columns, formulas neutralized, export logged; submissions can't be deleted; links outside the tenant refused | Pass |
| 14 | Database gate on the test project (`supabase/tests/forms_isolation.sql`), insert-only part: 5 tables isolated; insert into B refused; default tenant; can't number B's form; can't link a firm to B's customer; firm created in A; A submission on B's form refused | **11/11 pass** |
| 15 | `firm_from_submission` on the real schema: firm, office, ERO + responsible official + preparer, PTIN, EFIN unconfirmed, draft assignment, audit events | Pass (rolled back) |

**Still to run:** the 6 checks in `forms_isolation.sql` that use update or delete statements. These are locked submissions, kept submissions, emptying spam, frozen versions, updates across tenants, and linking a firm to another tenant's customer. My database connection can't run update or delete statements, so please run the whole file in the test project's SQL editor. It rolls itself back. All 17 checks should pass.

## Rollout

1. Test project: migration applied; insert-only gate 11/11 passed.
2. Luna runs the full `forms_isolation.sql` on test (17 checks).
3. **Production migration: needs your approval.** It's additive.
4. Merge and deploy. Then build the ERO application form in **Operations → Forms**, write its consent statement, map the respondent, customer and firm fields, and publish.

Out of scope, as specified: the ERO onboarding workflow itself (Krystal builds it with these pieces).
