# Tier capabilities: the approved spec (Krystal, Message 154)

**This list is the spec.** Governing rule (Message 153): *"This is a platform that will be sold to Independent PTINs, EROs and
Service Bureaus. I need each level to provide enough value to justify its cost."* Matching rule (Message 154): *"the capabilities
and front end match everything."* So:

- The built plan mapping **and** the public website / pricing / signup copy must match this list **exactly**.
- **Nothing is promised that isn't built; nothing is built that isn't listed.**
- Luna verifies tier by tier against this list. A test compares the built mapping to it (to be added with the plan mapping).
- Gate nothing by habit. Each tier stands on its own value, and the next tier's additions are worth the extra $100 a month.

**CLOSED (Message 155, Krystal, 2026-10-30):** *"I don't think a PTIN should have a store. Let's just keep it at the ERO and the service bureau level."*
So **PTIN has no store**: no store menus, storefront or store pages in a PTIN-tier workspace. **My Store is at the ERO and Service Bureau tiers.**

## At every level
The real workspace (same shell as Monarch's); own branding on their website and booking pages; own data, fully separated; own Stripe
account for taking payments; own verified email domain; two-step sign-in optional.

## PTIN, $99/mo: everything for a solo practice
- **Contacts:** clients, leads and customers in one list; a lead documents section (form PDFs file to the lead and transfer to the client on conversion).
- **Forms and intakes:** every submission becomes a PDF, emailed to the person inside the thank-you email, and filed on their record.
- **Client portal** for their own clients, with portal invites they can send; clients upload documents there.
- **Documents** tied to each client record.
- **Prep work tracking by stage** (not started / in prep / ready for review / handed to ERO). Tracking only: the platform does not transmit returns.
- **Calendar and bookings** with their own booking link.
- **Pipelines; Automation** (follow-ups, document-request reminders, appointment reminders); **Campaigns** by email and text (texting via credit packs).
- **Website builder;** forms on the site feed leads.
- **Reports:** their own production at a glance.
- **Connection upward:** accept ONE connection (one ERO or one bureau, never two); share chosen clients up (information + documents + notes, bulk or one by one);
  send clients for review and receive them back with notes; a client shared down to them becomes their own client; both sides can end a connection;
  a mid-season ending finishes what's started.
- **Billing:** manage their Verexa subscription.
- **No Team page.**

## Added at ERO, $199/mo (everything above, plus)
- **ERO Dashboard:** My EFIN, their firms and EFINs, openable (includes the Message 138 fix for ERO-tier links).
- **Team and office:** staff seats inside one workspace; roles (ERO / Preparer); office access.
- **Workload view** across their preparers; assigned returns.
- **Connections downward:** independent PTINs connect to them and keep their own workspaces; receive shared clients.
- **Review queue:** in-app bell only; reviewed-with-note completes it; sent-back-with-note stays in the queue until the PTIN resends.
- **A dedicated Documents section** for connected PTINs' client documents.
- **Share clients down** to a connected PTIN (becomes the PTIN's own client).
- **Software and banking assignment** for a connected PTIN (software and bank fees, locked on the PTIN's side).
- **My Store:** products, orders, licences, downloads, from their own shop address, paid to their own Stripe. (Decided Message 155. The Service Bureau tier keeps it, as the full store, per Message 151.)

## Added at Service Bureau, $299/mo (everything above, plus)
- **My Service Bureau:** Dashboard, EROs & EFINs across the whole downline, Renewals, Fees & statements, Office access, Compliance.
- **Downline at scale:** many connected EROs and PTINs; review queues from all of them; dedicated documents for the downline's shared clients.
- **Full My Store** (included from the ERO tier up; see above).
- **Bureau reporting:** production and fees across every office in the downline.

---

## Where the code stands against the spec (engineer's reading of the code, Message 154; not yet verified live)

| Spec item | State today |
|---|---|
| Real workspace for every plan | Not yet: signups land in `/practice` (steps 2 to 5 of the real-workspace plan) |
| Own branding, data separation, Stripe, email domain, optional two-step | Built (data separation proven by the SQL gates; the workspace itself is still Monarch-only until step 2) |
| Contacts in one list; lead documents | Built on Preview (lead documents table on the test project only) |
| Forms: PDF in the thank-you email, filed on the record | Built on Preview (filed under a matching client or lead) |
| Client portal and invites | Built, but runs as Monarch only; needs to be tenant-aware |
| Documents per client | Built |
| Prep tracking by stage | Prep board exists; the four stage names in the spec need checking against it |
| Calendar and own booking link | Built (host-based; needs a tenant walk-through) |
| Pipelines, Automation, Campaigns, Website builder | Built; run as Monarch only until the shell moves |
| Reports ("their own production at a glance") | A Reports page exists; its content needs checking against the spec |
| Connections (accept one, share up, review, share down, end) | Not built (design recorded in `connection-design.md`) |
| Billing (Verexa subscription) | Built in `/practice/billing`; to be ported into the real workspace |
| No Team page at PTIN | Done on Preview |
| ERO Dashboard links work at ERO tier | Not built (links go to Service Bureau pages) |
| Team seats, roles, office access inside one workspace | Not built in the workspace (Team page is read-only; Office access is Service Bureau-only) |
| Workload view; assigned returns | Assigned returns exist in `/practice`; a workload view is not built |
| Software and banking assignment for a connected PTIN | A Service Bureau settings page exists; the connected-PTIN version is not built |
| My Service Bureau pages | Built for Monarch; downline at scale and bureau reporting not built |
| My Store (ERO and Service Bureau; none at PTIN) from their own shop address, own Stripe | Built for Monarch only; step 9 of the plan. In code the store is Service Bureau-only today, so the plan mapping moves it down to ERO |

## Copy that must change to match (public website / pricing / signup)
`lib/billing/plans.ts` summaries today: ERO says "Adds the ERO tools: preparers, e-file and compliance." That promises **e-file** (the platform
does not transmit returns) and **compliance** (Service Bureau only in this spec). Replace all three summaries with wording drawn only from the
lists above, in the same change as the plan mapping. Any public website or pricing page outside this repository needs the same check.

## Message 155 effects on the build
- Plan mapping: the store section moves from Service Bureau-only to **ERO and up**; PTIN keeps none of it (menu, `/shop`-side pages, store settings such as Store payments).
- Step 9 (the tenant-aware store) now serves **ERO and Service Bureau** tenants.
- Questions for Krystal, not decided here: is the ERO store the same full store as the bureau's (assumed yes), and, with the store at ERO, what remains as Service Bureau's own additions beyond My Service Bureau, downline at scale and bureau reporting (the value rule, Message 153).
