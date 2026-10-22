# Part 2 — Tenant UX current-state map (DRAFT for owner review)

Prepared 2026-10-22 from a read-only pass over the code at `bd01830`. No redesign has been done and none will be until Krystal marks what is misplaced. This map describes what is there, how far it is from Home, and what is reachable only through an unrelated place.

**How clicks are counted:** from the area's Home page, using the menu. In the main (Monarch / Service Bureau) menu the groups open by default, so a menu item is 1 click; each page, tab or button after that adds 1.

## A. Four separate tenant experiences, not one

| Area | Who uses it | Entry | Menu |
|---|---|---|---|
| Main app (Monarch / Service Bureau) | The bureau owner today (Monarch); same menu trimmed by plan for demo ERO and PTIN views | `/` | Grouped menu: My Office, Operations, Settings (+ Admin for platform admin) |
| Office area | An ERO's office and its preparers | `/office` | Flat bar built from permissions |
| PTIN workspace | Self-serve independent PTIN holders | `/practice` | Flat bar of 8 links |
| Client portal | An office's clients | `/portal` | Flat bar of 6 links |

The same function appears in different places, with different names, in each area. Section C lists the differences.

## B. Main app (Monarch / Service Bureau)

| Function | Where it lives | Clicks from Home | Note |
|---|---|---|---|
| Leads | My Office → Leads | 1 | Add lead 2, import 2 |
| Clients | My Office → My Workspace → Clients | 2 | "My Workspace" opens a dashboard first |
| One client (all their work) | Clients → client → tabs: Overview, Documents, Messages, Work, Billing, Tasks, Notes, Portal | 3 | Messages, Work and Billing are tabs at 4 |
| Returns board | My Workspace → Returns in progress card | 2 | Reached through a dashboard card, not a menu item |
| Add a client / add a return / new invoice | My Workspace quick-action buttons | 2 | Only on that dashboard |
| Invoices | My Workspace → Outstanding / Collected cards | 2 | Not in the menu; no item named "Invoices" |
| Import clients | Settings → Import data | 1 | Lives in Settings, away from Clients and Leads |
| Document library | Only a button on the My Workspace dashboard | 2 | **Not in the menu anywhere** |
| Calendar | Operations → Calendar | 1 | Availability 2, appointment types 2 |
| Client tasks | Operations → Automation → Tasks tab | 3 | **Daily work filed under automation settings** |
| Pipelines (stages of a return) | Operations → Automation → Pipelines tab | 3 | Configuration, but it decides the Returns board |
| Messages | Only inside a client (Messages tab) | 4 | **No inbox; inbound texts are not stored on clients** |
| Forms | Operations → Forms | 1 | Submissions 3 |
| Campaigns | Operations → Campaigns | 1 | Contacts & consent is a tab, 2 |
| Website | Operations → Website | 1 | Domains is a tab, 2 |
| Automation workflows | Operations → Automation | 1 | Templates, Images tabs 2 (Images is linked from Text messaging settings) |
| Payments (collect online) | Settings → Payments | 1 | Needed before invoices can be paid online; filed with setup items |
| Store (products, orders, licenses, installs, customers, WISP) | My Office → My Store (group) | 1–2 | Monarch's own business |
| Service Bureau (EROs, renewals, fees, compliance) | My Office → My Service Bureau (group) | 1–2 | |
| Search | ⌘K / search box in the top bar | 1 | Finds Customers (store), Orders, Licenses, Products, Installations, Pages. **It does not find clients, leads, returns, invoices, appointments, forms or campaigns.** |

### Observations (main app)
- The daily trio **Clients → Returns → Invoices** has no menu item of its own. All three are reached through the My Workspace dashboard.
- **Messages** has no home. Per-client only.
- **Tasks** (daily work) sits under Automation (a setup area).
- **Document library** has no menu item.
- "Billing" means invoices to clients in My Workspace, and the subscription in the PTIN workspace (Section C).
- Search is store-centric; it cannot find the records a tax office uses most.

## C. The other three areas

