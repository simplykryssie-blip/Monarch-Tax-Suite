# Phase 2, Step 1, Piece 2: Form Builder (spec for review)

Status: **draft for owner review. Nothing is built.** Piece 1 (Documents) is merged, migrated on production and gated (13/13).

## Goal

Each bureau (tenant) builds its own forms by drag and drop, publishes them at a public link that needs no login, and collects answers, files and signatures. Every submission is:

- timestamped and saved;
- turned into a PDF filed in the bureau's document area;
- announced by email to the firm;
- viewable in the admin;
- able to start the bureau's workflows.

This is JotForm parity for the features listed in the brief. The ERO onboarding form and workflow are out of scope: Krystal builds them with these pieces.

## How this works for tenants

Everything is per tenant from the first line. Forms, versions, submissions, uploads and PDFs belong to one bureau. Nothing is shared, and nothing is copied between bureaus.

- **Data.** Every new table carries `tenant_id` (NOT NULL), with the Step 0 policies (`tenant_isolation` for `tenant_app`, `tenant_members_only` for signed-in users) and same-tenant foreign keys. `tests/tenant-foundation.test.ts` already fails the build if a new table is missing either.
- **Files.** Files live in private buckets under the tenant's own folder:
  - uploads in `tenant-form-uploads/{tenant_id}/…`;
  - submission PDFs in `tenant-documents/{tenant_id}/submissions/…`.
  The server builds every path from rows the tenant can see, and serves files only through 60-second links. This is the same `ownPath` guard as Piece 1.
- **Public links.** A form is published at `/f/{public_id}`. The id is a random 16-character string, not the form's database id and not the bureau's name. Finding which tenant owns a link is one logged platform lookup, `platformClient("form_link")`, the same pattern as document links. After that, the page acts only as that tenant. The tenant-foundation test's list of allowed platform lookups gains exactly this one entry.
- **Branding.** Public pages and emails show the tenant's own firm name, from the Piece 1 firm profile. Emails go from the tenant's own sending address (Piece 1 senders). There is no Monarch branding on another bureau's forms.
- **Workflows.** A `form.submitted` event starts only that tenant's workflows. Form answers fill only that tenant's documents.
- **Monarch is tenant #1** and uses this exactly as any other bureau would.

## What gets built

### 1. Admin → Forms

The list shows, for each form: name, status, submission count, the last submission, and the public link with a copy button.

**Status:**
- **Draft:** not reachable.
- **Published:** accepting submissions.
- **Closed:** the link shows the form's "closed" message.
- **Archived:** hidden from the list by default.

**Actions:** new form, duplicate (within the same tenant), close or reopen, archive. A form with submissions can't be deleted, only archived. A form that never had a submission can be deleted.

### 2. The builder

The screen has three panes:
- the **field palette**;
- the **canvas**, showing pages, then sections, then fields;
- the **settings panel** for whatever is selected.

**Arranging fields:**
- **Drag and drop:** drag a field type from the palette onto the canvas, or drag fields between sections and pages.
- **Without a mouse:** every field and section also has Move up and Move down buttons, so arranging works on a touchscreen and from the keyboard.
- Fields can be duplicated or deleted.

**Per field:**
- label, help text, placeholder;
- required or optional;
- width: full or half, for two fields side by side on desktop (one column on phones);
- a **key**: lowercase, unique in the form, generated from the label and editable. Keys name the answer in the PDF, the CSV, workflow conditions and document merge fields.

**Pages and sections:**
- A form has one or more **pages**. A multi-page form shows a progress bar and Back and Next buttons.
- Each page has one or more **sections**, each with a title and an optional description.

**Saving and publishing:**
- **Autosave** keeps the draft while you edit.
- **Preview** shows desktop and phone widths.
- **Publish** freezes the current draft as version N. Later edits stay in the draft until you publish again, with an "Unpublished changes" banner.
- Each submission keeps the version it was made on, so changing a form never changes past submissions.

**Limits:** 200 fields, 20 pages and 100 logic rules per form.

**Library:** `@dnd-kit/core` and `@dnd-kit/sortable` (MIT), because built-in browser drag and drop doesn't work on phones or tablets.

### 3. Field types

