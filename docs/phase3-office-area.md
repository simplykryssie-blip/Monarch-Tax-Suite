# Phase 3, PR 1b: ERO office area (built)

**Approved spec:** `docs/phase3-ero-operations-spec.md`, sections 2 (who uses it) and 6 (cross-cutting).
**Migration:** `supabase/migrations/20261020090000_office_access.sql`.
**Gate:** `supabase/tests/office_isolation.sql`.

## What's built

- **Invited accounts on the same app.**
  - The bureau invites an office's ERO from **My Service Bureau → Office access** (`/offices`).
  - The ERO invites their preparers from the office area (**Team & permissions**).
  - Each invite is a one-time link that works for 7 days. Only its hash is stored. It's emailed from the tenant's sending address; if the email can't go (for example, on Preview to an address that isn't a test recipient), the link is shown to the inviter to share by hand. It's never put in a page address.
  - The invited person chooses a password (12 characters minimum) and must turn on two-step sign-in before anything opens.
  - Someone who already has an account signs in with the invited email and accepts.
- **The office area** (`/office`). Everyone signs in at the same `/login`, and EROs and preparers land in their office. The menu shows only what that person can reach. Features that arrive with a later Phase 3 piece are shown as "Soon".
  - **Home / Office dashboard:** the season's fees owed, collected and balance (for those who can see fees), plus team counts.
  - **Fees & statement:** the office's own statement, read-only, with PDF and CSV downloads. Each download is logged in the fee history.
  - **Team & permissions** (ERO, or the bureau):
    - invite preparers;
    - choose each preparer's features;
    - suspend, reactivate, or withdraw an invite;
    - see recent activity.
- **Role hierarchy with inherited permissions** (`lib/office/permissions.ts`), set per feature rather than as three flat roles:
  - **PTIN holder (preparer):** home, client intake, return preparation, my assigned returns. The last three arrive with the Return Pipeline.
  - **ERO:** everything above, plus the office dashboard, fees and statement, e-file management (Pipeline) and team management.
  - **Service bureau:** everything above, plus ERO management and every office.
- **What the ERO controls for each preparer:**
  - The preparer-level features are on by default; the ERO can turn any of them off.
  - The ERO can also hand a preparer ERO features such as fees or the dashboard.
  - Team management is never delegated, and bureau features never reach an office.
- **Offices.** An office is a firm in My Service Bureau (an `organizations` row). Its locations and EFINs are filters inside it, not separate offices.
- **Who sees what.**
  - An account belongs to one office, and its members see only that office.
  - Bureau administrators can open any of the bureau's offices from Office access (or switch offices in the office area's top bar) to see what that team sees.
- **Two-step sign-in is required for every account in the office area,** including bureau administrators when they open it. It uses an authenticator app (TOTP), as the FTC Safeguards Rule requires for systems that reach client data.
  - The first visit sets it up: a QR code, or a key to type in.
  - Every sign-in afterwards asks for a code. Nothing in the office area loads, and no office action runs, until it's done.
- **History.** Every invite, email attempt, acceptance, permission change, suspension and two-step setup is in `office_events`. The database won't let it be changed or deleted.

## Retired: the old `(app)` workspace

- **Removed:** the clients, engagements, tasks and settings pages, with their shell, components and helpers.
- **No records to move.** I checked both databases (test and production), and none of the tables those pages used (`clients`, `engagements`, `tasks`, `notes`, `workspaces`, …) exist in either.
- Nothing else in the app used them.

## Security and records

- **Two new tables.** `office_members` and `office_events` both have `tenant_id`, the standard two policies, and same-tenant foreign keys. A member can only belong to their own tenant's office, and history can only name their own tenant's member.
- **Two new logged platform lookups,** needed because the tenant isn't known until then:
  - `office_member`: which office a signed-in account belongs to;
  - `office_invite`: which invite a link points at, and creating the sign-in when it's accepted.
- **One office per account.** Within a tenant, the office area keeps each member to their own office. Every page and action checks it again.
- **Isolation gate (`office_isolation.sql`): 10 checks.** They passed 10/10 against a local Postgres 16 running this migration with the real tenant functions.

## Setup (owner)

1. **Test project:** I applied the migration. Paste the gate into the SQL editor to confirm 10/10.
2. **On the Preview:**
   - open **My Service Bureau → Office access**;
   - invite yourself (a different email from your admin account) as the ERO of a test firm;
   - open the link, set a password, and set up two-step sign-in;
   - invite a preparer from **Team & permissions**, and try turning features on and off.
   - On Preview, invite emails only reach addresses in `AUTOMATION_TEST_RECIPIENTS`; otherwise copy the link from the screen.
3. **Bureau administrators** opening the office area will set up two-step sign-in on their own admin account the first time.
4. **Production:** the migration needs your approval.
