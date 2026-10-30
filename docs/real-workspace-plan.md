# The real workspace for every plan (Krystal's direction, Messages 148 and 150)

A paying tenant lands in the real workspace (the same shell, layout and design as the Monarch workspace), with the features
their plan includes. `/practice` is not the customer-facing product. Scoped, **not built**.

## Decisions
- **PTIN menu** = the Monarch workspace's "Every day" and "Grow" sections exactly, **with Leads added and Team left out**.
- **My Store is not hidden for non-Monarch bureaus.** Other bureaus get My Store too (so the store machinery must be made tenant-aware).
- **The one production PTIN workspace is not real.** No migration to plan.
- **Goal:** un-hardwire everything from Monarch, except what Krystal designates as Monarch's own products.

## Rules for every part of this work
- Platform code serves every tenant; Monarch-only pieces are named and chosen by Krystal (Message 139).
- The tenant comes from the signed-in person's membership, never from anything the browser sends; unresolved means an error, never Monarch.

## Plan mapping
What each plan sees and does is set by **`tier-capabilities-spec.md`** (approved, Message 154). Nothing in the plan mapping or the public copy goes beyond it.

## Progress
- **Step 1 (done, Preview):** the tenant comes from the signed-in person's memberships (`lib/workspace-tenant.ts`, `lib/workspace-session.ts`); no behavior change.
- **Step 2 (done, Preview only):** the workspace gate admits an owner or admin of **any** tenant on Preview (production stays closed to everyone but Monarch's people); the layout, tab title, brand and Admin link use the tenant the gate resolved; Leads move into the PTIN plan per the approved spec.
  - Known limit, to be proven by the Preview walk: any code that asks for the tenant **before** the gate has run in the same request would still get Monarch's. Pages and actions all start with the gate, but the walk (a real PTIN tenant must see none of Monarch's data) is the proof, and the isolation test with two real tenants follows.
  - Not yet converted: route handlers and background jobs (they do not pass the gate), the store's public side, the client portal's staff side, the Office area, and the lines that name Monarch's id directly (listed in the 47-use audit).