| Type | Settings | Checked on the server |
|---|---|---|
| Short answer | min and max length (default max 200) | length |
| Long answer | max length (default 5,000) | length |
| Number | min, max, decimals allowed | numeric, in range |
| Email | — | address format, max 254 |
| Phone | US or international | 10 digits for US; E.164 for international |
| Date | earliest and latest (fixed dates, or "today ± N days") | real date, in range |
| Dropdown | options (2–200) | one of the options |
| Radio | options (2–50) | one of the options |
| Checkboxes | options (1–50); minimum and maximum selected | all of them options; the count |
| File upload | allowed types (PDF, JPG, PNG); 1 to 5 files; up to 10 MB each | content check (below) |
| Signature | none; uses the form's consent statement (§6) | a real PNG of sensible size, consent ticked, name typed |
| Address | parts: street, line 2, city, state, ZIP, country (default US) | required parts present; US state from the list; ZIP format |

There are also two display-only blocks: **Heading** and **Paragraph**. They hold no answer.

Answers are stored and shown as plain text only. Nothing a respondent types is ever rendered as HTML, a link or a formula, in the admin, the PDF, emails or the CSV. The CSV guards against formula injection by prefixing `= + - @`.

### 4. Show/hide logic and skip logic

**Show or hide** a field or a whole section:
- "Show *[target]* when *[all | any]* of these are true."
- Each test is: *[field]* *[equals | does not equal | contains | is answered | is empty | is greater than | is less than]* *[value]*.

**Skip logic** on a page:
- "After this page, when *[conditions]*, go to *[a later page | the end]*."
- The first rule that matches wins. With none matching, the next page is shown.

**Rules when you save:**
- A rule may only test fields that appear before its target.
- Skips may only jump forward, so there are no loops.
- Rules that point at deleted fields are refused, with the rule named.

**On submit, the server runs the same logic code the browser runs.**
- Answers to fields that ended up hidden or skipped are thrown away.
- "Required" applies only to fields the respondent actually saw.

A tampered browser can't submit hidden fields or skip required ones.

### 5. File uploads (EFIN/PTIN letters, IDs, banking documents)

- **Direct to storage.** Files go straight to storage through a one-time signed upload link. Vercel's 4.5 MB request limit doesn't apply.
  - The page asks the server for a link for each file, rate-limited and bounded by the field's size and type.
  - The server records a pending upload, and the browser uploads the file.
- **Checked on submit.**
  - Each file is checked by its content: `%PDF` for PDFs, JPEG and PNG signatures for images. Encrypted PDFs and PDFs with scripts are refused, as in Piece 1.
  - Its SHA-256 is recorded and it's attached to the submission.
  - Uploads never attached are deleted after 24 hours by the existing scheduled job.
- **iPhone photos.** iPhones convert HEIC photos to JPEG when the form only accepts JPG and PNG, so phone photos of IDs work.
- **Viewing.** Uploaded files are visible only to the bureau's administrators, through 60-second links. Each view is recorded.

### 6. Signature field

- **Typed or drawn,** with the signer's printed name. This reuses the Piece 1 signing component.
- **Consent wording is the bureau's own,** not hard-coded. Each form with a signature field has a consent statement the bureau types. The form can't be published without it.
  - The respondent must tick that they agree before the field can be signed.
  - The submission keeps the exact consent text shown, the time of consent, a hashed network address and the browser.
- **In the PDF,** the signature is printed with its timestamp. The consent text and signing details go on a certificate section at the end.

### 7. Public form page `/f/{public_id}`

- **No login.** It shows the firm's display name, then the form, mobile first.
- **Respondents see clear messages** for:
  - a closed form: the form's own message;
  - a past close date, or the submission limit reached;
  - an unknown link: "This form link is not valid".
- **Spam protection:**
  - a hidden honeypot field;
  - a minimum fill time of 3 seconds;
  - rate limits of 10 submissions per hour per network address per form, and 300 per hour per form;
  - 60 upload links per hour per network address.
  Suspected spam is kept, marked Spam and not announced, so nothing is lost silently.
- **Optional settings:** a close date, a maximum number of submissions, and the closed-form message.
- **Not in Piece 2:** embedding on other websites (see open decisions).

### 8. Confirmation screen and Download PDF

After submitting, the respondent sees:
- the form's confirmation message (the bureau writes it; there's a default);
- the submission number and the submission time in the firm's time zone;
- a **Download PDF** button.

The download is tied to that browser by an http-only cookie and works for 60 minutes. The PDF contains personal data, so it never has a public link.

### 9. Submission PDF, saved to the firm's document area

