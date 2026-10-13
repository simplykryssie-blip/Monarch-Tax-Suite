# Phase 3, Piece 1: Fees & Statements (built)

**Approved spec:** `docs/phase3-ero-operations-spec.md` (PR #36), Piece 1.
**Migration:** `supabase/migrations/20261019090000_fees.sql`.
**Gate:** `supabase/tests/fees_isolation.sql`.

Where to find it: **My Service Bureau → Fees & statements** (`/fees`). Bureau administrators use it today. The ERO-facing office area, where EROs sign in and see their own statement, comes in the next PR (see "Not in this PR").

## Your decisions, as built

1. **Nothing is hardcoded.** Every charge comes from the tenant's own saved fee schedule.
   - Monarch's pricing ($79 service bureau + $21 transmission + $24 technology + $99 e-file = **$223 on every return**) is a template the bureau can load into an empty schedule with one button, then edit or remove line by line.
   - The fee math never reads the template.
2. **Bank product fee:** a separate line item, charged only on returns with a bank product. It can be set **per bank**: a line for one bank is charged only on that bank's returns, and a line for "any bank" on every bank-product return. Banks come from **Software & banking** (`/bureau/settings`).
3. **Per-ERO overrides.** On each office's page, every bureau fee can be given the office's own amount.
   - $0 means that office isn't charged the fee.
   - "Use bureau amount" removes the office's own amount.
   - An office can also have extra lines of its own.
4. **Clear line items, no margin disclosure.** Statements show exactly which fees each return was charged.
5. **Returns without a bank product** are shown as **Owed by ERO**. The bureau marks them paid by hand, either for the full balance or a part payment, with an optional date, reference and note. A recorded payment can't be changed or deleted.
6. **Owed vs. collected from bank CSVs.**
   - Each row records what the bank reports as owed and as collected, matched to a return by its reference.
   - Rows that match no return, or more than one, are kept under **Rows to link** until someone links them.
   - The same file can't be imported twice (it's fingerprinted).
   - Imported amounts can't be edited.
7. **1099 rebates:** nothing is built. A fee line's `kind` column only allows `fee` today, which leaves room for a rebate line a future tenant could switch on.
8. **Return data comes from CSV import plus manual edits.**

## What a bureau can do

- **Fee schedule** (`/fees/schedule`): load Monarch's template, add lines (every return, or bank-product returns, optionally for one bank), rename, re-price, reorder, remove.
- **Offices** (`/fees`): each office's season totals (returns, fees owed, collected, balance, owed by ERO), with a tax-year picker. An office is a firm in My Service Bureau.
- **An office's statement** (`/fees/offices/{id}`):
  - filter by tax year, month or status;
  - the returns table, with a Mark paid button on returns without a bank product;
  - fee totals by line item;
  - the office's own amounts;
  - a form to record a return by hand;
  - **Statement PDF** and **CSV** downloads.
- **A return** (`/fees/returns/{id}`):
  - the fees it was charged, the money received, and its history;
  - edit the details;
  - **Re-apply current fees**, with a required reason that's kept in the history;
  - archive and restore. Archived returns are left out of statements, and their money is kept.
- **Import returns** (`/fees/import`):
  - choose the office and a CSV from the tax software;
  - match the columns (they're suggested, and remembered for next time);
  - import. New returns are recorded and charged; a return already recorded (same reference and tax year) is updated.
  - Rows with problems are skipped and listed with the reason: an unknown bank, a bad date, no reference, or a duplicate in the file.
- **Bank imports** (`/fees/bank`): choose the bank and its CSV, match the columns, import. Then link any unmatched rows to an office's return, and see every imported file.
- **History** (`/fees/history`): every change to fees, returns, imports, payments and statement exports, with who and when. It can't be edited or deleted.

## How the fees work

- **Fixed when recorded.** A return is charged when it's recorded or imported, using the office's fees at that moment (the bureau schedule plus the office's own amounts). A later schedule change doesn't rewrite past statements.
- **Bank changes.** If a return's bank product changes before anything has been collected, its fees are worked out again so bank fees follow the bank.
- **Re-applying.** Otherwise, re-apply fees on the return's page; you'll be asked for a reason.
- **Return status:**
  - **Paid:** nothing left to pay.
  - **Partly paid:** some money received, a balance left.
  - **Awaiting bank funding:** a bank product and nothing collected yet.
  - **Owed by ERO:** no bank product and not paid.
- **Statements.**
  - A **season** statement covers one tax year.
  - A **monthly** statement covers that tax year's returns filed in the month (or recorded in it, if there's no filed date).
- **Payments list:** each statement lists every payment for its returns, from the bank or the ERO, with dates and amounts.

## CSV formats

**Returns:**
- Needed: a return reference (the tax software's return ID) and the taxpayer's name.
- Optional: tax year (otherwise the year you choose), bank product, filed date and funded date.
- Bank products are matched to your list in Software & banking. A blank cell or "none" means no bank product.
- Dates can be `2026-02-14` or `02/14/2026`.
- **No Social Security numbers.** The return record doesn't hold them.

**Bank:**
- Needed: the return reference and the amount collected.
- Optional: amount owed, date collected, taxpayer name and tax year (the tax year is used to tell apart returns that share a reference).

**Both:**
- Files can be comma, semicolon or tab separated, up to 2 MB and 20,000 rows.

## Security and records

- **Eight new tables,** all with `tenant_id`, the standard two policies, and same-tenant foreign keys. A return can only belong to its own tenant's office, a fee line can only name its own tenant's bank, and money can only be linked to its own tenant's return.
- **Fee history:** append-only. Changing or deleting a row is refused by the database.
- **Recorded money:**
  - a receipt's amounts, date and import can't be changed;
  - the only change allowed is linking an unmatched bank row to a return;
  - an ERO payment can't be deleted;
  - a return with money recorded against it can't be deleted (archive it instead).
- **Banks:** a fee line, a return or a bank import must name a **bank product**, not a tax software entry.
- **Exports:** statement downloads are logged in the history.
- **Isolation gate (`fees_isolation.sql`): 20 checks.** They passed 20/20 against a local Postgres 16 running this migration with the real tenant functions (`current_tenant_id`, `require_tenant_id`, `pgrst_pre_request`). It needs to be run on the test project too.

## Not in this PR

- **The ERO-facing office area** (invited ERO and preparer accounts, the role hierarchy, each ERO seeing only their own office's statement) and retiring the old `(app)` workspace.
  - The approved spec puts these in PR 1. They're split into the next PR, **PR 1b**, so this one stays focused on the fee engine your prompt listed.
  - The statement pages are built so the same views can be shown to an ERO for their own office.
- **The Return Pipeline** (Piece 3) builds on this return record: stages, rejections, 8879 tracking and preparer assignment.

## Setup (owner)

1. **Test project:** run the migration, then the gate, in the SQL editor of **monarch-test-throwaway**.
2. On the Preview:
   - set up the fee schedule (load the template);
   - add a bank in Software & banking if there's none;
   - record or import a few test returns;
   - import a small bank CSV;
   - check a statement PDF.
3. **Production:** the migration needs your approval.