### Office area (`/office`)
Menu (flat, from permissions): Home, Client intake, Return preparation, My assigned returns, Compliance, Office dashboard, Fees & statement, Team & permissions, E-file management (shown as "Soon"), plus compliance sub-areas for EROs.
- "Home" and "Office dashboard" both open `/office`. Two items, one destination.
- **Not present for an ERO office at all:** Calendar, Leads, Forms, Campaigns, Website, Automation, Invoices, Messages, Search. Those exist only in the main app.
- "Client intake" is the clients list; naming differs from every other area.
- Compliance has 8 sub-pages (items, PTIN, 8879, vault, incidents, history, settings, WISP) reached from a Compliance landing page, 2–3 clicks.

### PTIN workspace (`/practice`)
Menu: Home, My Clients, Prep work, Assigned returns, Campaigns, Website, Billing, Security.
- **Billing here is the subscription**, not client invoices. A PTIN workspace has no client invoices screen.
- **Not present:** Calendar, Leads, Forms, Automation, Invoices to clients, Messages, Search.
- Campaigns contacts and Website domains are tabs inside their pages (2 clicks).
- "Assigned returns" appears for a single-user workspace.

### Client portal (`/portal`)
Menu: Home, Documents, Invoices, Sign, Messages, Security. Compact and consistent. No findings.

## D. Same function, different names

| Function | Main app | Office | PTIN | Portal |
|---|---|---|---|---|
| Client list | Clients (under My Workspace) | Client intake | My Clients | n/a |
| Return work | Returns in progress / Work | Return preparation | Prep work | n/a |
| Money | Billing (client invoices) | Fees & statement | Billing (subscription) | Invoices |
| Dashboard | Home / My Workspace | Home and Office dashboard | Home | Home |

## E. Reachable only through something unrelated (candidates for "buried")

| Page | Only reachable via |
|---|---|
| Document library | A button on My Workspace dashboard |
| Add client / Add return / New invoice | Quick actions on My Workspace dashboard |
| Client tasks | Automation → Tasks |
| Returns pipeline stages | Automation → Pipelines |
| Messages for a client | Client page → Messages tab |
| Import clients | Settings → Import data |
| Orders → internal license, reconcile | Buttons on Orders / Store pages |
| Appointment types, Availability | Buttons on the Calendar page |
| Campaign contacts & consent, Website domains | Tabs inside Campaigns / Website |
| Fees: schedule, bank, import | Buttons on the Fees page |
| Compliance sub-pages (items, PTIN, history, settings) | Compliance landing page |

## F. Against the owner's principles

| Principle | Today |
|---|---|
| Daily work in ≤2 clicks from anywhere | Met for Leads, Calendar, Forms, Campaigns. **Not met for** client messages (4), tasks (3), a client's work/billing (4), document library (2 but not in the menu), pipelines (3) |
| One obvious home per function | **Not met** for Messages, Tasks, Invoices, Documents |
| Global search / quick actions | Search exists but is store-only; quick actions only on one dashboard |
| Consistent placement | **Not met**: four areas, four menus, different names (Section D) |
| Mobile (390px) parity | **Not audited in this pass**; flagged for the redesign |

## G. What the owner needs to mark

1. Which items in Section E belong in the main menu (or in a client's page) rather than where they are now.
2. Whether the ERO office and PTIN workspace should get the features they lack (Calendar, Invoices, Messages, Forms, Automation, Leads, Search), or whether the gap is intended by plan. This is the biggest structural question.
3. Whether the four areas should share one menu structure and vocabulary (Section D).
4. What search should find.

Nothing here has been changed.

## H. Owner marks (Krystal, 2026-10-22) — recommended defaults on all four

1. **Move to the main menu:** Document library, Client Tasks, a real Messages inbox, and a named Invoices item. **Import** moves next to Clients and Leads. **Pipelines stay under Automation** (configuration).
2. **ERO office and PTIN areas get the working basics:** Calendar, client Invoices, Messages, Search. Marketing and growth features stay plan-gated as they are today.
3. **One shared menu structure and one vocabulary across all four areas.** "Billing" stops meaning two things.
4. **Search finds the work:** clients, leads, returns, invoices, appointments, documents, not only store items.

Order: Part 1 (separation) is built first; Part 2 follows. The Messages inbox is a new build (inbound texts are not stored on clients today).
