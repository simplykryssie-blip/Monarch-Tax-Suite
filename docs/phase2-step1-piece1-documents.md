# Phase 2, Step 1, Piece 1: Document management (built)

Approved spec: PR #30, with the owner's decisions of 2026-10-13. Migration: `supabase/migrations/20261015090000_documents.sql`. It's applied to the test project, and to production on 2026-10-13 with your approval.

## What a bureau can do

1. **Firm profile** (Settings → Firm profile): legal name, the name clients see, email, phone, address and time zone. Merge fields and client emails use these.
2. **Documents** (Operations → Documents):
   - Upload a PDF or Word (.docx) file, up to 25 MB. Files are checked by content. Refused: files renamed to .pdf or .docx, macro-enabled or encrypted Word files, encrypted PDFs, PDFs with scripts or embedded files, and old `.doc` files.
   - **Templates.** In Word, type `{{client_name}}` in the text; fields split by formatting, headers and footers all work. In a PDF, name fillable form fields after the merge field.
     - Unknown names are refused at upload.
     - A field with no value fails the step with its name, and nothing is sent.
   - **Versions.** Every upload of a replacement is a new version. Copies already sent keep the version they used.
   - **Remove or archive.** A document that was never sent can be deleted. One that was sent can only be archived.
   - **Preview with sample data**, and **Send to a customer** by hand.
   - **Sent copies.** Every copy shows its status: opened, downloaded, viewed, signed, declined or expired. You can download the copy as sent and the signed copy, see each copy's SHA-256 fingerprint, and revoke a link or void a request.
