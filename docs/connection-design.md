# ERO / Service Bureau → PTIN connection: design decisions (Krystal)

Recorded against the "ERO/Bureau to PTIN connection" item. **Not built.** One decision is still open (below).

## Decided
- **The PTIN keeps their own workspace.** A connection shares only what the PTIN chooses to share upward.
- **One connection only.** A PTIN is connected to one ERO or one Service Bureau: not both, not two of either.
- **Either side can end it.**
- **The PTIN chooses what to share, per client**: select several clients at once, or share them one by one.
- **Sharing a client shares exactly three things**: the client's information, the client's documents, and the notes. Nothing else.
- **Downward sharing** (corrected, Message 144): when the ERO/bureau shares a client down to its connected PTIN, the PTIN takes that client on as **one of their own clients** in their own workspace.
- **The ERO/bureau side gets a dedicated section in Documents** for documents belonging to clients of their connected PTINs (confirmed, Message 144).
- Sending connections is the ERO/bureau's side only; accepting is the PTIN's (see `ptin-product-requirements.md`, items 3 and 4).

## Mid-season rule: "finish what's started" (decided, Message 144)
If a connection ends mid-season:
1. **No new clients can be shared** after the end.
2. **Clients already shared stay visible to the other side until their open returns are finished.**
3. **The bureau keeps the documents and notes for returns already filed** (its own records).
4. **Once the last open return is done, the door closes.**

## Lead documents (decided and built on Preview, Message 144)
Leads have their own Documents section. A PDF from a form a lead completes is saved there. When the lead becomes a client the
documents move to the client and live under the client only, never under both. Built in `lib/leads/docs.ts` (the move), the
`lead_docs` table (migration `20261209090000_lead_documents.sql`) and the lead and contact pages.

## Build rule
Every part of this is tenant-wide platform code, with the same tenant separation as the rest of the system (Message 139).
