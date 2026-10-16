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

## 2. Deleting a record deletes its file

- All storage removals now go through one helper. If storage can't be reached when a record is deleted, the file is written to `storage_cleanup` and the daily scheduler (`/api/automation/run`) deletes it. Nothing is left behind silently.
- Also fixed:
  - Replacing or removing a form's logo or header image deletes the old file, unless another form (for example a duplicate) still shows it.
  - Hard-deleting a product from the archive deletes its image files. Before, the rows went by cascade and the files stayed.
  - Hard-deleting a form deletes its logo and header image files.
  - Client document uploads that were started but never finished are swept after a day.
  - EFIN firm document deletes ignored storage errors; they now queue the file instead.
- There's no trash/restore window: the file goes when the record goes. Archive (where it exists) is still the undo.

## 3. Pipelines

Create, edit (name and stages), archive, restore and delete all work:

- Archived pipelines are now listed under **Archived pipelines** with **Restore** and **Delete**. Before, an archived pipeline disappeared from the list, and the only way back was its direct link.
- **Delete** is permanent. It's only offered for archived pipelines and needs a tick to confirm. The pipeline running My Work can't be archived or deleted.
- Restoring a pipeline whose name is now taken by another active pipeline explains what to do, instead of failing with a general error.
- Active pipelines have an **Archive** link on the list.

## 4. Sending from a client's Messages tab

- **Send email**: goes from the account's default verified sender (*Settings → Email sending*), to the client's email, as plain text in a simple, safe HTML layout.
- **Send text**: goes through Twilio to the client's phone, converted to +1… form, up to 480 characters.
- Every send is added to the client's history as Sent or Failed (with the reason). The **Log a message sent elsewhere** form is still there for calls and outside messages.
- **Outside production**, only addresses and numbers listed in `AUTOMATION_TEST_RECIPIENTS` are ever contacted, so a preview can't reach a real client.
- **Twilio**: the owner adds these in Vercel (server-side). *Settings → Integrations* shows whether they're set:
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_FROM_NUMBER` (or `TWILIO_MESSAGING_SERVICE_SID`)

  Until they're set, the Text box says what's missing, and nothing is sent.

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
