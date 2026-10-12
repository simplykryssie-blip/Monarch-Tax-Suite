# Phase 2, Step 1, Piece 1: Document Management (spec for review)

Status: **draft for owner review. Nothing is built.** Piece 2 (Form Builder) is specced only after this is approved and built.

## Goal

Each bureau (tenant) keeps its own library of PDF and Word documents. It can turn any of them into a template with merge fields, and its workflows get two new step types: **Send document** and **Request signature**. That's enough for Krystal to build onboarding workflows herself; the ERO onboarding workflow itself is out of scope.

## How this works for tenants

Everything below is per tenant from the first line. Nothing is shared between bureaus.

- **Data.** Every new table carries `tenant_id`, NOT NULL, with the tenant isolation policy from Step 0. Requests run as `tenant_app`, so the database returns and accepts only the tenant's own rows. Same-tenant foreign keys mean a document, version, delivery or signature request can only point at rows of the same tenant. `tests/tenant-foundation.test.ts` already fails the build if a new table lacks `tenant_id` and a tenant policy.
- **Files.** Every file lives in one private storage bucket under the tenant's own folder: `tenant-documents/{tenant_id}/…`.
  - Paths are built only by the server, from the database row the tenant can see, never from user input.
  - Files are served only through signed links that expire after 60 seconds.
  - Storage doesn't go through the tenant role, so isolation tests also prove that a tenant A request can't produce a link to a tenant B path.
- **Merge fields.** "Firm" fields come from the tenant's own profile. Client fields come from the tenant's own customers.
- **Workflows.** Workflows can only pick documents from their own tenant's library, and send only to the customer on the triggering event.
- **Emails and public pages.** These show the tenant's firm name. Signing pages sit at the tenant-neutral path `/sign/{token}`; the token identifies the tenant on the server, never the URL.
- **Monarch is tenant #1** and uses this exactly as any other bureau would.

## What gets built

### 1. Firm profile (per tenant)

A small **Admin → Settings → Firm profile** page, which the merge fields and outgoing emails need:

- legal firm name, display name, email, phone, mailing address, time zone (default America/New_York);
- optionally, a logo for the signing page.

It's stored per tenant, as a new `tenant_profiles` table with one row per tenant. Monarch's row is seeded from today's values.

### 2. Document library: Admin → Documents

- **Upload** PDF or DOCX, up to 25 MB, through the same direct-to-storage upload as product files, so the 4.5 MB server limit doesn't apply.
  - Files are checked by content, not just by name: PDFs must start `%PDF`, and DOCX must be a valid Office zip containing `word/document.xml`.
  - Macro-enabled files (`.docm`), encrypted PDFs and other types are refused.
- **List:** name, type, Template or Plain, status (Active or Archived), version, updated date, and how many times it was sent or signed.
- **Detail page:**
  - a preview, with "Preview with sample data" for templates;
  - the merge fields found;
  - version history;
  - every copy sent and every signature request, with its status.
- **New version.** Uploading a replacement creates version N+1. Copies already sent or signed keep pointing at the version they used. Versions are never overwritten.
- **Archive, not delete,** once a document has been sent. A document that was never sent can be deleted.
- **Send manually**: "Send to a customer…" runs the same send or signature flow by hand, without a workflow.

### 3. Templates and merge fields

A document becomes a template when it contains merge fields. They're found automatically on upload.

| Type | How merge fields are written | What the customer receives |
|---|---|---|
| **DOCX** | `{{client_name}}` typed anywhere in the text, including headers, footers and tables. Fields Word has split across formatting runs are handled. | A filled-in DOCX |
| **PDF** | A fillable PDF form field named after the merge field, e.g. a text field called `client_name`. You can make these in Acrobat, or with free tools such as PDFescape. | A filled PDF, flattened so it can't be edited |

Rules, the same as for email templates today:

- **Approved fields only.** If an unknown field is found on upload, the upload is refused with its name, so a typo like `{{clinet_name}}` can never reach a customer.
- **Missing values fail the step.** If a field the document uses has no value for this customer, the step fails with a clear reason. It doesn't send a blank. You can retry after filling in the data, for example the firm phone.
- **Values are inserted as text only.** No formulas, scripts or links can be injected.

**Merge fields in Piece 1:**

| Group | Fields |
|---|---|
| Client | `client_name`, `client_first_name`, `client_email`, `client_business_name` |
| Firm (from the firm profile) | `firm_name`, `firm_legal_name`, `firm_email`, `firm_phone`, `firm_address` |
| Purchase | `order_number`, `order_date`, `product_name`, `amount_paid` |
| Dates (firm time zone) | `today`, `current_year` |
| Signing (signature documents only; filled at signing) | `signer_name`, `signed_date` |

Piece 2 adds form answers as a further source of values.

### 4. Workflow step: Send document

This joins Send email and Record note in the workflow editor.

**Settings:**
- the document to send, from this tenant's active documents;
- the recipient: the event's customer;
- an optional custom message;
- the link lifetime, 14 days by default.

**What happens:**
1. The current version is filled in for the event's customer.
2. The finished copy is saved: tenant, document, version, customer, order, workflow run, SHA-256 fingerprint and timestamp.
3. The customer gets an email with a **secure link**, not an attachment. The link opens a page with a "Download" button. Opens and downloads are recorded. Links expire and can be revoked from the admin.

**It's safe to retry or replay.** A retried or replayed workflow run sends the same copy once. This uses the same once-per-run rule as emails today.

**Test runs** go only to the test recipient, with the copy marked TEST. They never count as a real send.

New event: `document.sent`.

### 5. Workflow step: Request signature

**Settings:**
- the document, which must be a PDF;
- the signer: the event's customer;
- the link lifetime, 14 days by default;
- reminders: off, or every 3 days until the link expires.

