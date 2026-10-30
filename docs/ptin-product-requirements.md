# PTIN product requirements (Krystal's decisions, recorded for the build)

"The PTIN workspace" here means the workspace a person gets when they sign up and pay for the PTIN plan: the `/practice` area
(a `ptin`-tier tenant with a `practice_member` seat). It is not the Monarch workspace with its tier set to PTIN: the Monarch
workspace has capabilities a purchased PTIN workspace does not, so checking it that way shows the wrong thing.

## Requirements

1. **Leads.** A PTIN holder can add and work leads (potential tax clients) in `/practice`.
2. **Client portal.** A PTIN holder can use the client portal for their own clients and send client portal invites.
3. **Sending connections: not allowed.** A PTIN holder cannot send firm connections or invites. Nothing to build; keep it that way.
4. **Accepting connections: required.** A PTIN holder can accept a connection when an ERO or a Service Bureau sends one to them.
   This receiving side is part of the connection feature (the "ERO/Bureau to PTIN connection" item).
5. **Team page.** Team is a standalone page, so it is not part of the PTIN plan: hidden from the PTIN menu and blocked at its address.
   (Done on Preview, in `lib/tier.ts` and `lib/nav.ts`.)

## Where things stand (checked against the code)

| Requirement | State |
|---|---|
| 1 Leads in `/practice` | Not there. `/practice` has no Leads page; Leads exist only in the Monarch workspace (Service Bureau tier). |
| 2 Portal for a PTIN holder's clients | Not there. Portal invites and the portal staff pages run as the Monarch tenant only. |
| 3 No sending | Correct today: `/practice` has no invite or connection tool. |
| 4 Accepting connections | Not built. The connection feature itself is not built. |
| 5 Team page | Done on Preview. |

Every one of these must be built as tenant-wide platform code, not as Monarch-only code (standing rule, Message 139).
