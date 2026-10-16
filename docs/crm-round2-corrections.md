# CRM Round 2: remaining corrections

Migration: `supabase/migrations/20261031090000_tenant_storage_and_sending.sql`
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

## Rollout

1. Apply the migration on the test project and check with fake data:
   - upload an email image and a form logo;
   - delete them, and confirm the files are gone from the `tenant-…` bucket;
   - restore and delete a pipeline;
   - send to a test address on the allow-list.
2. **Apply the migration on production first, then deploy.** The migration only adds things (buckets, two tables, columns with defaults, a wider product image path check), so the code running today keeps working once it's on. The new code needs it: without it, sent client messages can't be recorded and product image uploads are refused.
3. Run the image move script on production (dry run first).
