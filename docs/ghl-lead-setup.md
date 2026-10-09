# Lead delivery setup: GoHighLevel first, any CRM after

The licensed calculator (`/embed/calculator?id=<embed id>`) can send each lead
to the license holder's own system. Monarch does not store leads. A webhook URL
only **receives** data: it creates a CRM contact or sends an email only if the
receiving workflow is built to do that. Test each outcome separately.

## What Monarch sends (one signed POST per lead)

`event: "calculator.lead"`, `id`, `submitted_at`, `source`, `website`, `tags`,
`contact { first_name, last_name, email, phone }`, `consent`, and (when the
estimate is included) `estimate`: `headline`, `result` (`refund`|`owed`),
`amount`, `estimated_federal_tax`, `withholding_plus_refundable_credits`,
`breakdown {…}` and `text` (ready-to-email summary). Headers: `Idempotency-Key`,
`X-Monarch-Timestamp`, `X-Monarch-Signature` (HMAC-SHA256 with the signing
secret shown once when the webhook is saved). The visitor's income entries are
not sent.

## First customer: GoHighLevel (webhook route)

1. **Workflow.** Automation → Workflows → Create → *Start from scratch* →
   trigger **Inbound Webhook**. Copy the webhook URL it shows. (This trigger can
   be a premium trigger on some GoHighLevel plans.)
2. **Save it in Monarch.** Open `/integrations`, enter the license key, paste
   the URL under *Option B*, save. Copy the signing secret now (shown once).
3. **Send the sample.** Press *Test destination* (sends a sample with no
   personal data) so GoHighLevel captures the field structure. Then submit one
   clearly fake lead through the calculator so the real fields (`contact.*`,
   `estimate.*`) appear in the mapping reference.
4. **Create the contact.** Add action **Create/Update Contact**; map first name,
   last name, email, phone from `contact.*`; add tags and source. *The webhook
   alone does not create a contact.*
5. **Email the results.** Add action **Send Email** (to the contact, to staff, or
   both). Put `estimate.headline` and `estimate.text` in the body. *The webhook
   alone does not send an email.* Publish the workflow.
6. **Lead form settings.** Same page: business name, lead source, tags, whether
   to include the estimate, optional notification email, then enable the form.

Optional: GoHighLevel OAuth (Marketplace app) can create the contact directly;
it is off until `HIGHLEVEL_CLIENT_ID`/`HIGHLEVEL_CLIENT_SECRET` are configured.

## Notification email (optional, separate from the CRM)

When the server has `RESEND_API_KEY` and `LEAD_NOTIFY_FROM` (a sender on a
verified domain) and the migration `20261009210000_lead_notification_email.sql`
is applied, the settings screen accepts a notification email. Each *delivered*
lead is then also emailed there (contact details and results, reply-to = the
visitor). A failed email never fails the lead; it is recorded on the connection
without personal data. Without these, leave the field blank and email from the
CRM workflow instead.

## Reusable approach for other CRMs

Any tool that accepts an HTTPS JSON webhook works the same way: Zapier, Make,
n8n, HubSpot or Salesforce workflows, a custom server. Map the same fields,
verify `X-Monarch-Signature` if the receiver can, de-duplicate on
`Idempotency-Key`. Only public HTTPS hosts on port 443 are allowed.

## Acceptance record (update as each is actually run)

| Check | Status |
|---|---|
| Full calculator matches the published demo (1,500 random scenarios) | PASSED (automated) |
| Blank inputs, contact fields, consent, submit (Chromium, local) | PASSED |
| Server delivery payload, privacy, retries, failure paths (automated) | PASSED |
| Licensed embed renders on the authorized domain inside GoHighLevel | NOT RUN (needs license + her GHL) |
| Unauthorized domain / direct visit refused | Unknown id refused live (PASSED); licensed case NOT RUN |
| Webhook received by the customer's GoHighLevel workflow | NOT RUN |
| Contact created in the correct GoHighLevel location | NOT RUN |
| Agreed results present in that contact/workflow | NOT RUN |
| Notification email received | NOT RUN (needs provider config + migration approval) |
| Results email from the GoHighLevel workflow received | NOT RUN |
