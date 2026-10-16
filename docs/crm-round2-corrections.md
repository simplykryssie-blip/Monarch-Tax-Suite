# CRM Round 2: remaining corrections

Migration: `supabase/migrations/20261031100000_tenant_storage_and_sending.sql`
Tests: `tests/storage-messages.test.ts`, `tests/pipelines.test.ts`

## 1. Per-tenant private image buckets

- Every tenant has its own **private** bucket, `tenant-{tenant_id}`. The migration makes one for every existing tenant, and a trigger makes one when a tenant is created (the app also makes it on first upload if it's ever missing).
- No bucket is public and there are no `storage.objects` policies: only the server reads or writes, and it picks the bucket from the request's tenant.
- Images that must show outside the app (inside an email, on a public form, on the shop or in Stripe) are served by the app at `/media/{tenant}/images/...`. That route reads only image files under `images/`, only from that tenant's bucket. Documents and uploads are never reachable through it. File names are random UUIDs.
- What goes there:
  - **Email images**: new *Automations → Images* page (upload, preview, copy the email code, delete), plus **Upload a picture** inside the email template editor's Picture button.
  - **Form logos and header images**: they used to go to the shared, public `product-images` bucket.
  - **Product images**: new uploads. Older ones are still shown from their old location until moved.
- New tables: `tenant_images` (the image library) and `storage_cleanup` (see 2). Both have `tenant_id` and the standard tenant policies from day one.

### Moving the existing images

`scripts/move-legacy-images.ts` copies existing product images and form logos/header images from the shared public bucket into each tenant's private bucket, updates the records, then deletes the old files. It does a dry run unless you pass `--apply`. Run it on the test project first:

```
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... APP_ORIGIN=https://<app address> node scripts/move-legacy-images.ts
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... APP_ORIGIN=https://<app address> node scripts/move-legacy-images.ts --apply
```

Once it reports nothing left to move, the `product-images` bucket can be set to private (or emptied and deleted).

## 2. Deleting: a 24-hour window, then the file is purged

When someone deletes a file, or a record that has files:

- It's removed from the app at once.
- The notice says: *"It's gone from the app now. Its file will be permanently deleted in 24 hours and can't be recovered after that."*
- Its stored files go into the `storage_cleanup` queue with `purge_after` set to 24 hours later.
- The scheduler (`/api/automation/run`) deletes only files whose time has come.

There's no in-app Undo. Within the 24 hours the file still exists in storage, so the owner could recover it by hand.

Covered:
- client documents
- library documents
- the compliance vault
- EFIN firm documents (one at a time, and with an ERO)
- product images (removed or replaced)
- product files
- email images
- form logos and header images
- form uploads and spam
- hard deletes from the archive (products, forms, documents)

Files the *system* removes are deleted at once: a file that fails its content check, an upload that was never finished, an expired form draft, a save that was rolled back. If storage is unreachable, those are queued for the next sweep.

If a file can't be queued, it's deleted at once rather than left behind.

**Timing:** Vercel Cron runs the scheduler once a day (11:00 UTC). So a file is purged between 24 and 48 hours after it was deleted, never sooner than 24. An hourly cron (Vercel Pro) would tighten that to 24–25 hours.

## 3. Pipelines

Create, edit (name and stages), archive, restore and delete all work:

- Archived pipelines are now listed under **Archived pipelines** with **Restore** and **Delete**. Before, an archived pipeline disappeared from the list, and the only way back was its direct link.
- **Delete** is permanent. It's only offered for archived pipelines and needs a tick to confirm. The pipeline running My Work can't be archived or deleted.
- Restoring a pipeline whose name is now taken by another active pipeline explains what to do, instead of failing with a general error.
- Active pipelines have an **Archive** link on the list.

## 4. Sending from a client's Messages tab

- **Send email** goes from the account's default verified sender (*Settings → Email sending*).
- **Send text** goes from the office's own Twilio account (see 5), to the client's phone in +1… form, up to 480 characters.
- Every send is added to the client's history as Sent or Failed (with the reason, and segments for texts).
- **Outside production**, only addresses and numbers in `AUTOMATION_TEST_RECIPIENTS` are contacted.

## 5. Text messaging per office (Twilio subaccounts)

Migration: `supabase/migrations/20261101090000_tenant_sms.sql`. Code: `lib/sms/`, `lib/automation/twilio.ts`. Page: *Settings → Text messaging*.

- **Tenant #1 (Monarch)** texts from the owner's own Twilio account, set in Vercel. The owner pays Twilio directly, so no credits are used. It needs:
  - `TWILIO_ACCOUNT_SID`;
  - `TWILIO_AUTH_TOKEN`, or `TWILIO_API_KEY` with `TWILIO_API_SECRET` (an API key needs its secret; if both are set, the key is used for sending);
  - `TWILIO_FROM_NUMBER`, or `TWILIO_MESSAGING_SERVICE_SID`.
- **Every other office** gets its own Twilio **subaccount** under the owner's account. *Settings → Text messaging* walks it through these steps:
  1. **Set up:** makes the subaccount and a standard API key *inside it*. The office sends with that key, never with the owner's credentials. The key's secret is stored encrypted with `MONARCH_ENCRYPTION_KEY`, bound to the tenant, so one office's key can't be read as another's.
  2. **Choose a number:** search by area code and buy it into the office's subaccount. This needs credits first.
  3. **Carrier registration (A2P 10DLC):** texts are refused until it's `approved`.
  4. **Credits:** a prepaid balance.
- Setup can be repeated safely. If it stops half-way, it carries on with the same subaccount.
- An office never falls back to the owner's account or number.
- **Credits:**
  - Twilio bills every subaccount's usage to the owner's account, so offices prepay. That's why credits live in the app (`sms_credit_ledger`), not in Twilio.
  - One credit sends one message segment (160 plain characters, or 70 with emoji and other non-GSM characters).
  - Credits are taken before sending, in one locked step (`spend_sms_credits`), so two texts can't spend the same credit. A text Twilio refuses gets its credits back.
- Making subaccounts needs the owner's **auth token** (or a *Main* API key). A standard API key can't manage subaccounts.

### Open decisions for the owner

1. **Buying credits.** The ledger, balance and spending are built. A card checkout for credit packs isn't: it needs pack sizes and prices. Until then, credits are added by hand, for example:
   ```sql
   insert into sms_credit_ledger (tenant_id, delta, kind, note) values ('<tenant id>', 500, 'grant', 'Paid by invoice');
   ```
2. **Number and registration costs.**
   - A number costs about $1.15 a month, charged to the owner's account. Registration has one-time Twilio fees.
   - Decide whether these come out of credits or are billed separately. Today, buying a number only requires a credit balance above zero.
3. **Running registration.**
   - The office's brand and campaign registration (A2P 10DLC: legal name, EIN, website, opt-in, sample messages) still has to be submitted per office.
   - The page shows its status, which is set in `tenant_sms_accounts.registration_status` for now.
   - A guided in-app registration form is a separate piece of work, and approval takes 2–4 weeks.

## Unchanged (confirmed by owner)

Bank CSV import still needs a manual review for each match. Product reviews still check the email and order number. Workflows don't send texts.

## Test project gate (2026-10-16)

Applied to the **test project only** (`monarch-test-throwaway`, `riuylqgpebchhinybxxz`):
- `20261031100000_tenant_storage_and_sending.sql`
- `20261101090000_tenant_sms.sql`
- a small follow-up that locks down two functions (now folded into the first file).

Production was not touched.

The gate is `supabase/tests/round2_gate.sql`. It uses two throwaway tenants and example.com data, simulates server requests the way PostgREST runs them, and rolls everything back. **20 of 20 passed:**

| Check | Result |
|---|---|
| New tenants each get a private bucket; every tenant has one; no storage policy opens them | Pass |
| Server request runs as `tenant_app` | Pass |
| `tenant_images`: own rows only; new rows filed under the request's tenant; writing into another tenant refused; a path outside `images/` refused | Pass |
| `storage_cleanup`: the sweep sees only this tenant's *due* files (not one deleted just now, not another tenant's) | Pass |
| `tenant_sms_accounts`: another tenant's account invisible; one account per tenant | Pass |
| `spend_sms_credits`: nothing spent with no credits; 2 of 3 spent; 2 more with 1 left refused | Pass |
| `sms_credit_ledger`: another tenant's credits invisible; adding credits to another tenant refused | Pass |
| `client_messages`: sent (with segments) and logged messages recorded | Pass |
| `product_images`: new `images/products/...` path accepted; a path outside `products/` refused | Pass |

