# Monarch Tax Lab: tax-preparer training sold as licenses

Monarch Tax Lab (`/lab`) is the training product: practice client scenarios, an intake and interview sheet, a
desktop-style practice tax program for **tax year 2026**, server-side answer checking, and instructor review. It is
sold from the Monarch store as license keys, and lives on Monarch's own site, so there is nothing to install.

## How it fits the existing commerce module

- A training license is an ordinary `calculator_licenses` row: bought at `/shop/<slug>`, recorded by the signed Stripe
  webhook, key issued from the CRM license page (shown once) exactly like the calculator.
- What makes a product a training product is its settings (CRM → Products → product settings):

  | Setting | Value |
  |---|---|
  | `delivery` | `tax_lab` |
  | `lab_role` | `instructor` or `student` |
  | `lab_seats` | instructor licenses: student seats, 1 to 1000 |
  | `lab_term_days` | optional: days of access from activation (default 365) |

  Set product type **Software** and access type **License**. Training products need no installation option (the
  publish check and the storefront checkout skip it for `delivery = tax_lab`); anything else about publishing is
  unchanged.
- **Phase 2 (not built yet): auto-renewing annual subscriptions.** Checkout is still one-time only (the platform's
  rule). Until then, sell a one-year license; `lab_term_days` sets the length.

## The buyer's path

1. Buys the product in the store, receives the license key (CRM → License → Issue key, then send it).
2. Opens `/lab/activate`, enters the key and creates an account (or signs in first). Activation records the
   license's terms in `lab_license_terms` (instructor or student, seats, end date) and makes the buyer its first
   member. A key works for one account; activating again from the same account is harmless.
3. **Instructors** invite students at `/lab/roster`: each email gets a one-time join link (`/lab/join/<token>`,
   30 days, only the hash stored). Each invited or joined student holds a seat; removing a student frees it.
4. **Students** practice at `/lab/s/<scenario>`: client file, intake sheet, practice software, Check & submit.
   Students of an instructor submit for review; individual (self-study) students only self-check.
5. Instructors grade at `/lab/review`.

When access ends (`expires_at`), the lab is closed for that license; data is kept.

## Scenarios and answer keys

- **Library scenarios** (`license_id` null) are written by Monarch administrators (`admin_users`) and seen by every
  licensee. **Class scenarios** are written by an instructor and seen only by that license's members.
- The author prepares the correct return in the same practice software; on save the server recomputes every line
  (`lib/lab/engine.ts`) and stores them in `lab_answer_keys` with the lines students must match. Overrides are allowed.
- **Answer keys never reach the browser.** "Check my return" runs on the server and returns only match / no match per
  line. Instructors see the key values on the review page.
- Intake: **notes provided** (students read the story) or **interview** (the story is hidden from students and is the
  instructor's script; students fill the intake sheet).
- Practice copies of W-2, 1099-INT/DIV/G/R/NEC and SSA-1099 forms, plus a household roster, are built from the
  answer key's entries; the author picks which ones students get.
- PDFs: `/lab/s/<id>/packet` (student intake packet with a blank intake sheet), `?kind=instructor` (adds the story
  and answer key, editors only), and `/lab/s/<id>/return` (the student's return summary).

## The engine (tax year 2026)

`lib/lab/engine.ts`, tested in `tests/lab-engine.test.ts`. Figures from Rev. Proc. 2025-32 and the 2026
One, Big, Beautiful Bill Act provisions: brackets, standard deduction ($16,100 / $32,200 / $24,150), CTC $2,200 and
ACTC $1,700, EITC table, qualified dividend / capital gain worksheet, Social Security worksheet, SE tax (wage base
$184,500), QBI with the $400 minimum, Schedule 1-A (senior, tips, overtime, car loan), SALT $40,400, charitable
deduction for non-itemizers (line 12f) and the 0.5% floor, dependent care at the new 50% rate, education credits,
student loan interest. Line numbers follow the **draft** 2026 Form 1040; recheck when the final form is released.
Not modeled (reported as notes, never guessed): rental income, Form 8962 (entered as a result), the 37%-bracket
itemized limit, QBI above the threshold, the 8812 Part II-B alternative.

## Data and security

Migration `20261203090000_tax_lab.sql` (additive: five new tables). All are tenant tables in the Monarch tenant with
row-level security; browsers have no grants. Server code reaches them through `tenantClient(MONARCH_TENANT_ID)`
(`lib/lab/server.ts`). Rules live in `lib/lab/service.ts` and are tested in `tests/lab-service.test.ts` (activation,
seats, invites, expiry, visibility, checking, submission, grading).

Activation and join pages are public (the license key or invite token is the credential) and rate limited per
visitor. A signed-in account that is only a lab member is sent to `/lab` by `requireAdmin`.

## Rollout

1. Apply the migration to the Monarch project (applied to `monarch-test-throwaway` on 2026-10-28 for testing).
2. Deploy. Create the instructor and student products with the settings above, link Stripe, publish.
3. Write the first library scenarios at `/lab` (administrator accounts see "New library scenario").
