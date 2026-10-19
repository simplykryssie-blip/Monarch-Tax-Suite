# Platform: archive instead of delete

Migration: `supabase/migrations/20261017090000_archive.sql`. It needs the forms migration (`20261016090000_forms.sql`) first, because it adds columns to `forms`. Gate: `supabase/tests/archive_isolation.sql`.

## What it does

- **Covers eight kinds of record:** customers, orders, licenses, products, service orders, documents, workflows and forms. Each one now has `archived_at`, `archived_by` and an optional `archive_reason`.
  - Firms, people, offices, EFINs, credentials and sending addresses keep the archive they already had.
  - The columns are on the shared tables, so every tenant has them, including new ones.
- **Remove archives.** Every Remove button archives the record: it disappears from the list, keeps all its links and history, and can be restored. You can give a reason.
  - Archiving changes nothing else about a record.
  - A license must be revoked first.
  - A customer can't be archived while they have a license that isn't revoked or expired, or an open service order.
  - An order can't be archived while its license or service order is still live.
  - A service order must be delivered or canceled first.
- **Lists:** every list has **Current / Archived** tabs with counts. The default tab shows current records only. Archived records have a **Restore** button.
- **Restore** brings a record back without putting it live again:
  - a product becomes unpublished (or a draft if it never had a price);
  - a workflow comes back paused;
  - a form comes back closed (or a draft);
  - a document comes back active.
- **Permanent delete** is in the archive panel of an archived record. It is:
  - only for records that are already archived;
  - only for the **account owner** (`tenant_members.role = 'owner'`);
  - only after typing the record's email, order number, license key prefix, slug or name exactly;
  - **never** for an order that took money, or a customer with one. Those stay archived as financial records.
  - Records with history are also kept: a sent document, a form with submissions, a workflow that has run, or anything still linked to orders or licenses. The page says why.
- **Buying again:** when an archived customer gets a new order with the same email, they are restored automatically, and the history notes why. This covers Stripe checkout, a reconciled purchase and an internal license.
- **History:** every archive, restore, automatic restore and permanent delete goes into `archive_log` (who, when, what, why). It is tenant-scoped and append-only: the database refuses changes and deletes. It's shown on each record and under **Settings → Archive history**.
- **One pattern:**
  - `lib/archive.ts`: the rules, pure and tested.
  - `lib/archive-service.ts`: applies the rules and writes the history.
  - `lib/archive-server.ts`: the tenant's database.
  - `components/admin/archive.tsx`: `ArchiveTabs`, `ArchivePanel` and `ArchiveRowButton`.
  - `app/(admin)/archive-actions.ts`: the actions every page uses.
  - The old per-module remove and delete actions for documents, workflows and forms are gone, so nothing skips these rules.
- **Status tables:** products, documents, workflows and forms already had an "archived" status, which the storefront, sending, the workflow engine and public forms respect. For those four, a trigger keeps `archived_at` in step with the status. Rows archived before this migration get their last update time as their archive time.
- **New page:** orders now have a detail page (`/orders/{id}`), where the archive panel lives.

## Tenant isolation

`supabase/tests/archive_isolation.sql` has 14 checks. It runs in the SQL editor and stops with an error that lists the results, so everything is rolled back. **Test project, 2026-10-13: 14/14 pass**, run by the owner in the SQL editor, with nothing left behind. The checks:

- the columns are on all 8 tables;
- tenant A sees none of B's history and none of B's archived records;
- A's default list hides its archived rows;
- A can't archive, restore or delete B's records;
- A can't write history into B;
- history without a tenant gets A;
- history can't be changed or deleted;
- archiving and restoring a form by status keeps `archived_at` in step;
- a brand-new tenant archives and records history from its first request.

The owner-only rule for permanent delete is enforced by the app (`tenant_members.role`). The database doesn't know which person is behind a request.

## Notes

- Every current Monarch admin was made an **owner** when the tenant foundation went in, so today every admin can delete permanently. Change someone to `admin` in `tenant_members` to take that away.
- Also fixed: a document-signing test that started failing on 2026-10-13 because it mixed a fixed clock with real timestamps.
