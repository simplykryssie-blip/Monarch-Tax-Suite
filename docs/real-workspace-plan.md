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