Afterwards:
- No gate rows or buckets were left behind.
- Tenant #1's bucket `tenant-00000000-0000-4000-8000-000000000001` exists and is private.
- Security advisor: the two findings from the new migration (a trigger function executable by anon and signed-in users, and a function with a mutable search_path) are fixed. Anon and signed-in users can't run `tenants_make_bucket`, `ensure_tenant_bucket` or `spend_sms_credits`. The remaining advisor warnings were there before this work.

Not covered by the gate (it checks the database only):
- the app against Storage itself (upload → /media → delete → purge after 24 hours);
- live Twilio calls.

These need the Preview deployment pointed at the test project, and a Twilio test account or the owner's credentials.

## Rollout

1. ~~Apply both migrations on the test project and run the gate~~ (done, above).
2. **Owner review.** Production is approved separately.
3. On approval: apply `20261031090000_tenant_brands` (if it is not on production yet), then `20261031100000`, then `20261101090000` on production, *then* deploy. The migrations only add things, so the code running today keeps working once they're on.
4. Run the image move script on production (dry run first).
5. In Vercel, add `TWILIO_FROM_NUMBER` (or `TWILIO_MESSAGING_SERVICE_SID`), if not already there, for Monarch's own texts.

---

# Round 3: Forms Settings rework, and texting billing with self-serve setup