3. **Signing consent** (on each PDF's page): your own consent wording. The signer must tick a box agreeing to it before signing. Each request keeps the exact text its signer saw, and that text is printed on the signing certificate. A PDF can't be sent for signature until it has a consent statement.
4. **Workflow steps** (Automation → workflow editor), alongside Send email and Record note:
   - **Send a document.** Fills the document for the event's customer, saves a fingerprinted copy, and emails a secure link that expires. You choose the sender, an optional message and how long the link works.
   - **Request a signature** (PDF only). The customer reviews the PDF and agrees to your consent statement, then signs, typed or drawn, or declines.
     - The signed PDF gets a signing certificate page with timestamps, the consent text, fingerprints, and a hashed network address. It's saved to the bureau's library.
     - Optional reminders every N days. The signer gets a confirmation with the signed copy; the firm gets a notice.
     - Events `document.signed`, `document.signature_declined` and `document.signature_expired` let workflows chain. Conditions can test `document_id`.
   - **Sends once per run.** A retried run reuses the same copy and the same link.
   - **Test runs** use sample data and go only to the person running the test, marked TEST. Outside production, clients are never emailed.
5. **Email sending** (Settings → Email sending):
   - Connect your own domains (several per bureau, for multiple brands). Each shows the DNS records to add, and a Check button.
   - Add sending addresses ("brands") on those domains, and choose a default.
   - Emails come **from the firm's own address**. Each email template and each document step chooses which address it sends from.
   - Nothing is sent from an unverified domain; the step fails instead.
   - Until Monarch adds its own sending address, its emails keep going from the current platform sender. No other bureau can use that sender.
6. **Package attributes** (Settings → Package attributes):
   - Each bureau defines its own attributes: a key, a label, and either choices or free text.
   - Set the value on each product under Product settings as `key: value`.
   - Workflow conditions test `product.<key>` for any event that has an order, so documents can be routed per package however the bureau wants. Nothing is hard-coded to Monarch's fields.

## How it works for tenants

- **Database.** All 9 new tables carry `tenant_id`, with the Step 0 policies: the server runs as `tenant_app` and sees and writes only its tenant's rows. There are 14 more same-tenant foreign keys. `tests/tenant-foundation.test.ts` would fail if a table were missing `tenant_id` or its policy.
- **Files.** They live in the private `tenant-documents` bucket under `{tenant_id}/versions|deliveries|signed/…`. The server builds every path, and refuses to make a link to anything outside the requesting tenant's folder. Links last 60 seconds.
- **Public links** (`/d/…` and `/sign/…`). The token is a keyed hash of the copy's id; only its SHA-256 is stored. Finding which tenant a link belongs to is the one platform lookup, and it's logged. After that the page acts only as that tenant.
- **Email sending.** A domain can belong to one bureau only. Only Monarch, tenant #1, may attach a domain already on the platform's email account; every other bureau has to verify its own domain through DNS.

## Test evidence

`npm test`: 405 passing (26 new), plus `tsc`, `lint` and `build` clean. The new tests are in `tests/documents-engine.test.ts`, `tests/documents-service.test.ts`, `tests/documents-workflow.test.ts` and `tests/email-domains.test.ts`. The database gate is `supabase/tests/documents_isolation.sql`, run on the test project.

| # | Case | Expected | Result |
|---|---|---|---|
| 1 | Upload PDF and DOCX; renamed EXE, `.docm`, macro DOCX, encrypted DOCX, encrypted or scripted PDF, over 25 MB | Valid files accepted; the rest refused with a reason | Pass |
| 2 | DOCX with fields split across formatting, plus a header; an unknown field; an unclosed field; `{{#loop}}` | Filled correctly, values escaped; the rest refused | Pass |
| 3 | Fillable-PDF template | Filled and flattened; the `signature` field isn't treated as a merge field | Pass |
| 4 | Send-document step, with the event delivered twice | One copy, one email, one secure link, one `document.sent` | Pass |
| 5 | Email fails, then the run is retried | Same copy and the same link | Pass |
| 6 | Missing firm phone | Step fails with "firm_phone"; nothing sent | Pass |
| 7 | Request signature | Your consent text captured; signing needs the consent tick; signs once; signed PDF has signature and certificate; fingerprint recorded; a second attempt is refused | Pass |
| 8 | Decline, expiry, reminders, revoke | Right status each time; expired and used links can't sign; a reminder isn't sent twice in a row | Pass |
| 9 | New version after a send | Copies already sent unchanged | Pass |
| 10 | Remove a sent document vs an unsent one | Sent one archived; unsent one deleted with its files | Pass |
| 11 | Senders: default, chosen on an unverified domain, per-template brand | From the firm's own address; an unverified one fails the step; each template's brand is used | Pass |
| 12 | Package attributes: two workflows routed on `product.flow_type`, then the product changed | Only the matching document is sent, each time | Pass |
| 13 | Saving a workflow: unknown attribute, bad option, signature on a DOCX, another tenant's document or sender | Each refused | Pass |
| 14 | Test runs and preview environment | Test runs go to the test recipient only and are marked TEST; in preview, no client email | Pass |
| 15 | Storage isolation | A tenant can't link to another tenant's path, or to `..` paths; another tenant's link isn't found | Pass |
| 16 | Database isolation, 9 tables (test project, then production) | Runs as `tenant_app`; 0 of tenant B's rows visible; lists only A; insert into B refused; A's version on B's document refused even as the platform; insert without a tenant gets A | 13/13 pass on both |

**Not verified yet:**
- **Connecting a real domain.** This needs a full-access Resend API key in `RESEND_API_KEY`; a sending-only key gets a clear "cannot manage domains" message. The domain code is tested against a fake provider only.
- **The signing page on a phone,** and **real emails end to end.** Please run one test-mode signature on Preview after the migration.

## Rollout

1. Test project: migration applied; gate passed.
2. Merged (PR #31) and deployed to production.
3. **Production migration, done 2026-10-13** (approved), in one transaction:
   - 9 tables with row-level security, 18 policies and 14 same-tenant foreign keys;
   - the bucket is private, and Monarch's firm profile is seeded;
   - recorded in `schema_migrations`.
   The isolation gate (`documents_isolation.sql`) was re-run on production inside a rolled-back transaction, with fake example.com tenants only: **13/13 pass**, and nothing was left behind. No production errors were logged after the deploy.
4. Then, in the app:
   - fill in **Settings → Firm profile**;
   - add your domain under **Settings → Email sending** and verify it;
   - set your **Package attributes** and the matching product settings;
   - upload your documents, and add consent statements to the PDFs to be signed.

Out of scope, as specified: the ERO onboarding workflow itself (Krystal builds it with these pieces) and the Form Builder (Piece 2, specced next).