- **Made on submit,** server-side with `pdf-lib`. The submission is saved first. If the PDF fails, it's retried by the scheduled job, and the admin shows "PDF pending" until it's made.
- **Contents:**
  - firm name; form name and version; submission number;
  - **started and submitted timestamps**, in the firm's time zone with UTC alongside;
  - every answer the respondent saw, by section;
  - uploaded files by name, size and SHA-256 (the files stay separate; see open decisions);
  - the signature with its consent text and signing details.
  - Every page carries a footer with the submission number, page N of M, and the generation timestamp.
  - The PDF's own SHA-256 is recorded.
- **Characters.** Names and answers in any language print correctly, using an embedded Unicode font: Noto Sans (OFL) through `@pdf-lib/fontkit` (MIT). Piece 1's built-in PDF fonts can't print characters outside Western European.
- **Where it's filed:** `tenant-documents/{tenant_id}/submissions/{submission_id}.pdf`.
  - **Documents → Form submissions:** a new tab, listing form, respondent, customer, date and fingerprint.
  - On the **customer's page**, when the submission is linked to a customer.
  - It can't be changed. It can be regenerated only on the same answers, for example after a font fix; the old fingerprint is kept in the history.

### 10. Notification email on submission

**Per form:** up to 5 recipient addresses, and which of the bureau's sending addresses it comes from.

**The email contains:** form name, submission number and time, the respondent's name and email when the form maps them, and a link to the submission in the admin.

**It doesn't contain the answers or files,** because forms collect IDs and banking documents and email isn't a safe place for them. The same goes for the respondent confirmation email (open decision 4).

Spam and test submissions don't notify. A failed send is retried and shown on the submission. It never blocks saving the submission.

### 11. Submissions in admin

**On each form, a Submissions tab:**
- columns for number, respondent, submitted time and status (New, In review, Done, Spam);
- search by name or email, and filters by status and date.

**The submission page:**
- answers by section; files with 60-second links and fingerprints; the signature and consent;
- Download PDF; the linked customer;
- a timeline: started, submitted, PDF made, notification sent, viewed by which administrator and when, status changes.
- Viewing is recorded because these records hold personal and financial data.

Records can't be edited: no one can change answers after submission.

### 12. Customers and workflows

**Respondent mapping, per form:** choose which email field and which name field identify the respondent. The submission is then linked to the bureau's customer with that email (decision 3 covers what happens when there's none yet).

**New event `form.submitted`:**
- Condition fields: `form_id`, plus `answer.<key>` for dropdown and radio fields, because their values are the bureau's own option list.
- Workflows can branch on answers. For example, "if `answer.filing_type` is *ERO*, send the ERO engagement letter."

**Form answers as merge fields:**
- Piece 1 documents gain `{{form.<key>}}` merge fields, filled from the answers of the submission that triggered the run.
- A workflow that sends such a document must be on `form.submitted` with a `form_id` condition. On save, it checks that every `form.<key>` the document uses exists in that form.
- A missing answer fails the step, as in Piece 1. Nothing is sent blank.

**Test submissions:** "Test this form" in the builder makes a submission marked TEST. It's excluded from counts and notifications, and workflows treat it as a test run.

### 13. Database (one migration, test project first)

| Table | Holds |
|---|---|
| `forms` | name, description, status, `public_id` (unique), draft definition, settings (notifications, sender, respondent mapping, messages, close date, limit), consent statement, current published version |
| `form_versions` | the frozen definition: pages, sections, fields and logic, as JSON checked on the server. Version number, publisher and time. Never changed. |
| `form_submissions` | form, version, number (per form), customer, respondent name and email, answers, status, test flag, started and submitted times, hashed network address, browser, consent text and time, PDF path and SHA-256, confirmation-cookie hash and expiry |
| `form_uploads` | form, submission (empty while pending), field key, path, name, type, size, SHA-256, status (pending/attached), expiry |
| `form_events` | append-only history, including administrator views |

- Every table has `tenant_id`, the Step 0 policies and same-tenant foreign keys.
- Submission numbers are unique per form and tenant.
- New bucket `tenant-form-uploads`: private, 10 MB, PDF, JPEG and PNG.
- The submission PDFs reuse `tenant-documents`.

### 14. Libraries

| Library | Why | License |
|---|---|---|
| `@dnd-kit/core`, `@dnd-kit/sortable` | drag and drop that works with touch and keyboard | MIT |
| `@pdf-lib/fontkit` + Noto Sans | Unicode text in submission PDFs | MIT / OFL |

`pdf-lib` is already installed from Piece 1. There are no other new services.

## Not in Piece 2

