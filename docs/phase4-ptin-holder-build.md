# Phase 4 — PTIN-holder operations: what was built and how to roll it out

Spec: `docs/phase4-ptin-holder-spec.md` (PR #61, approved 2026-10-16). Branch: `claude/phase4-build`.

## What is in it

**Piece 0, sign-in.** A platform administrator creates an independent PTIN holder's workspace (a `ptin`-tier tenant) and invites the owner from My Service Bureau → PTIN workspaces. The owner opens the one-time link (`/practice/invite/…`, 7 days) and sets a password. Two-step sign-in is then offered and strongly recommended, but **optional** (owner decision 2026-10-17): they can Skip for now, turn it on later from Security, and once on it is required at every sign-in. The office area still requires it. No self-serve signup (that comes with the pre-launch package). Tables: `practice_members`, `workspace_audit_events` (generic, append-only, tenant-keyed; named so because `audit_events` already exists for EFIN).

**Piece 1, workspace.** One return-prep and assignment layer (`lib/prep`) used by `/practice` (My Clients, Prep work, Assigned returns) and by the office area (`/office/clients`, `/office/prep`, `/office/assigned`, which were "Soon" in Phase 3). Per-user scoping: people see the clients they own and the returns assigned to them; an office's ERO sees the whole office; offices stay apart. Prep status: not started → in prep → ready for review → handed to ERO. Handing a return to an outside ERO emails a CSV from the holder's side and locks the return; nothing is shared between accounts (`return_handoffs` records the send only). Tables/columns: `clients.owner_id/organization_id`, `client_returns.assignee_id/prep_status/handed_off_at/organization_id`, `return_checklist_items`, `return_handoffs`.

**Piece 2, independent WISP: removed (owner decision 2026-10-17).** The WISP is a marketing tool for Monarch, not a workspace feature, so it is not part of `/practice`: no route, menu item, purchase, reminders or archive-on-link code. The $25 WISP Assisted Build storefront product is untouched. The `practice_wisps` table and `public.is_linked_to_ero()` function from migration `20261106090000_independent_wisp.sql` stay in the database, empty and unused.

## Apply, in order
1. `20261104090000_practice_access.sql`
2. `20261105090000_prep_assignment.sql`
3. `20261106090000_independent_wisp.sql`
then deploy. 

## Status
- Applied to the **test project** only (riuylqgpebchhinybxxz). **Not applied to production.**
- `supabase/tests/phase4_isolation.sql` on the test project: **39 of 39 PASS** (rolled back).
- `node --test`: 723 pass. `tsc`, `eslint`, `next build` clean.

## Not done / needs a person
- **Mobile at 390px** was reviewed from the CSS (forms collapse to one column, tables scroll inside their wrapper, the prep board stacks, 44px touch targets) but not checked on a device: the app can't run here without the service key. Check these screens on a phone: `/practice/clients`, `/practice/clients/[id]`, `/practice/prep`, `/practice/prep/[id]`, `/practice/assigned`, `/practice/wisp`, `/practice/invite/[token]`.
- **A real sign-in** (invite → password → two-step → workspace) and a **real $25 checkout** haven't been run end to end; use a test-mode Stripe key and fake data.
- Per-user scoping and the assignment rules are enforced in the app (`tests/prep.test.ts`), not in the database; the gate proves the tenant boundary.
- A holder without a verified sending domain hands returns off from the platform address with their own email as reply-to.
