# Phase 4 — PTIN-holder operations: what was built and how to roll it out

Spec: `docs/phase4-ptin-holder-spec.md` (PR #61, approved 2026-10-16). Branch: `claude/phase4-build`.

## What is in it

**Piece 0, sign-in.** A platform administrator creates an independent PTIN holder's workspace (a `ptin`-tier tenant) and invites the owner from My Service Bureau → PTIN workspaces. The owner opens the one-time link (`/practice/invite/…`, 7 days), sets a password and turns on two-step sign-in; `/practice` opens only after that. No self-serve signup (that comes with the pre-launch package). Tables: `practice_members`, `workspace_audit_events` (generic, append-only, tenant-keyed; named so because `audit_events` already exists for EFIN).

**Piece 1, workspace.** One return-prep and assignment layer (`lib/prep`) used by `/practice` (My Clients, Prep work, Assigned returns) and by the office area (`/office/clients`, `/office/prep`, `/office/assigned`, which were "Soon" in Phase 3). Per-user scoping: people see the clients they own and the returns assigned to them; an office's ERO sees the whole office; offices stay apart. Prep status: not started → in prep → ready for review → handed to ERO. Handing a return to an outside ERO emails a CSV from the holder's side and locks the return; nothing is shared between accounts (`return_handoffs` records the send only). Tables/columns: `clients.owner_id/organization_id`, `client_returns.assignee_id/prep_status/handed_off_at/organization_id`, `return_checklist_items`, `return_handoffs`.

**Piece 2, independent WISP.** The holder builds the plan (sole-practitioner wording), buys the $25 WISP product through the storefront (matched to their own record by Stripe session), generates the PDF, attests by typing their name, and reviews yearly. Reminders at 30 and 7 days; Overdue is shown, nothing is locked. Joining an ERO's office archives the independent WISP as history (database trigger forbids deleting or editing an archived one). "Linked to an ERO" is `public.is_linked_to_ero(user)`: an active `office_members` row. Table: `practice_wisps`.

## Apply, in order
1. `20261104090000_practice_access.sql`
2. `20261105090000_prep_assignment.sql`
3. `20261106090000_independent_wisp.sql`
then deploy. The daily cron now also runs the PTIN WISP sweep (`practiceWisps` in its response).

## Status
- Applied to the **test project** only (riuylqgpebchhinybxxz). **Not applied to production.**
- `supabase/tests/phase4_isolation.sql` on the test project: **39 of 39 PASS** (rolled back).
- `node --test`: 723 pass. `tsc`, `eslint`, `next build` clean.

## Not done / needs a person
- **Mobile at 390px** was reviewed from the CSS (forms collapse to one column, tables scroll inside their wrapper, the prep board stacks, 44px touch targets) but not checked on a device: the app can't run here without the service key. Check these screens on a phone: `/practice/clients`, `/practice/clients/[id]`, `/practice/prep`, `/practice/prep/[id]`, `/practice/assigned`, `/practice/wisp`, `/practice/invite/[token]`.
- **A real sign-in** (invite → password → two-step → workspace) and a **real $25 checkout** haven't been run end to end; use a test-mode Stripe key and fake data.
- Per-user scoping and the assignment rules are enforced in the app (`tests/prep.test.ts`), not in the database; the gate proves the tenant boundary.
- A holder without a verified sending domain hands returns off from the platform address with their own email as reply-to.