**What the signer sees at `/sign/{token}`:** no login, and a single-use secret link of which only a hash is stored.
1. The firm name and logo, and the filled document, viewable page by page on desktop and phone.
2. Consent to sign electronically, with the standard disclosure, before signing.
3. Signature, typed or drawn, plus their printed name.
4. "Sign," or "Decline," with an optional reason.

**What is recorded:**
- the time the request was created, viewed, consented to, and signed or declined;
- the signer's name and email;
- a hashed IP address and the browser;
- SHA-256 fingerprints of the document before and after signing.

**The signed copy:**
- The signature is placed in the PDF's `signature` field if the template has one; otherwise in a signature block on a final page.
- A **signing certificate page** is appended with the audit details above.
- The result is flattened and saved to the tenant's library, next to the unsigned copy.
- The signer gets a confirmation email with a download link to the signed copy, and the firm gets a "Signed" notice.

**Events:** `document.signed` (so workflows can continue, for example "after the engagement letter is signed, send…"), `document.signature_declined` and `document.signature_expired`.

**Limits:**
- Signed copies can't be changed or deleted.
- A request can be voided before it's signed.
- The signing page is rate-limited.

**One signer per request in Piece 1:** the customer. Multi-party signing (for example the firm countersigning) is listed under open decisions below.

### 6. Database (one migration, applied to the test project first)

| Table | Holds |
|---|---|
| `tenant_profiles` | Firm profile (1 per tenant) |
| `documents` | Library entries: name, type (pdf/docx), template flag, merge fields used, status, current version |
| `document_versions` | Each uploaded file: storage path, size, SHA-256, who uploaded it and when. Never overwritten. |
| `document_deliveries` | Each filled copy sent: document, version, customer, order, workflow run, link token hash, expiry, opened/downloaded times, status |
| `signature_requests` | Signer, token hash, status (sent / viewed / signed / declined / expired / voided), consent and signing evidence, signed-copy path and SHA-256 |
| `document_events` | Append-only history of every action on the above |

All of them carry `tenant_id` with the Step 0 policies and same-tenant foreign keys. The storage bucket `tenant-documents` is private and limited to 25 MB per file and to PDF and DOCX.

### 7. Libraries

| Library | Why | License |
|---|---|---|
| `pdf-lib` | Fill PDF form fields, place signatures, add the certificate page, flatten | MIT |
| `docxtemplater` + `pizzip` | Fill DOCX merge fields, including ones Word split across runs | MIT |
| `pdfjs-dist` | Show the PDF page by page on the signing page, including on phones | Apache-2.0 |

All three are plain JavaScript and run in Vercel's server functions. **DOCX is not converted to PDF:** that needs LibreOffice, which Vercel can't run. That's why signature requests need a PDF.

## Not in Piece 1

- The ERO onboarding workflow (Krystal builds it).
- The Form Builder (Piece 2).
- Editing documents inside the app. You upload, replace and version files instead.
- DOCX-to-PDF conversion, and multiple signers per request (see open decisions).
- Customer self-service document portal. Customers use the secure links.

## Acceptance tests (each needs recorded evidence: case, expected, actual, pass/fail)

1. Upload PDF and DOCX; reject `.docm`, an encrypted PDF, a renamed EXE and a file over 25 MB.
2. A DOCX template with fields split across formatting is filled correctly. An unknown field is refused at upload.
3. A fillable-PDF template is filled and flattened.
4. Send document from a workflow: one copy, one email, a working link, open and download recorded. A replayed run doesn't send a second copy.
5. A missing value, such as an empty firm phone, fails the step with a clear reason and nothing is sent. Retrying after filling it in succeeds.
6. Request signature:
   - sign on desktop and on a phone;
   - the signed PDF has the signature and certificate page, and its SHA-256 is recorded;
   - `document.signed` fires once.
7. Decline, expiry and void each set the right status and event. An expired or used link can't sign.
8. A new version doesn't change copies already sent or signed. A sent document can only be archived.
9. **Tenant isolation:**
   - tenant A can't list, read, send, link to or sign tenant B's documents, versions, deliveries or requests;
   - a tenant A workflow can't select a tenant B document;
   - a link generated for tenant A never resolves to a tenant B file.
   All of this through the server path, as in the Step 0 gate.
10. Test runs go only to the test recipient and are marked TEST.

## Open decisions for you

1. **Signatures on Word documents.** My recommendation: PDF only, as above. Converting DOCX to PDF needs a conversion service, which is extra cost and an extra place documents go.
2. **Countersigning.** Is one signer (the customer) enough for Piece 1, or do your engagement letters need the firm to countersign? Countersigning adds ordered signers, which is roughly +30% to this piece.
3. **Sender identity.** Emails go from the platform's verified address. My recommendation: show the firm name ("Monarch Tax Suite" for tenant #1), with replies going to the firm's email.
4. **Choosing documents by package.** The tier packages carry `flow_type` (ptin_holder / standard_ero) and `mentorship` (yes/no). Today workflow conditions can't test product settings, so one workflow can't send a different document per package. My recommendation: add `flow_type` and `mentorship` as condition fields on purchase events in this piece, so Krystal's workflows can branch. It's small, but it's your call.
5. **Legal review.** The electronic-signature consent text and certificate page are written to the US ESIGN/UETA requirements: intent, consent, association with the record, and retention. I recommend counsel reviews the consent wording before real clients sign.

## Rollout

Same as before:

1. Migration on the test project, plus the isolation gate.
2. PR with test evidence.
3. Your approval for the production migration.
4. The migration only adds new tables, so it goes on production first. Then merge and deploy.

Building starts only after you approve this spec and the Phase 1 release gate is addressed, as you set out.