- The ERO onboarding form and workflow (Krystal builds them).
- Payments inside forms, calculated fields, and conditional email recipients.
- Embedding forms on other websites, save-and-continue-later, and prefilled links (see open decisions).
- Sharing or selling form templates between bureaus. Each bureau builds or duplicates its own.

## Acceptance tests (each with recorded evidence: case, expected, actual, pass/fail)

1. **Builder:**
   - build a 3-page form with every field type by drag and drop, then again with the Move buttons only (on a phone);
   - autosave survives a reload;
   - publishing makes version 1;
   - editing and republishing makes version 2, and earlier submissions still show version 1.
2. **Validation:** each field type rejects bad input on the server, sent by a script that bypasses the browser. Required fields are enforced.
3. **Show/hide and skip:**
   - hidden fields aren't required and their answers are dropped, even when a script submits them;
   - skip logic jumps forward;
   - a rule pointing backward or at a deleted field is refused on save.
4. **Uploads:**
   - PDF, JPG and PNG accepted; a renamed EXE, an encrypted or scripted PDF, an 11 MB file and a 6th file are refused;
   - a phone photo works;
   - unattached uploads are gone after 24 hours.
5. **Signature:**
   - typed and drawn both work;
   - the form can't be published without a consent statement;
   - the consent text and time are stored and printed in the PDF.
6. **Public link:**
   - works with no login on desktop and phone;
   - closed, past-date, limit-reached and unknown links each show the right message;
   - honeypot, too-fast and rate-limited submissions are marked Spam or refused, and none of them notifies.
7. **PDF:**
   - made on submit, with timestamps on every page and its SHA-256 recorded;
   - filed under Documents → Form submissions and on the customer;
   - non-Latin names print correctly;
   - the confirmation-screen download works in that browser, and not in another browser or after 60 minutes.
8. **Notification:** sent once, from the chosen address, with no answers or files in it. A failed send is retried and doesn't lose the submission.
9. **Admin:**
   - the list, search and filters work;
   - the detail page shows answers, files (60-second links) and signature;
   - viewing is recorded, and answers can't be edited.
10. **Workflows:**
    - `form.submitted` fires once per submission;
    - a condition on `answer.<key>` routes correctly;
    - a document with `{{form.<key>}}` fills from the answers;
    - a missing answer fails the step;
    - test submissions run as tests.
11. **Tenant isolation**, through the server path as in the Step 0 and Piece 1 gates:
    - tenant A can't list, read or change tenant B's forms, versions, submissions, uploads or events;
    - a tenant A link never resolves to tenant B;
    - tenant A can't get a file link for a tenant B path;
    - tenant A's workflow can't use tenant B's form;
    - a submission to tenant B's form never fires tenant A's workflows.

## Open decisions for you

1. **Where submission PDFs are filed.** My recommendation: a **Form submissions** tab in Documents, plus the customer's page, as above. They're not mixed into the document library, which holds templates you send.
2. **Uploaded files inside the PDF.** My recommendation: **list them** (name, size, fingerprint) and keep the files separate. Embedding photos of IDs and bank letters in every copy of the PDF spreads that data further. The alternative is to embed images and append PDFs into one bundle.
3. **Respondent with no customer record yet.** My recommendation: a per-form switch, **"Create a customer from new respondents"**, on by default. Onboarding forms are usually the first contact, and the Send-document step needs a customer. With it off, the submission is saved without a customer, and its workflows can't send documents.
4. **Confirmation email to the respondent.** My recommendation: optional per form, off by default, saying only "we received your submission," with no PDF or link to it.
5. **CSV export of submissions.** It's useful for spreadsheets, but every export is a copy of personal data. My recommendation: include it for administrators, with each export recorded and file-upload fields excluded.
6. **Deleting submissions.** My recommendation: no deleting, except Spam, which can be emptied. Tax-preparer records are often needed for years. If you want a retention period, for example deletion after N years, that's a later setting.
7. **Later, not in Piece 2:** embedding on outside websites, save and continue later, and links prefilled for a known customer (for example sent from a workflow email). Each is small once Piece 2 exists. Tell me if any is needed for the ERO onboarding workflow and I'll fold it in.
8. **Legal review.** Each bureau writes its own consent wording. I recommend counsel review Monarch's before real clients sign, as with Piece 1.

## Rollout

The same steps as Piece 1:

1. Migration on the test project, plus the isolation gate.
2. PR with test evidence.
3. Your approval for the production migration. It's additive.
4. Merge and deploy, then verify on production.

**Building starts only after you approve this spec.**