Migrations (both additive):
- `20261102090000_forms_delete.sql`
- `20261103090000_sms_billing.sql`

Gate: `supabase/tests/round3_gate.sql` (rolls back by design). Tests: `tests/sms-billing.test.ts`, plus new cases in `tests/forms-*.test.ts`.

## Forms Settings

1. **"How are they related to you?"** starts empty. It's required only when **Create or link a tax office from each submission** is ticked.
   - The office mappings and **People at the office** only appear while that box is ticked (CSS, no script).
   - Both are collapsible.
2. **Submit behaviour radios:** the gap is fixed. The text-input style (full width, padding) was being applied to radio buttons.
3. **Logo and header image:** choose one from **Images** or upload a new one.
   - A library picture still used by a form's look or the brand can't be deleted.
4. **Archive:** there's no "Reason for archiving" box on forms. Archive itself is unchanged.
5. **Delete this form:** type the form's name to confirm.
   - If the form has submissions, **Delete with submissions** must be ticked.
   - Only the submission rows go (answers, uploads, PDFs, internal values). Leads, contacts, customers and tax offices made from them are kept.
   - Files follow the 24-hour window.
   - The database still refuses to delete a submitted form anywhere else. The one exception is `delete_form_with_submissions`, for that one form, and it runs as the tenant.

## Texting: prices

| | Paid by card | Monthly, from credits |
|---|---|---|
| Credit pack | $25 = 1,000 credits | n/a |
| Toll-free number (recommended) | $5 one time (setup and carrier verification; no campaign, ever) | 110 credits ($2.75) |
| Local number | $23.50 one time (setup and brand/campaign registration) | 130 credits ($3.25) |

Charges are labelled by what they're for. Nothing shows how they're built up. All prices are in `lib/sms/pricing.ts`.

## Texting: how it works

- **Payments:** Stripe Checkout on the platform's own account, with `metadata.purpose` set to `sms_credits` or `sms_setup`.
  - Handled through the existing webhook, and again when the office returns from Checkout (once, either way).
  - Nothing is issued unless Stripe says it's paid, for that office, for exactly the amount recorded when the checkout started.
- **Credits:** they can only be bought, spent on a text, returned when a text is refused, taken for the monthly renewal, or forfeited.
  - Tenants can't write the ledger. The only writers are database functions scoped to the requesting tenant.
  - No transfers, no refunds, no manual credits.
- **Renewal:**
  1. On the due date, the monthly fee is taken from credits.
  2. If it can't be: texting is paused and the office is emailed.
  3. Retry on day 3, then day 7.
  4. If still unpaid: the number is released.
  5. 30 days after the due date: any remaining credits are forfeited.
  - Buying credits while paused renews at once.
- **Guided registration** (*Settings → Text messaging*). The office does everything itself:
  1. Chooses toll-free or local, and answers the business, contact and opt-in questions, including a picture of where clients agree, chosen from Images.
  2. Picks a number.
  3. Pays.
- **After payment is confirmed:**
  - its own subaccount and API key are created;
  - the number is bought into it (another of the same kind if the chosen one was taken);
  - the registration is submitted with the office's own key: toll-free verification, or the 10DLC chain (business profile linked to the platform's primary profile, A2P profile, brand, messaging service, then the campaign once the brand is approved).
  - Every step is recorded and resumes after a failure.
- **Daily job:** for every office, it finishes stalled setups, reads registration statuses and runs renewals. It reads only tenant ids at platform level; everything else runs as each office.

## Needed before offices can use it (owner)

- **Toll-free:** nothing more. Uses the owner's Twilio account (auth token, or a Main API key) as the parent.
- **Local numbers:** set `TWILIO_PRIMARY_CUSTOMER_PROFILE_SID` (the owner's approved primary business profile, `BU…`). Until then local numbers are shown as unavailable and can't be bought.
- **Notices** go to the office's firm-profile email, from `MONARCH_EMAIL_FROM`.
- **Twilio field names:** the registration calls follow Twilio's current API as I know it. Twilio test credentials can't run registrations, so one real toll-free registration should be run end to end (any rejection reason is shown on the page) before offering this widely.

## Test project status

Not applied yet. Every write through the Supabase connector timed out, even a trivial one, and nothing was applied or left behind; read-only queries kept working. Apply the two migrations above in the test project's SQL editor (or retry once the connector accepts writes), then run `supabase/tests/round3_gate.sql`.
